'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import 'leaflet/dist/leaflet.css';
import Navbar from '@/components/Navbar';
import {
  parseGisFile,
  flattenLineFeatures,
  UnsupportedGisFileError,
  type ParsedGisResult,
} from '@/lib/gis/parseGisFile';

const MapContainer = dynamic(() => import('react-leaflet').then((m) => m.MapContainer), { ssr: false });
const TileLayer    = dynamic(() => import('react-leaflet').then((m) => m.TileLayer), { ssr: false });
const Polyline     = dynamic(() => import('react-leaflet').then((m) => m.Polyline), { ssr: false });

type UtilityType = 'telecom_pipe' | 'manhole' | 'other';

const UTILITY_TYPES: { key: UtilityType; label: string }[] = [
  { key: 'telecom_pipe', label: 'Telecom Pipe' },
  { key: 'manhole',      label: 'Manhole' },
  { key: 'other',        label: 'Other' },
];

const UTILITY_COLORS: Record<string, string> = {
  telecom_pipe: '#9C27B0',
  manhole:      '#FF9800',
  other:        '#9E9E9E',
};

interface InfraLine {
  id: string;
  utilityType: string;
  label: string | null;
  geometry: { type: string; coordinates: any };
}

function geomToLatLngs(geometry: { type: string; coordinates: any }): [number, number][][] {
  if (geometry.type === 'LineString') {
    return [geometry.coordinates.map(([lng, lat]: number[]) => [lat, lng] as [number, number])];
  }
  if (geometry.type === 'MultiLineString') {
    return geometry.coordinates.map((line: number[][]) =>
      line.map(([lng, lat]) => [lat, lng] as [number, number])
    );
  }
  return [];
}

export default function OwnerUploadPage() {
  const router = useRouter();
  const [parsing, setParsing]       = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [parsed, setParsed]         = useState<ParsedGisResult | null>(null);
  const [featureCount, setFeatureCount] = useState(0);
  const [layerTypes, setLayerTypes] = useState<Record<string, UtilityType>>({});
  const [submitting, setSubmitting] = useState(false);
  const [lines, setLines]           = useState<InfraLine[]>([]);
  const [loadingMap, setLoadingMap] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    fetch('/api/auth/me').then(r => {
      if (r.status === 401) { router.replace('/login'); return null; }
      return r.json();
    }).then(d => {
      if (d) setAuthChecked(true);
    }).catch(() => { router.replace('/login'); });
  }, [router]);

  if (!authChecked) return null;

  async function fetchLines() {
    setLoadingMap(true);
    try {
      const res = await fetch('/api/infra/lines');
      if (res.ok) {
        const data = await res.json();
        setLines(data.lines ?? []);
      }
    } finally {
      setLoadingMap(false);
    }
  }

  useEffect(() => { fetchLines(); }, []);

  async function handleFile(file: File) {
    setError(null);
    setParsed(null);
    setParsing(true);
    try {
      const result = await parseGisFile(file);
      const lineFeatures = flattenLineFeatures(result);
      setParsed(result);
      setFeatureCount(lineFeatures.length);
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
    setError(null);
    try {
      const lineFeatures = flattenLineFeatures(parsed);
      const payload = {
        sourceFormat: parsed.sourceFormat,
        features: lineFeatures.map(({ layerName, feature }) => ({
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
        throw new Error((body.error || `Upload failed (${res.status})`) + (body.details ? `: ${body.details}` : ''));
      }

      setParsed(null);
      await fetchLines();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  // Compute map center from loaded lines
  const allCoords = lines.flatMap((l) => geomToLatLngs(l.geometry).flat());
  const mapCenter: [number, number] = allCoords.length > 0
    ? [
        allCoords.reduce((s, p) => s + p[0], 0) / allCoords.length,
        allCoords.reduce((s, p) => s + p[1], 0) / allCoords.length,
      ]
    : [1.3521, 103.8198];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <Navbar title="Owner — Infrastructure Baseline" />

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* Left panel — upload controls */}
        <aside style={{
          width: 360,
          background: 'var(--panel)',
          borderRight: '1px solid var(--line)',
          padding: 20,
          overflowY: 'auto',
          flexShrink: 0,
        }}>
          <h2 style={{ margin: '0 0 8px', fontSize: 16 }}>Upload Baseline</h2>
          <p className="hint" style={{ marginBottom: 16 }}>
            Upload a GeoJSON, GeoPackage (.gpkg), or zipped shapefile (.zip).
            Parsing happens in your browser — the raw file is never sent to the server.
          </p>

          <label className="dropzone">
            <input
              type="file"
              accept=".gpkg,.zip,.shp,.qgz,.qgs,.geojson,.json"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />
            {parsing ? 'Parsing in your browser…' : 'Click to choose a file, or drag one here'}
          </label>

          {error && <div className="error-box">{error}</div>}

          {parsed && (
            <div className="review-box">
              <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>Review before saving</h3>
              <p style={{ fontSize: 13, color: 'var(--grey)', marginBottom: 12 }}>
                {parsed.sourceFormat} · {parsed.layers.length} layer(s) · {featureCount} line(s)
              </p>

              {parsed.layers.map((layer) => (
                <div key={layer.name} className="layer-row">
                  <span className="layer-name">{layer.name}</span>
                  <span className="layer-count">{layer.geojson.features.length}</span>
                  <select
                    value={layerTypes[layer.name]}
                    onChange={(e) => setLayerTypes((prev) => ({ ...prev, [layer.name]: e.target.value as UtilityType }))}
                  >
                    {UTILITY_TYPES.map((t) => (
                      <option key={t.key} value={t.key}>{t.label}</option>
                    ))}
                  </select>
                </div>
              ))}

              <button
                onClick={handleSubmit}
                disabled={submitting}
                style={{ width: '100%', padding: 12, marginTop: 16, border: 'none', borderRadius: 4, background: submitting ? 'var(--grey)' : 'var(--orange)', color: '#1a0d04', fontWeight: 600, cursor: submitting ? 'not-allowed' : 'pointer' }}
              >
                {submitting ? `Saving… do not click again` : `Save ${featureCount} lines to baseline`}
              </button>
            </div>
          )}

          {/* Legend */}
          {lines.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <h3 style={{ fontSize: 13, marginBottom: 10, color: 'var(--grey)' }}>
                LEGEND — {lines.length} lines loaded
              </h3>
              {UTILITY_TYPES.map((t) => {
                const count = lines.filter((l) => l.utilityType === t.key).length;
                if (count === 0) return null;
                return (
                  <div key={t.key} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <div style={{ width: 24, height: 3, background: UTILITY_COLORS[t.key], borderRadius: 2 }} />
                    <span style={{ fontSize: 12, color: 'var(--paper)' }}>{t.label}</span>
                    <span style={{ fontSize: 11, color: 'var(--grey)', marginLeft: 'auto' }}>{count}</span>
                  </div>
                );
              })}
            </div>
          )}

          {lines.length > 0 && (
            <button
              onClick={async () => {
                if (!confirm(`Delete all ${lines.length} infrastructure lines? This cannot be undone.`)) return;
                await fetch('/api/infra/clear', { method: 'DELETE' });
                setLines([]);
              }}
              style={{
                marginTop: 20, width: '100%', padding: '10px',
                background: 'none', border: '1px solid var(--red)',
                color: 'var(--red)', borderRadius: 4, cursor: 'pointer', fontSize: 13,
              }}
            >
              Clear all infrastructure lines
            </button>
          )}

          {loadingMap && (
            <p style={{ fontSize: 12, color: 'var(--grey)', marginTop: 16 }}>Loading map data…</p>
          )}
        </aside>

        {/* Right — map */}
        <div style={{ flex: 1, position: 'relative' }}>
          {lines.length === 0 && !loadingMap && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              color: 'var(--grey)', fontSize: 14, zIndex: 10, pointerEvents: 'none',
            }}>
              Upload a file to see your infrastructure on the map
            </div>
          )}
          <MapContainer
            center={mapCenter}
            zoom={15}
            style={{ height: '100%', width: '100%' }}
            key={mapCenter.join(',')}
          >
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            {lines.map((line) =>
              geomToLatLngs(line.geometry).map((positions, i) => (
                <Polyline
                  key={`${line.id}-${i}`}
                  positions={positions}
                  pathOptions={{
                    color: UTILITY_COLORS[line.utilityType] || '#9E9E9E',
                    weight: 3,
                    opacity: 0.85,
                  }}
                />
              ))
            )}
          </MapContainer>
        </div>
      </div>
    </div>
  );
}
