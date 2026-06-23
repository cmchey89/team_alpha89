// app/contractor/draw/page.tsx
'use client';

import { useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import 'leaflet/dist/leaflet.css';
import type { LatLngTuple } from 'leaflet';
import Navbar from '@/components/Navbar';
import { generateDrawingPdf } from '@/lib/pdf/generateDrawingPdf';

// react-leaflet's MapContainer touches `window` at import time, which
// breaks Next.js's server-side render pass. Dynamic-importing with
// ssr: false defers it to the client, same reasoning as any Leaflet-in-
// Next.js setup.
const MapContainer = dynamic(() => import('react-leaflet').then((m) => m.MapContainer), { ssr: false });
const TileLayer = dynamic(() => import('react-leaflet').then((m) => m.TileLayer), { ssr: false });
const ZoneDrawer = dynamic(() => import('@/components/ZoneDrawer'), { ssr: false });

const TAI_SENG_CENTER: LatLngTuple = [1.3358, 103.8879];

type Phase = 'idle' | 'drawing' | 'review' | 'checking' | 'clear' | 'affected_unpaid' | 'affected_paid';

interface CheckResult {
  zoneId: string;
  reference: string;
  cleared: boolean;
  conflictCount: number;
}

// Hardcoded for this MVP — in a multi-owner deployment, the contractor would
// pick which infrastructure owner's baseline to check against (e.g. via a
// dropdown populated from a public "which owners publish a baseline here"
// endpoint). Replace with real owner selection before going beyond a single
// owner pilot.
const OWNER_ID = 'afc4cd7e-153c-47d3-a428-356058108f04';

function shoelaceAreaSqm(points: LatLngTuple[]): number {
  if (points.length < 3) return 0;
  const R = 111320;
  const lat0 = (points[0][0] * Math.PI) / 180;
  const pts = points.map((p) => [p[1] * R * Math.cos(lat0), p[0] * R]);
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.round(Math.abs(sum / 2));
}

export default function ContractorDrawPage() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [points, setPoints] = useState<LatLngTuple[]>([]);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [releaseData, setReleaseData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const handlePointAdded = useCallback((p: LatLngTuple) => {
    setPoints((prev) => [...prev, p]);
  }, []);

  function startDrawing() {
    setPoints([]);
    setResult(null);
    setError(null);
    setPhase('drawing');
  }

  function finishDrawing() {
    if (points.length < 3) return;
    setPhase('review');
  }

  async function submitForCheck() {
    setPhase('checking');
    setError(null);
    try {
      const areaSqm = shoelaceAreaSqm(points);
      const closedRing = [...points.map(([lat, lng]) => [lng, lat]), [points[0][1], points[0][0]]];

      const res = await fetch('/api/zones/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerId: OWNER_ID,
          geometry: { type: 'Polygon', coordinates: [closedRing] },
          areaSqm,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Check failed (${res.status})`);
      }

      const data: CheckResult = await res.json();
      setResult(data);
      setPhase(data.cleared ? 'clear' : 'affected_unpaid');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('review'); // let them retry rather than getting stuck
    }
  }

  async function payWithFomoPay() {
    if (!result) return;
    setError(null);
    try {
      const res = await fetch(`/api/zones/${result.zoneId}/release`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed (${res.status})`);
      }
      const data = await res.json();
      setReleaseData(data);
      setPhase('affected_paid');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function resetAll() {
    setPoints([]);
    setResult(null);
    setReleaseData(null);
    setError(null);
    setPhase('idle');
  }

  return (
    <main style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <Navbar title="Contractor — Draw Zone" />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
      <div className="map-area">
        <MapContainer center={TAI_SENG_CENTER} zoom={16} style={{ height: '100%', width: '100%' }}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <ZoneDrawer
            active={phase === 'drawing'}
            points={points}
            onPointAdded={handlePointAdded}
            onDoubleClickFinish={finishDrawing}
          />
        </MapContainer>

        <div style={{ position: 'absolute', top: 14, right: 14, zIndex: 500, display: 'flex', gap: 8 }}>
          {phase !== 'drawing' ? (
            <button className="map-toolbar-btn" onClick={startDrawing}>Draw working zone</button>
          ) : (
            <button className="map-toolbar-btn" onClick={finishDrawing} disabled={points.length < 3}>
              Done ({points.length} points)
            </button>
          )}
          <button className="map-toolbar-btn" onClick={resetAll}>Clear</button>
        </div>
      </div>

      <aside className="ticket-panel">
        {error && <div className="error-box">{error}</div>}

        {phase === 'idle' && <p>Draw your working zone, then submit it for a check.</p>}

        {phase === 'drawing' && <p>{points.length} point(s) placed. Double-click, or click "Done", to finish.</p>}

        {phase === 'review' && (
          <div>
            <p>Zone vertices: {points.length}</p>
            <p>Approx. area: {shoelaceAreaSqm(points).toLocaleString()} m²</p>
            <button onClick={submitForCheck}>Confirm & submit</button>
            <button onClick={startDrawing}>Redraw zone</button>
          </div>
        )}

        {phase === 'checking' && <p>Checking your zone against our records…</p>}

        {phase === 'clear' && result && (
          <div className="result-clear">
            <h2>CLEAR</h2>
            <p>Reference: {result.reference}</p>
            <p>This is a non-affected work request — no recorded underground utility overlaps this zone.</p>
            <button onClick={resetAll}>Start new zone</button>
          </div>
        )}

        {phase === 'affected_unpaid' && result && (
          <div className="result-affected">
            <h2>AFFECTED</h2>
            <p>Reference: {result.reference}</p>
            <p>
              This zone overlaps {result.conflictCount} underground utility line
              {result.conflictCount > 1 ? 's' : ''} on record.
            </p>
            <button onClick={payWithFomoPay}>View affected lines (test mode)</button>
            <button onClick={startDrawing}>Redraw zone</button>
          </div>
        )}

        {phase === 'affected_paid' && releaseData && (
          <div className="result-affected">
            <h2>AFFECTED</h2>
            <p style={{ fontSize: 13, color: 'var(--grey)' }}>Ref: {result?.reference}</p>
            <button onClick={() => void generateDrawingPdf({
              reference: result!.reference,
              conflicts: releaseData.conflicts,
              zoneGeoJSON: releaseData.zoneGeoJSON,
              contractorEmail: 'cmchey89@gmail.com',
            })}>
              Download Drawing (PDF)
            </button>
            <button onClick={resetAll}>Start new zone</button>
          </div>
        )}
      </aside>
      </div>
    </main>
  );
}
