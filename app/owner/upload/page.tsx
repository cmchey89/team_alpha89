// app/owner/upload/page.tsx
'use client';

import { useState } from 'react';
import Navbar from '@/components/Navbar';
import {
  parseGisFile,
  flattenLineFeatures,
  UnsupportedGisFileError,
  type ParsedGisResult,
} from '@/lib/gis/parseGisFile';

type UtilityType = 'electrical' | 'water' | 'gas' | 'telecom' | 'other';

const UTILITY_TYPES: { key: UtilityType; label: string }[] = [
  { key: 'electrical', label: 'HV Electrical' },
  { key: 'water', label: 'Water Main' },
  { key: 'gas', label: 'Gas Line' },
  { key: 'telecom', label: 'Telecom Duct' },
  { key: 'other', label: 'Other' },
];

export default function OwnerUploadPage() {
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedGisResult | null>(null);
  const [featureCount, setFeatureCount] = useState(0);
  // Maps layer name -> chosen utility type, since a GeoPackage can bundle
  // multiple layers (e.g. one per utility) that each need a type assigned
  // before we insert them as infra_lines.
  const [layerTypes, setLayerTypes] = useState<Record<string, UtilityType>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    setParsed(null);
    setParsing(true);
    try {
      const result = await parseGisFile(file);
      const lines = flattenLineFeatures(result);
      setParsed(result);
      setFeatureCount(lines.length);
      const defaults: Record<string, UtilityType> = {};
      for (const l of result.layers) defaults[l.name] = 'other';
      setLayerTypes(defaults);
    } catch (e) {
      if (e instanceof UnsupportedGisFileError) {
        setError(e.message);
      } else {
        setError('Could not parse this file. ' + (e instanceof Error ? e.message : String(e)));
      }
    } finally {
      setParsing(false);
    }
  }

  async function handleSubmit() {
    if (!parsed) return;
    setSubmitting(true);
    setSubmitResult(null);
    try {
      const lines = flattenLineFeatures(parsed);
      const payload = {
        sourceFormat: parsed.sourceFormat,
        features: lines.map(({ layerName, feature }) => ({
          utilityType: layerTypes[layerName] ?? 'other',
          label: (feature.properties as any)?.name ?? layerName,
          sourceProperties: feature.properties,
          geometry: feature.geometry,
        })),
      };

      const res = await fetch('/api/infra/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Upload failed (${res.status})`);
      }

      const body = await res.json();
      setSubmitResult(`Saved ${body.inserted} infrastructure line(s) as the new baseline.`);
      setParsed(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
    <Navbar title="Owner — Upload Baseline" />
    <main className="upload-page">
      <h1>Upload underground infrastructure baseline</h1>
      <p className="hint">
        Export your QGIS layers as a <strong>GeoPackage (.gpkg)</strong> — in QGIS:
        right-click your layer(s) → Export → Save Features As → format{' '}
        <em>GeoPackage</em>. A zipped shapefile (.zip containing .shp/.shx/.dbf/.prj)
        also works. Parsing happens entirely in your browser; the raw file is
        never sent to our server, only the resulting geometry.
      </p>

      <label className="dropzone">
        <input
          type="file"
          accept=".gpkg,.zip,.shp,.qgz,.qgs"
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
        {parsing ? 'Parsing in your browser…' : 'Click to choose a file, or drag one here'}
      </label>

      {error && <div className="error-box">{error}</div>}

      {parsed && (
        <div className="review-box">
          <h2>Review before saving</h2>
          <p>
            Detected format: <code>{parsed.sourceFormat}</code> · {parsed.layers.length} layer(s)
            · {featureCount} line feature(s) found
          </p>

          {parsed.layers.map((layer: ParsedGisResult['layers'][number]) => (
            <div key={layer.name} className="layer-row">
              <span className="layer-name">{layer.name}</span>
              <span className="layer-count">
                {layer.geojson.features.length} feature(s)
              </span>
              <select
                value={layerTypes[layer.name]}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                  setLayerTypes((prev: Record<string, UtilityType>) => ({ ...prev, [layer.name]: e.target.value as UtilityType }))
                }
              >
                {UTILITY_TYPES.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
          ))}

          <button onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Saving…' : `Save as baseline (${featureCount} lines)`}
          </button>
        </div>
      )}

      {submitResult && <div className="success-box">{submitResult}</div>}
    </main>
    </>
  );
}
