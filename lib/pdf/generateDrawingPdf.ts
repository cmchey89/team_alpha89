'use client';

import { jsPDF } from 'jspdf';

const UTILITY_COLORS: Record<string, string> = {
  telecom_pipe: '#9C27B0',
  manhole:      '#FF9800',
  other:        '#9E9E9E',
};

const NOTES = [
  "Note 1. Please note that the locations of all BlueTel's plant indicated on the plans are approximate.",
  "Note 2. All BlueTel's plants in the vicinity of intended earth works or development have to be located by exposing the plant through manual digging of trial holes.",
  "Note 3. Plans are not-to-scale.",
  "Note 4. Please note that the pipeline may enter the manholes at a depth of less than 1 metre.",
];

interface Conflict {
  infraLineId: string;
  utilityType: string;
  label: string | null;
  geometry: { type: string; coordinates: any };
}

interface MapView {
  zoom: number;
  bounds: { minLng: number; maxLng: number; minLat: number; maxLat: number };
}

export interface DrawingData {
  reference: string;
  conflicts: Conflict[];
  zoneGeoJSON: { type: string; coordinates: any } | null;
  contractorEmail: string;
  mapView?: MapView;
}

// ---- Tile math ----
function lon2tile(lon: number, z: number) { return Math.floor((lon + 180) / 360 * 2 ** z); }
function lat2tile(lat: number, z: number) { return Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * 2 ** z); }
function tile2lon(x: number, z: number)  { return x / 2 ** z * 360 - 180; }
function tile2lat(y: number, z: number)  { const n = Math.PI - 2 * Math.PI * y / 2 ** z; return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); }

// Web Mercator Y (same as OSM tiles)
function latMerc(lat: number) { const r = lat * Math.PI / 180; return Math.log(Math.tan(Math.PI / 4 + r / 2)); }

// ---- Helpers ----
function hexToRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)];
}
function collectLine(g: { type: string; coordinates: any }): number[][] {
  if (g.type === 'LineString') return g.coordinates;
  if (g.type === 'MultiLineString') return g.coordinates.flat(1);
  return [];
}
function collectPoly(g: { type: string; coordinates: any }): number[][] {
  if (g.type === 'Polygon') return g.coordinates[0] ?? [];
  return [];
}

// Fetch one tile as data-URL via our proxy, with a timeout
async function fetchTileDataUrl(z: number, x: number, y: number): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(`/api/tiles/${z}/${x}/${y}`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const blob = await res.blob();
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('FileReader failed'));
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

// Draw all OSM tiles in parallel
async function drawOsmTiles(
  doc: jsPDF,
  mapX: number, mapY: number, mapW: number, mapH: number,
  minLng: number, maxLng: number,
  mercMin: number, mercMax: number,  // pre-computed Mercator bounds
  zoom: number,
) {
  const minLat = (2 * Math.atan(Math.exp(mercMin)) - Math.PI / 2) * 180 / Math.PI;
  const maxLat = (2 * Math.atan(Math.exp(mercMax)) - Math.PI / 2) * 180 / Math.PI;

  const txMin = lon2tile(minLng, zoom);
  const txMax = lon2tile(maxLng, zoom);
  const tyMin = lat2tile(maxLat, zoom);
  const tyMax = lat2tile(minLat, zoom);

  // Build all tile fetch jobs
  const jobs: { tx: number; ty: number; promise: Promise<string | null> }[] = [];
  for (let tx = txMin; tx <= txMax; tx++) {
    for (let ty = tyMin; ty <= tyMax; ty++) {
      jobs.push({ tx, ty, promise: fetchTileDataUrl(zoom, tx, ty) });
    }
  }

  // Await all in parallel
  const results = await Promise.all(jobs.map(j => j.promise));

  const lngSpan  = maxLng - minLng;
  const mercSpan = mercMax - mercMin;

  results.forEach((dataUrl, i) => {
    if (!dataUrl) return;
    const { tx, ty } = jobs[i];
    const tileLngMin = tile2lon(tx,     zoom);
    const tileLngMax = tile2lon(tx + 1, zoom);
    const tileLatTop = tile2lat(ty,     zoom);
    const tileLatBot = tile2lat(ty + 1, zoom);

    // X: linear longitude
    const x = mapX + ((tileLngMin - minLng) / lngSpan) * mapW;
    const w = ((tileLngMax - tileLngMin) / lngSpan) * mapW;

    // Y: Mercator
    const tileMercTop = latMerc(tileLatTop);
    const tileMercBot = latMerc(tileLatBot);
    const y = mapY + ((mercMax - tileMercTop) / mercSpan) * mapH;
    const h = ((tileMercTop - tileMercBot) / mercSpan) * mapH;

    try { doc.addImage(dataUrl, 'PNG', x, y, w, h); } catch { /* skip bad tile */ }
  });
}

// Draw a filled triangle without relying on doc.triangle (not always available in ESM builds)
function drawFilledTriangle(doc: jsPDF, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) {
  doc.lines([[x2 - x1, y2 - y1], [x3 - x2, y3 - y2], [x1 - x3, y1 - y3]], x1, y1, [1, 1], 'F', true);
}

// Trigger download without relying on doc.save() (which can be blocked after long async work)
function downloadBlob(doc: jsPDF, filename: string) {
  const blob = doc.output('blob');
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
}

// ============================================================
// Main export
// ============================================================
export async function generateDrawingPdf(data: DrawingData) {
  try {
    await _generate(data);
  } catch (err) {
    console.error('[PDF]', err);
    alert('PDF generation failed:\n' + (err instanceof Error ? err.message : String(err)));
  }
}

async function _generate(data: DrawingData) {
  // ---- Page setup ----
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a3' });
  const PW  = doc.internal.pageSize.getWidth();   // ~1190.55 pt
  const PH  = doc.internal.pageSize.getHeight();  // ~841.89 pt

  const MARGIN   = 18;
  const BANNER_W = 160;
  const TITLE_H  = 56;
  const PAD      = 6;

  const frameX = MARGIN,         frameY = MARGIN;
  const frameW = PW - MARGIN*2,  frameH = PH - MARGIN*2;
  const innerX = frameX + PAD,   innerY = frameY + PAD;
  const innerW = frameW - PAD*2, innerH = frameH - PAD*2;

  const mapX = innerX;
  const mapY = innerY + TITLE_H;
  const mapW = innerW - BANNER_W;
  const mapH = innerH - TITLE_H;

  const bx = innerX + innerW - BANNER_W;
  const bw = BANNER_W;
  const by = mapY;
  const bh = mapH;

  // ---- Collect all coordinates ----
  const allCoords: number[][] = [];
  if (data.zoneGeoJSON) allCoords.push(...collectPoly(data.zoneGeoJSON));
  for (const c of data.conflicts) allCoords.push(...collectLine(c.geometry));

  if (allCoords.length === 0) {
    alert('No geometry found — cannot generate drawing.');
    return;
  }

  // ---- Build padded bounding box ----
  let minLng = Math.min(...allCoords.map(c => c[0]));
  let maxLng = Math.max(...allCoords.map(c => c[0]));
  let minLat = Math.min(...allCoords.map(c => c[1]));
  let maxLat = Math.max(...allCoords.map(c => c[1]));

  const padLng = Math.max((maxLng - minLng) * 0.4, 0.003);
  const padLat = Math.max((maxLat - minLat) * 0.4, 0.003);
  minLng -= padLng; maxLng += padLng;
  minLat -= padLat; maxLat += padLat;

  // ---- Correct aspect ratio using Mercator ----
  let mercMin = latMerc(minLat);
  let mercMax = latMerc(maxLat);

  const lngSpanDeg  = maxLng - minLng;
  const mercSpan    = mercMax - mercMin;
  const pageRatio   = mapW / mapH;

  // Both axes must be in the same unit for a valid ratio comparison.
  // Web Mercator X = lng × π/180 (radians), Y = latMerc (also radians).
  // Longitude degrees → Mercator radians: multiply by π/180.
  const lngSpanMerc  = lngSpanDeg * Math.PI / 180;
  const naturalRatio = lngSpanMerc / mercSpan;

  if (naturalRatio > pageRatio) {
    // bbox wider than page — expand vertically in Mercator
    const targetMercSpan = lngSpanMerc / pageRatio;
    const midMerc = (mercMin + mercMax) / 2;
    mercMin = midMerc - targetMercSpan / 2;
    mercMax = midMerc + targetMercSpan / 2;
    minLat  = (2 * Math.atan(Math.exp(mercMin)) - Math.PI / 2) * 180 / Math.PI;
    maxLat  = (2 * Math.atan(Math.exp(mercMax)) - Math.PI / 2) * 180 / Math.PI;
  } else {
    // bbox taller than page — expand horizontally (convert Mercator back to degrees)
    const targetLngSpan = (mercSpan * pageRatio) * 180 / Math.PI;
    const midLng = (minLng + maxLng) / 2;
    minLng = midLng - targetLngSpan / 2;
    maxLng = midLng + targetLngSpan / 2;
  }

  // Re-compute final Mercator bounds after adjustment
  mercMin = latMerc(minLat);
  mercMax = latMerc(maxLat);

  // ---- Projection helper ----
  function project(lng: number, lat: number): [number, number] {
    const x = mapX + ((lng - minLng) / (maxLng - minLng)) * mapW;
    const y = mapY + ((mercMax - latMerc(lat)) / (mercMax - mercMin)) * mapH;
    return [x, y];
  }

  // ---- Tile zoom ----
  const tileZoom = Math.min(18, Math.max(15, data.mapView?.zoom ?? 17));

  // ============================================================
  // DRAW PAGE
  // ============================================================

  // White background
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, PW, PH, 'F');

  // Double border
  doc.setDrawColor(20, 20, 20);
  doc.setLineWidth(1.4);
  doc.rect(frameX, frameY, frameW, frameH);
  doc.setLineWidth(0.5);
  doc.rect(innerX, innerY, innerW, innerH);

  // Title strip
  doc.setLineWidth(0.6);
  doc.line(innerX, innerY + TITLE_H, innerX + innerW, innerY + TITLE_H);

  doc.setFont('helvetica', 'bold'); doc.setFontSize(18);
  doc.setTextColor(20, 20, 20);
  doc.text('DIGCLEAR — UNDERGROUND UTILITY CLEARANCE DRAWING', innerX + 10, innerY + 20);

  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  doc.setTextColor(80, 80, 80);
  const affected = data.conflicts.length;
  doc.text(
    affected === 0
      ? 'RESULT: CLEAR — no recorded underground utility overlaps this working zone'
      : `RESULT: AFFECTED — overlaps ${affected} recorded utility line${affected !== 1 ? 's' : ''}, shown on map`,
    innerX + 10, innerY + 36,
  );
  doc.text('Tai Seng, Singapore  ·  Datum: SVY21', innerX + 10, innerY + 49);

  // Map white bg
  doc.setFillColor(255, 255, 255);
  doc.rect(mapX, mapY, mapW, mapH, 'F');

  // ---- Fetch & draw OSM tiles (parallel) ----
  await drawOsmTiles(doc, mapX, mapY, mapW, mapH, minLng, maxLng, mercMin, mercMax, tileZoom);

  // Mask tile bleed outside map rect
  doc.setFillColor(255, 255, 255);
  doc.rect(0,          0,          mapX,              PH, 'F');
  doc.rect(mapX + mapW, 0,         PW - mapX - mapW,  PH, 'F');
  doc.rect(0,          0,          PW,                mapY, 'F');
  doc.rect(0,          mapY + mapH, PW,               PH - mapY - mapH, 'F');

  // Map border
  doc.setDrawColor(20, 20, 20);
  doc.setLineWidth(0.5);
  doc.rect(mapX, mapY, mapW, mapH, 'S');

  // ---- Work zone polygon ----
  if (data.zoneGeoJSON) {
    const coords = collectPoly(data.zoneGeoJSON);
    if (coords.length >= 3) {
      const pts = coords.map(([lng, lat]) => project(lng, lat));
      doc.setDrawColor(58, 125, 92);
      doc.setLineWidth(2.0);
      for (let i = 0; i < pts.length - 1; i++) doc.line(pts[i][0], pts[i][1], pts[i+1][0], pts[i+1][1]);
      doc.line(pts[pts.length-1][0], pts[pts.length-1][1], pts[0][0], pts[0][1]);
      const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
      const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7);
      doc.setTextColor(40, 120, 80);
      doc.text('WORK ZONE', cx, cy, { align: 'center' });
    }
  }

  // ---- Conflict lines ----
  for (const c of data.conflicts) {
    const coords = collectLine(c.geometry);
    if (coords.length < 2) continue;
    const [r, g, b] = hexToRgb(UTILITY_COLORS[c.utilityType] ?? '#9E9E9E');
    doc.setDrawColor(r, g, b);
    doc.setLineWidth(2.5);
    const pts = coords.map(([lng, lat]: number[]) => project(lng, lat));
    for (let i = 0; i < pts.length - 1; i++) doc.line(pts[i][0], pts[i][1], pts[i+1][0], pts[i+1][1]);
  }

  // ---- North arrow ----
  const nx = mapX + mapW - 16, ny = mapY + 16;
  doc.setDrawColor(40, 40, 40); doc.setFillColor(40, 40, 40); doc.setLineWidth(0.6);
  doc.line(nx, ny + 8, nx, ny - 6);
  drawFilledTriangle(doc, nx - 3, ny - 2, nx + 3, ny - 2, nx, ny - 9);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7);
  doc.setTextColor(40, 40, 40);
  doc.text('N', nx, ny - 12, { align: 'center' });

  // ---- Scale bar ----
  const scaleY = mapY + mapH - 8, scaleX = mapX + 10;
  const mPerPt = ((maxLng - minLng) / mapW) * 111320;
  const barPt  = 50;
  const barM   = Math.round(mPerPt * barPt / 10) * 10;
  doc.setDrawColor(40, 40, 40); doc.setLineWidth(0.5);
  doc.line(scaleX, scaleY, scaleX + barPt, scaleY);
  doc.line(scaleX,         scaleY - 2, scaleX,         scaleY + 2);
  doc.line(scaleX + barPt, scaleY - 2, scaleX + barPt, scaleY + 2);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5);
  doc.setTextColor(40, 40, 40);
  doc.text('0', scaleX, scaleY + 6, { align: 'center' });
  doc.text(`${barM} m`, scaleX + barPt, scaleY + 6, { align: 'center' });

  // ============================================================
  // RIGHT-HAND BANNER
  // ============================================================
  doc.setFillColor(255, 255, 255);
  doc.rect(bx, by, bw, bh, 'F');
  doc.setDrawColor(20, 20, 20); doc.setLineWidth(0.5);
  doc.rect(bx, by, bw, bh, 'S');

  const labelClr: [number,number,number] = [110, 115, 112];
  const valueClr: [number,number,number] = [20,  20,  20 ];
  const divClr:   [number,number,number] = [210, 210, 208];

  const CELL_H = 46, BLOCK_H = 26;
  let cy = by;

  function bannerField(label: string, value: string) {
    const top = cy + (CELL_H - BLOCK_H) / 2;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    doc.setTextColor(...labelClr);
    doc.text(label.toUpperCase(), bx + 10, top + 8);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
    doc.setTextColor(...valueClr);
    doc.text(value, bx + 10, top + 21, { maxWidth: bw - 14 });
    cy += CELL_H;
    doc.setDrawColor(...divClr); doc.setLineWidth(0.3);
    doc.line(bx, cy, bx + bw, cy);
  }

  const submitter = data.contractorEmail ? data.contractorEmail.split('@')[0].toUpperCase() : 'CONTRACTOR';
  bannerField('Reference',    data.reference);
  bannerField('Status',       affected === 0 ? 'CLEAR' : 'AFFECTED');
  bannerField('Submitted by', submitter);
  bannerField('Date',         new Date().toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' }));
  bannerField('Paid via',     'FOMO Pay');

  // Legend
  cy += 4;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
  doc.setTextColor(...labelClr);
  doc.text('LEGEND', bx + 10, cy + 10);
  cy += 18;

  const SW = 14, SH = 8;
  doc.setFillColor(58, 125, 92);
  doc.rect(bx + 10, cy - 6, SW, SH, 'F');
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.setTextColor(...valueClr);
  doc.text('Working zone', bx + 10 + SW + 5, cy);
  cy += 14;

  if (affected > 0) {
    const [sr, sg, sb] = hexToRgb(UTILITY_COLORS[data.conflicts[0].utilityType] ?? '#9E9E9E');
    doc.setFillColor(sr, sg, sb);
    doc.rect(bx + 10, cy - 6, SW, SH, 'F');
    doc.setFontSize(9); doc.setTextColor(...valueClr);
    doc.text('Affected utility line', bx + 10 + SW + 5, cy);
    cy += 14;
  }

  // Notes
  cy += 6;
  doc.setDrawColor(...divClr); doc.setLineWidth(0.3);
  doc.line(bx, cy, bx + bw, cy);
  cy += 10;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
  doc.setTextColor(...labelClr);
  doc.text('NOTES', bx + 10, cy);
  cy += 10;

  for (const note of NOTES) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    doc.setTextColor(...valueClr);
    const lines = doc.splitTextToSize(note, bw - 16);
    doc.text(lines, bx + 10, cy);
    cy += lines.length * 10 + 4;
  }

  // ---- Download ----
  downloadBlob(doc, `DigClear-${data.reference}.pdf`);
}
