// app/contractor/draw/page.tsx
'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import 'leaflet/dist/leaflet.css';
import type { LatLngTuple } from 'leaflet';
import type L from 'leaflet';
import { generateDrawingPdf } from '@/lib/pdf/generateDrawingPdf';
import type { MapView } from '@/components/MapTracker';
import type { DrawnLine } from '@/components/LineDrawer';

const MapContainer = dynamic(() => import('react-leaflet').then((m) => m.MapContainer), { ssr: false });
const TileLayer    = dynamic(() => import('react-leaflet').then((m) => m.TileLayer), { ssr: false });
const ZoneDrawer   = dynamic(() => import('@/components/ZoneDrawer'), { ssr: false });
const LineDrawer   = dynamic(() => import('@/components/LineDrawer'), { ssr: false });
const MapTracker   = dynamic(() => import('@/components/MapTracker'), { ssr: false });
const MapSearch    = dynamic(() => import('@/components/MapSearch'), { ssr: false });
const MapFreezer   = dynamic(() => import('@/components/MapFreezer'), { ssr: false });
const MapCapture   = dynamic(() => import('@/components/MapCapture'), { ssr: false });

const TAI_SENG_CENTER: LatLngTuple = [1.3358, 103.8879];
const OWNER_ID = process.env.NEXT_PUBLIC_OWNER_ID ?? 'afc4cd7e-153c-47d3-a428-356058108f04';
if (!process.env.NEXT_PUBLIC_OWNER_ID) {
  console.warn('[DigClear] NEXT_PUBLIC_OWNER_ID is not set — using hardcoded fallback UUID. Add it to Vercel environment variables.');
}

type Phase = 'idle' | 'drawing' | 'review' | 'checking' | 'clear' | 'affected_unpaid' | 'affected_paid';

interface CheckResult {
  zoneId: string;
  reference: string;
  cleared: boolean;
  conflictCount: number;
}

interface Conflict {
  infraLineId: string;
  utilityType: string;
  label: string | null;
  geometry: { type: string; coordinates: unknown };
}

interface ReleaseData {
  conflicts: Conflict[];
  zoneGeoJSON: { type: string; coordinates: unknown } | null;
}

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

/* ---- FOMO Pay modal ---- */
function FomoPayModal({
  reference,
  onSuccess,
  onClose,
}: {
  reference: string;
  onSuccess: () => void;
  onClose: () => void;
}) {
  const [processing, setProcessing] = useState(false);

  function handlePay() {
    setProcessing(true);
    setTimeout(() => {
      onSuccess();
    }, 1400);
  }

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget && !processing) onClose(); }}>
      <div className="modal-box">
        {!processing ? (
          <>
            <div className="modal-eyebrow">Affected work request payment</div>
            <h2 className="modal-title">Pay to receive drawing</h2>
            <p className="modal-sub">
              SGD 45.00 — detailed drawing of underground utilities affected by working zone {reference}.
            </p>
            <div className="fomo-logo">FOMO<span style={{ color: 'var(--paper)' }}>Pay</span></div>
            <p className="help-text">You'll be redirected to FOMO Pay's secure checkout to complete this payment.</p>
            <div className="fomo-methods">
              {['VISA', 'Mastercard', 'PayNow', 'Alipay', 'WeChat Pay'].map((m) => (
                <span key={m} className="fomo-method">{m}</span>
              ))}
            </div>
            <button className="btn btn-fomo" onClick={handlePay}>Continue to FOMO Pay →</button>
            <div className="modal-foot">Demo mode — simulated redirect, no real FOMO Pay session is created.</div>
          </>
        ) : (
          <>
            <div className="fomo-logo" style={{ marginTop: 10 }}>FOMO<span style={{ color: 'var(--paper)' }}>Pay</span></div>
            <div className="fomo-spinner" />
            <p className="help-text">Processing payment of SGD 45.00…</p>
          </>
        )}
      </div>
    </div>
  );
}

export default function ContractorDrawPage() {
  const router = useRouter();
  const mapRef = useRef<L.Map | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [points, setPoints] = useState<LatLngTuple[]>([]);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [releaseData, setReleaseData] = useState<ReleaseData | null>(null);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [mapView, setMapView] = useState<MapView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showFomo, setShowFomo] = useState(false);
  const [userEmail, setUserEmail] = useState<string>('');
  const [authChecked, setAuthChecked] = useState(false);
  const [drawTool, setDrawTool] = useState<'zone' | 'line'>('zone');
  const [lines, setLines] = useState<DrawnLine[]>([]);
  const [currentLinePoints, setCurrentLinePoints] = useState<LatLngTuple[]>([]);

  // Auth guard — redirect to login if no valid session
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/auth/me');
        if (r.status === 401) { router.replace('/login'); return; }
        const d = await r.json();
        if (d?.email) setUserEmail(d.email);
        setAuthChecked(true);
      } catch {
        router.replace('/login');
      }
    })();
  }, [router]);

  const handlePointAdded = useCallback((p: LatLngTuple) => {
    setPoints((prev) => [...prev, p]);
  }, []);

  const handlePointMoved = useCallback((index: number, p: LatLngTuple) => {
    setPoints((prev) => prev.map((pt, i) => (i === index ? p : pt)));
  }, []);

  const handlePointDeleted = useCallback((index: number) => {
    setPoints((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleUndo = useCallback(() => {
    setPoints((prev) => prev.slice(0, -1));
  }, []);

  const handleLinePointAdded = useCallback((p: LatLngTuple) => {
    setCurrentLinePoints((prev) => [...prev, p]);
  }, []);

  const handleLineFinished = useCallback(() => {
    setCurrentLinePoints((prev) => {
      if (prev.length >= 2) setLines((ls) => [...ls, { points: prev }]);
      return [];
    });
  }, []);

  if (!authChecked) return null;

  function startDrawing() {
    mapRef.current?.dragging.disable();
    setPoints([]);
    setLines([]);
    setCurrentLinePoints([]);
    setDrawTool('zone');
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
      setPhase('review');
    }
  }

  async function releaseDrawing() {
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
    mapRef.current?.dragging.enable();
    setPoints([]);
    setLines([]);
    setCurrentLinePoints([]);
    setDrawTool('zone');
    setResult(null);
    setReleaseData(null);
    setError(null);
    setPhase('idle');
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      {/* ---- Title bar ---- */}
      <nav className="titleblock">
        <div className="tb-left">
          <div className="logo"><span className="logo-dot" />DIGCLEAR</div>
          <div className="mode-pill contractor">CONTRACTOR VIEW</div>
        </div>
        <div className="tb-right">
          {userEmail && (
            <div className="user-chip">
              <span className="pulse-dot" />
              <span className="who">{userEmail}</span>
            </div>
          )}
          <button
            className="text-btn"
            onClick={async () => {
              await fetch('/api/auth/logout', { method: 'POST' });
              window.location.href = '/login';
            }}
          >
            Sign out
          </button>
        </div>
      </nav>

      {/* ---- Main ---- */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>

        {/* ---- Map ---- */}
        <div className="map-area">
          <MapContainer
            center={TAI_SENG_CENTER}
            zoom={17}
            minZoom={16}
            maxZoom={18}
            scrollWheelZoom={false}
            doubleClickZoom={false}
            zoomControl={false}
            style={{ height: '100%', width: '100%' }}
          >
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <MapCapture onMap={(m) => { mapRef.current = m; }} />
            <MapFreezer frozen={phase !== 'idle'} />
            <MapSearch disabled={phase !== 'idle'} />
            <ZoneDrawer
              active={phase === 'drawing' && drawTool === 'zone'}
              frozen={phase !== 'idle'}
              points={points}
              onPointAdded={handlePointAdded}
              onPointMoved={handlePointMoved}
              onPointDeleted={handlePointDeleted}
              onDoubleClickFinish={finishDrawing}
            />
            <LineDrawer
              active={phase === 'drawing' && drawTool === 'line'}
              lines={lines}
              currentPoints={currentLinePoints}
              onPointAdded={handleLinePointAdded}
              onLineFinished={handleLineFinished}
            />
            <MapTracker onChange={setMapView} />
          </MapContainer>

          {/* Legend — bottom-right */}
          <div className="map-legend">
            <div className="map-legend-title">Legend</div>
            <div className="map-legend-row">
              <span className="map-legend-swatch" style={{ background: '#FF1744' }} />
              Working zone
            </div>
            {lines.length > 0 && (
              <div className="map-legend-row">
                <span className="map-legend-swatch" style={{ background: 'rgb(255,0,255)' }} />
                Work line
              </div>
            )}
            {(phase === 'affected_unpaid' || phase === 'affected_paid') && (
              <div className="map-legend-row">
                <span className="map-legend-swatch" style={{ background: '#9C27B0' }} />
                Telecom pipe
              </div>
            )}
          </div>

          {/* Scale strip — bottom-left */}
          <div className="scale-strip">DIGCLEAR &nbsp;·&nbsp; SVY21 DATUM</div>
        </div>

        {/* ---- Ticket panel ---- */}
        <div className="ticket-panel" style={{ display: 'flex', flexDirection: 'column' }}>
          {error && <div className="error-box">{error}</div>}

          {phase === 'idle' && (
            <>
              <div className="ticket-header">
                <div className="eyebrow">Work request</div>
                <h2>Draw your zone</h2>
              </div>
              <div className="ticket-body">
                <p className="step-empty">
                  Pan the map to your work area, then click Draw Zone to lock the map and start placing points.
                </p>
                <div className="step-list">
                  <div className="step-item"><span className="step-num">1</span>Pan to your work area</div>
                  <div className="step-item"><span className="step-num">2</span>Draw your zone</div>
                </div>
                <button className="btn btn-primary" onClick={startDrawing}>▱ Draw zone</button>
              </div>
            </>
          )}

          {phase === 'drawing' && (
            <>
              <div className="ticket-header">
                <div className="eyebrow">Work request</div>
                <h2>{drawTool === 'zone' ? 'Drawing zone…' : 'Drawing line…'}</h2>
              </div>
              <div className="ticket-body">
                {/* Tool toggle */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                  <button
                    className={`btn btn-sm ${drawTool === 'zone' ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setDrawTool('zone')}
                  >
                    ▱ Zone
                  </button>
                  <button
                    className={`btn btn-sm ${drawTool === 'line' ? 'btn-primary' : 'btn-ghost'}`}
                    style={drawTool === 'line' ? { background: 'rgb(180,0,180)', borderColor: 'rgb(180,0,180)' } : {}}
                    onClick={() => { handleLineFinished(); setDrawTool('line'); }}
                  >
                    ╱ Line
                  </button>
                </div>

                {drawTool === 'zone' && (
                  <>
                    <div className="field-row">
                      <span className="k">Zone points</span>
                      <span className="v">{points.length}</span>
                    </div>
                    <p className="step-empty" style={{ marginTop: 12 }}>
                      Click to add points. <strong>Right-click</strong> a dot to delete it. Drag to reposition. Double-click to finish.
                    </p>
                    <button
                      className="btn btn-primary"
                      onClick={finishDrawing}
                      disabled={points.length < 3}
                    >
                      ✓ Done ({points.length} points)
                    </button>
                    <button className="btn btn-ghost" onClick={handleUndo} disabled={points.length === 0}>↩ Undo last point</button>
                  </>
                )}

                {drawTool === 'line' && (
                  <>
                    <div className="field-row">
                      <span className="k">Lines drawn</span>
                      <span className="v">{lines.length}</span>
                    </div>
                    <div className="field-row">
                      <span className="k">Current points</span>
                      <span className="v">{currentLinePoints.length}</span>
                    </div>
                    <p className="step-empty" style={{ marginTop: 12 }}>
                      Click to place points. Double-click to finish a line segment. You can draw multiple lines.
                    </p>
                    <button
                      className="btn btn-ghost"
                      onClick={handleLineFinished}
                      disabled={currentLinePoints.length < 2}
                    >
                      ✓ Finish line
                    </button>
                  </>
                )}

                <button className="btn btn-ghost" onClick={resetAll}>✕ Clear all</button>
              </div>
            </>
          )}

          {phase === 'review' && (
            <>
              <div className="ticket-header">
                <div className="eyebrow">Work request</div>
                <h2>Review your zone</h2>
              </div>
              <div className="ticket-body">
                <div className="field-row"><span className="k">Zone vertices</span><span className="v">{points.length}</span></div>
                <p className="step-empty" style={{ marginTop: 12 }}>
                  Confirm to submit this zone for a check against our records, or redraw it.
                </p>
                <button className="btn btn-primary" onClick={submitForCheck}>Confirm &amp; submit</button>
                <button className="btn btn-ghost" onClick={startDrawing}>Redraw zone</button>
                <button className="btn btn-ghost" onClick={resetAll}>✕ Clear</button>
              </div>
            </>
          )}

          {phase === 'checking' && (
            <>
              <div className="ticket-header">
                <div className="eyebrow">Work request</div>
                <h2>Checking…</h2>
              </div>
              <div className="ticket-body">
                <p className="step-empty"><span className="pulse-dot" style={{ marginRight: 8 }} />Comparing your working zone against our records.</p>
              </div>
            </>
          )}

          {phase === 'clear' && result && (
            <>
              <div className="ticket-header">
                <div className="eyebrow">Work request — checked</div>
                <h2>Result</h2>
              </div>
              <div className="ticket-body">
                <div className="field-row"><span className="k">Zone vertices</span><span className="v">{points.length}</span></div>
                <div className="field-row"><span className="k">Reference</span><span className="v">{result.reference}</span></div>
                <div className="stamp-wrap"><div className="stamp">CLEAR</div></div>
                <div style={{ marginTop: 32 }}>
                  <div className="risk-banner safe">
                    <span className="risk-icon">✓</span>
                    <div>This is a <strong>non-affected work request</strong>. Your working zone does not overlap with any underground utility infrastructure on record.</div>
                  </div>
                </div>
                <button className="btn btn-ghost" onClick={resetAll}>Start new zone</button>
              </div>
            </>
          )}

          {phase === 'affected_unpaid' && result && (
            <>
              <div className="ticket-header">
                <div className="eyebrow">Work request — checked</div>
                <h2>Result</h2>
              </div>
              <div className="ticket-body">
                <div className="field-row"><span className="k">Zone vertices</span><span className="v">{points.length}</span></div>
                <div className="field-row"><span className="k">Reference</span><span className="v">{result.reference}</span></div>
                <div className="stamp-wrap"><div className="stamp risk">AFFECTED</div></div>
                <div style={{ marginTop: 32 }}>
                  <div className="risk-banner danger">
                    <span className="risk-icon">⚠</span>
                    <div>This is an <strong>affected work request</strong>. Pay the drawing fee to see the affected utilities and download the drawing.</div>
                  </div>
                </div>
                <div className="price-line">
                  <span className="label">Drawing fee</span>
                  <span className="amount">SGD 45.00</span>
                </div>
                <button className="btn btn-fomo" onClick={() => setShowFomo(true)}>Pay with FOMO Pay</button>
                <button className="btn btn-ghost" onClick={startDrawing}>Redraw zone</button>
              </div>
            </>
          )}

          {phase === 'affected_paid' && releaseData && result && (
            <>
              <div className="ticket-header">
                <div className="eyebrow">Work request — PAID</div>
                <h2>Drawing released</h2>
              </div>
              <div className="ticket-body">
                <div className="field-row"><span className="k">Reference</span><span className="v">{result.reference}</span></div>
                <div className="field-row"><span className="k">Paid via</span><span className="v">FOMO Pay</span></div>
                <div className="stamp-wrap"><div className="stamp risk">AFFECTED</div></div>
                <div style={{ marginTop: 32 }}>
                  <div className="risk-banner danger">
                    <span className="risk-icon">⚠</span>
                    <div>Payment received. Download your drawing below. Please comply all Earthworks Requirements by IMDA before commence any earthworks.</div>
                  </div>
                </div>
                <div className="download-row" style={{ marginTop: 14 }}>
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={generatingPdf}
                    onClick={async () => {
                      setGeneratingPdf(true);
                      setError(null);
                      try {
                        await generateDrawingPdf({
                          reference: result.reference,
                          conflicts: releaseData.conflicts,
                          zoneGeoJSON: releaseData.zoneGeoJSON,
                          contractorEmail: userEmail,
                          mapView: mapView ?? undefined,
                        });
                      } catch (e) {
                        setError(e instanceof Error ? e.message : 'PDF generation failed.');
                      } finally {
                        setGeneratingPdf(false);
                      }
                    }}
                  >
                    {generatingPdf ? 'Generating…' : 'Download drawing (PDF)'}
                  </button>
                </div>
                <button className="btn btn-ghost" onClick={resetAll}>Start new zone</button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ---- FOMO Pay modal ---- */}
      {showFomo && result && (
        <FomoPayModal
          reference={result.reference}
          onClose={() => setShowFomo(false)}
          onSuccess={() => {
            setShowFomo(false);
            releaseDrawing();
          }}
        />
      )}
    </div>
  );
}
