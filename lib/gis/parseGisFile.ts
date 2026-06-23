// lib/gis/parseGisFile.ts
//
// Client-side only. Parses an uploaded GeoPackage (.gpkg) or zipped
// shapefile into GeoJSON, entirely in the browser via gdal3.js (GDAL
// compiled to WebAssembly). This means the Vercel serverless functions
// never need a native GDAL binary — they only ever receive plain GeoJSON.
//
// IMPORTANT — about .qgz/.qgs files specifically:
// A QGIS project file (.qgz/.qgs) is NOT itself spatial data. It's a
// project/styling file that references layers by file path (shapefile,
// GeoPackage, etc.) on the machine that created it. Uploading just the
// .qgz will not give us anything to parse here.
//
// The correct workflow is:
//   1. In QGIS: right-click your layer(s) -> Export -> Save Features As...
//      -> format: GeoPackage. This bundles all layers into one .gpkg file
//      with no external path dependencies.
//   2. Upload that .gpkg here instead of the .qgz.
//
// This module supports .gpkg and zipped .shp directly. It deliberately does
// NOT attempt to parse .qgz, and surfaces a clear error if one is dropped in,
// rather than silently failing or guessing at linked file paths.

import initGdalJs from 'gdal3.js';
// eslint-disable-next-line @typescript-eslint/no-var-requires
import type { Feature, FeatureCollection } from 'geojson';

let gdalInstance: any = null;

// Default to loading gdal3.js's wasm/data files from jsDelivr's CDN rather
// than vendoring them into this repo — they're commonly tens of MB, and
// keeping them out of the repo avoids bloating git history and Vercel build
// output. If you'd rather self-host (e.g. for an offline/airgapped
// deployment), run `npm run postinstall` manually to copy them into
// public/gdal3wasm, then change GDAL_WASM_PATH below to '/gdal3wasm'.
const GDAL_WASM_PATH =
  process.env.NEXT_PUBLIC_GDAL_WASM_PATH ||
  'https://cdn.jsdelivr.net/npm/gdal3.js@2.8.1/dist/package';

async function getGdal() {
  if (gdalInstance) return gdalInstance;
  gdalInstance = await initGdalJs({
    path: GDAL_WASM_PATH,
    // The CDN path can't be reached from inside a Web Worker without extra
    // CORS config, so we disable the worker when using the CDN. This means
    // parsing runs on the main thread — fine for typical infra-line files,
    // but a very large upload may visibly block the UI for a few seconds.
    // Self-hosting (see above) re-enables safe worker usage.
    useWorker: GDAL_WASM_PATH.startsWith('/'),
  });
  return gdalInstance;
}

export interface ParsedGisResult {
  sourceFormat: string;
  layers: {
    name: string;
    geojson: FeatureCollection;
  }[];
}

export class UnsupportedGisFileError extends Error {}

export async function parseGisFile(file: File): Promise<ParsedGisResult> {
  const lowerName = file.name.toLowerCase();

  if (lowerName.endsWith('.qgz') || lowerName.endsWith('.qgs')) {
    throw new UnsupportedGisFileError(
      'This is a QGIS project file, not the actual map data. In QGIS, export your layer(s) as a GeoPackage (.gpkg) — right-click the layer → Export → Save Features As → GeoPackage — then upload that file instead.'
    );
  }

  const Gdal = await getGdal();

  if (lowerName.endsWith('.gpkg')) {
    return parseSingleFile(Gdal, file, 'GPKG');
  }

  if (lowerName.endsWith('.zip')) {
    // Expected to be a zipped shapefile bundle (.shp/.shx/.dbf/.prj etc).
    return parseSingleFile(Gdal, file, 'ESRI Shapefile');
  }

  if (lowerName.endsWith('.geojson') || lowerName.endsWith('.json')) {
    return parseGeoJsonFile(file);
  }

  if (lowerName.endsWith('.shp')) {
    throw new UnsupportedGisFileError(
      'A standalone .shp file is missing its companion files (.shx, .dbf, .prj). Please zip the whole set of files together and upload the .zip instead.'
    );
  }

  throw new UnsupportedGisFileError(
    `Unsupported file type: ${file.name}. Upload a GeoJSON (.geojson), GeoPackage (.gpkg), or a zipped shapefile (.zip).`
  );
}

async function parseGeoJsonFile(file: File): Promise<ParsedGisResult> {
  const text = await file.text();
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Could not parse file as JSON. Make sure it is a valid GeoJSON file.');
  }

  let geojson: FeatureCollection;
  if (parsed.type === 'FeatureCollection') {
    geojson = parsed;
  } else if (parsed.type === 'Feature') {
    geojson = { type: 'FeatureCollection', features: [parsed] };
  } else {
    throw new UnsupportedGisFileError('GeoJSON file must be a FeatureCollection or Feature.');
  }

  return {
    sourceFormat: 'GeoJSON',
    layers: [{ name: file.name.replace(/\.(geojson|json)$/i, ''), geojson }],
  };
}

async function parseSingleFile(
  Gdal: any,
  file: File,
  expectedFormat: string
): Promise<ParsedGisResult> {
  // gdal3.js's open() takes the raw File and figures out the driver itself;
  // `expectedFormat` here is only used for the result metadata, not to force
  // a driver, since GDAL's own format sniffing is more reliable than ours.
  const result = await Gdal.open(file);
  const dataset = result.datasets[0];

  if (!dataset) {
    throw new Error('GDAL could not find any readable layers in this file.');
  }

  const layers: ParsedGisResult['layers'] = [];

  // A GeoPackage can contain multiple layers (e.g. one per utility type).
  // We convert each one to GeoJSON independently so the caller can decide
  // how to label/group them (see app/owner/upload — the user assigns a
  // utility type per layer before we insert into infra_lines).
  const layerCount = await Gdal.ogrinfo(dataset, ['-json']).then(
    (info: any) => JSON.parse(info.output).layers?.length ?? 1
  );

  for (let i = 0; i < layerCount; i++) {
    const outputBytes = await Gdal.ogr2ogr(dataset, [
      '-f', 'GeoJSON',
      '-t_srs', 'EPSG:4326', // reproject to WGS84 lat/lng, matching our DB SRID
      '-layer', String(i),
    ]);
    const outputFile = await Gdal.getOutputFile(outputBytes, 'GeoJSON');
    const text = await outputFile.text();
    const geojson: FeatureCollection = JSON.parse(text);

    layers.push({
      name: dataset.layers?.[i]?.name ?? `layer_${i}`,
      geojson,
    });
  }

  await Gdal.close(dataset);

  return { sourceFormat: expectedFormat, layers };
}

/**
 * Flattens every LineString/MultiLineString feature across all parsed layers
 * into a single array, ready to hand to the upload API route. Point and
 * polygon features are skipped with a warning, since infra_lines only models
 * linear utility runs — adjust this if you also need to ingest substations,
 * manholes, etc. as point features later.
 */
export function flattenLineFeatures(
  result: ParsedGisResult
): { layerName: string; feature: Feature }[] {
  const out: { layerName: string; feature: Feature }[] = [];
  for (const layer of result.layers) {
    for (const feature of layer.geojson.features) {
      const t = feature.geometry?.type;
      if (t === 'LineString' || t === 'MultiLineString') {
        out.push({ layerName: layer.name, feature });
      }
    }
  }
  return out;
}
