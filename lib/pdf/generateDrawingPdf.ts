'use client';

import { jsPDF } from 'jspdf';

const UTILITY_COLORS: Record<string, string> = {
  telecom_pipe: '#9C27B0',
  manhole:      '#FF9800',
  other:        '#9E9E9E',
};

const UTILITY_LABELS: Record<string, string> = {
  telecom_pipe: 'Telecom Pipe',
  manhole:      'Manhole',
  other:        'Other',
};

const NOTES = [
  'Note 1. Please note that the locations of all BlueTel\'s plant indicated on the plans are approximate.',
  'Note 2. All BlueTel\'s plants in the vicinity of intended earth works or development have to be located by exposing the plant through manual digging of trial holes.',
  'Note 3. Plans are not-to-scale.',
  'Note 4. Please note that the pipeline may enter the manholes at a depth of less than 1 metre.',
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

interface DrawingData {
  reference: string;
  conflicts: Conflict[];
  zoneGeoJSON: { type: string; coordinates: any } | null;
  contractorEmail: string;
  mapView?: MapView;
}

function lon2tile(lon: number, zoom: number) { return Math.floor((lon + 180) / 360 * Math.pow(2, zoom)); }
function lat2tile(lat: number, zoom: number) { return Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom)); }
function tile2lon(x: number, zoom: number) { return x / Math.pow(2, zoom) * 360 - 180; }
function tile2lat(y: number, zoom: number) { const n = Math.PI - 2 * Math.PI * y / Math.pow(2, zoom); return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); }

async function drawOsmTiles(
  doc: jsPDF,
  mapX: number, mapY: number, mapW: number, mapH: number,
  minLng: number, maxLng: number, minLat: number, maxLat: number,
  zoom: number
) {
  const tileXmin = lon2tile(minLng, zoom);
  const tileXmax = lon2tile(maxLng, zoom);
  const tileYmin = lat2tile(maxLat, zoom);
  const tileYmax = lat2tile(minLat, zoom);
  const lngSpan = maxLng - minLng;
  const latSpan = maxLat - minLat;

  for (let tx = tileXmin; tx <= tileXmax; tx++) {
    for (let ty = tileYmin; ty <= tileYmax; ty++) {
      try {
        const url = `/api/tiles/${zoom}/${tx}/${ty}`;
        const resp = await fetch(url);
        if (!resp.ok) continue;
        const blob = await resp.blob();
        const dataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
        const tileLngMin = tile2lon(tx, zoom);
        const tileLngMax = tile2lon(tx + 1, zoom);
        const tileLatMax = tile2lat(ty, zoom);
        const tileLatMin = tile2lat(ty + 1, zoom);
        const x = mapX + ((tileLngMin - minLng) / lngSpan) * mapW;
        const y = mapY + ((maxLat - tileLatMax) / latSpan) * mapH;
        const w = ((tileLngMax - tileLngMin) / lngSpan) * mapW;
        const h = ((tileLatMax - tileLatMin) / latSpan) * mapH;
        doc.addImage(dataUrl, 'PNG', x, y, w, h);
      } catch {
        // skip failed tiles
      }
    }
  }
}

function hexToRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function collectCoords(geojson: { type: string; coordinates: any }): number[][] {
  if (geojson.type === 'LineString') return geojson.coordinates;
  if (geojson.type === 'MultiLineString') return geojson.coordinates.flat();
  return [];
}

function collectPolygonCoords(geojson: { type: string; coordinates: any }): number[][] {
  if (geojson.type === 'Polygon') return geojson.coordinates[0];
  return [];
}

export async function generateDrawingPdf(data: DrawingData) {
  try {
  return await _generateDrawingPdf(data);
  } catch (err) {
    console.error('[PDF] generation failed:', err);
    alert('PDF generation failed: ' + (err instanceof Error ? err.message : String(err)));
  }
}

async function _generateDrawingPdf(data: DrawingData) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a3' });
  const PW = doc.internal.pageSize.getWidth();   // ~1190.55 pt
  const PH = doc.internal.pageSize.getHeight();  // ~841.89 pt

  // Layout constants
  const MARGIN    = 18;
  const BANNER_W  = 160;
  const TITLE_H   = 56;
  const INNER_PAD = 6;

  const frameX = MARGIN, frameY = MARGIN;
  const frameW = PW - MARGIN * 2, frameH = PH - MARGIN * 2;
  const innerX = frameX + INNER_PAD, innerY = frameY + INNER_PAD;
  const innerW = frameW - INNER_PAD * 2, innerH = frameH - INNER_PAD * 2;

  const mapX = innerX;
  const mapY = innerY + TITLE_H;
  const mapW = innerW - BANNER_W;
  const mapH = innerH - TITLE_H;

  const bx = innerX + innerW - BANNER_W;
  const by = mapY;        // starts at same top edge as the map
  const bw = BANNER_W;
  const bh = mapH;        // same height as the map

  // --- Bounding box: always use zone + conflicts, padded ---
  // Never use the raw user view bounds (prevents whole-Singapore drawings)
  const allCoords: number[][] = [];
  if (data.zoneGeoJSON) allCoords.push(...collectPolygonCoords(data.zoneGeoJSON));
  for (const c of data.conflicts) allCoords.push(...collectCoords(c.geometry));
  if (allCoords.length === 0) return;

  const lngs = allCoords.map((c) => c[0]);
  const lats  = allCoords.map((c) => c[1]);
  let minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  let minLat = Math.min(...lats),  maxLat  = Math.max(...lats);
  const padLng = Math.max((maxLng - minLng) * 0.4, 0.003);
  const padLat = Math.max((maxLat - minLat) * 0.4, 0.003);
  minLng -= padLng; maxLng += padLng;
  minLat -= padLat; maxLat += padLat;

  // Tile zoom: clamp to street level
  const rawZoom = data.mapView?.zoom ?? 17;
  const tileZoom = Math.min(19, Math.max(15, rawZoom));

  // Web Mercator helpers — same projection OSM tiles use, so overlay matches tiles exactly
  function latToMerc(lat: number) {
    const rad = lat * Math.PI / 180;
    return Math.log(Math.tan(Math.PI / 4 + rad / 2));
  }
  const mercMinY = latToMerc(minLat);
  const mercMaxY = latToMerc(maxLat);

  // Adjust bounding box so the map rect aspect ratio matches Mercator projection
  // (prevents horizontal or vertical stretch)
  const lngSpanDeg  = maxLng - minLng;
  const mercSpan    = mercMaxY - mercMinY;
  // natural aspect ratio in Mercator: lngSpan / mercSpan
  const naturalRatio = lngSpanDeg / mercSpan;
  const pageRatio    = mapW / mapH;
  if (naturalRatio > pageRatio) {
    // bbox wider than page — pad vertically
    const targetMercSpan = lngSpanDeg / pageRatio;
    const midMerc = (mercMinY + mercMaxY) / 2;
    const newMercMin = midMerc - targetMercSpan / 2;
    const newMercMax = midMerc + targetMercSpan / 2;
    minLat = (2 * Math.atan(Math.exp(newMercMin)) - Math.PI / 2) * 180 / Math.PI;
    maxLat = (2 * Math.atan(Math.exp(newMercMax)) - Math.PI / 2) * 180 / Math.PI;
  } else {
    // bbox taller than page — pad horizontally
    const targetLngSpan = mercSpan * pageRatio;
    const midLng = (minLng + maxLng) / 2;
    minLng = midLng - targetLngSpan / 2;
    maxLng = midLng + targetLngSpan / 2;
  }

  // Recompute Mercator bounds after adjustment
  const mercMin = latToMerc(minLat);
  const mercMax = latToMerc(maxLat);

  // project() uses Web Mercator — matches tile positions exactly
  function project(lng: number, lat: number): [number, number] {
    const x = mapX + ((lng - minLng) / (maxLng - minLng)) * mapW;
    const merc = latToMerc(lat);
    const y = mapY + ((mercMax - merc) / (mercMax - mercMin)) * mapH;
    return [x, y];
  }

  // ---- White page ----
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, PW, PH, 'F');

  // ---- Double border ----
  doc.setDrawColor(20, 20, 20);
  doc.setLineWidth(1.4);
  doc.rect(frameX, frameY, frameW, frameH);
  doc.setLineWidth(0.5);
  doc.rect(innerX, innerY, innerW, innerH);

  // ---- Title strip ----
  doc.setDrawColor(20, 20, 20);
  doc.setLineWidth(0.6);
  doc.line(innerX, innerY + TITLE_H, innerX + innerW, innerY + TITLE_H);

  doc.setTextColor(20, 20, 20);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('DIGCLEAR — UNDERGROUND UTILITY CLEARANCE DRAWING', innerX + 10, innerY + 20);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(80, 80, 80);
  const affected = data.conflicts.length;
  const resultLine = affected === 0
    ? 'RESULT: CLEAR — no recorded underground utility overlaps this working zone'
    : `RESULT: AFFECTED — overlaps ${affected} recorded utility line${affected > 1 ? 's' : ''}, shown on map`;
  doc.text(resultLine, innerX + 10, innerY + 36);
  doc.text('Tai Seng, Singapore  ·  Datum: SVY21', innerX + 10, innerY + 49);

  // ---- Map background ----
  doc.setFillColor(255, 255, 255);
  doc.rect(mapX, mapY, mapW, mapH, 'F');

  // ---- OSM tiles ----
  await drawOsmTiles(doc, mapX, mapY, mapW, mapH, minLng, maxLng, minLat, maxLat, tileZoom);

  // Mask overflow outside map rect
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, mapX, PH, 'F');
  doc.rect(mapX + mapW, 0, PW - mapX - mapW, PH, 'F');
  doc.rect(0, 0, PW, mapY, 'F');
  doc.rect(0, mapY + mapH, PW, PH - mapY - mapH, 'F');

  // Map border
  doc.setDrawColor(20, 20, 20);
  doc.setLineWidth(0.5);
  doc.rect(mapX, mapY, mapW, mapH, 'S');

  // ---- Work zone polygon (green outline, no fill) ----
  if (data.zoneGeoJSON) {
    const coords = collectPolygonCoords(data.zoneGeoJSON);
    if (coords.length >= 3) {
      const pts = coords.map(([lng, lat]) => project(lng, lat));
      doc.setDrawColor(58, 125, 92);
      doc.setLineWidth(2.0);
      for (let i = 0; i < pts.length - 1; i++) doc.line(pts[i][0], pts[i][1], pts[i+1][0], pts[i+1][1]);
      doc.line(pts[pts.length-1][0], pts[pts.length-1][1], pts[0][0], pts[0][1]);
      const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
      const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
      doc.setFontSize(6.5);
      doc.setTextColor(40, 120, 80);
      doc.setFont('helvetica', 'bold');
      doc.text('WORK ZONE', cx, cy, { align: 'center' });
      doc.setFont('helvetica', 'normal');
    }
  }

  // ---- Conflict lines ----
  for (const c of data.conflicts) {
    const coords = collectCoords(c.geometry);
    if (coords.length < 2) continue;
    const [r, g, b] = hexToRgb(UTILITY_COLORS[c.utilityType] || '#9E9E9E');
    doc.setDrawColor(r, g, b);
    doc.setLineWidth(2.5);
    const pts = coords.map(([lng, lat]: number[]) => project(lng, lat));
    for (let i = 0; i < pts.length - 1; i++) doc.line(pts[i][0], pts[i][1], pts[i+1][0], pts[i+1][1]);
  }

  // ---- North arrow ----
  const nx = mapX + mapW - 14, ny = mapY + 14;
  doc.setDrawColor(40, 40, 40);
  doc.setFillColor(40, 40, 40);
  doc.setLineWidth(0.5);
  doc.line(nx, ny + 7, nx, ny - 7);
  doc.triangle(nx - 2.5, ny - 2, nx + 2.5, ny - 2, nx, ny - 8, 'F');
  doc.setFontSize(6);
  doc.setTextColor(40, 40, 40);
  doc.text('N', nx, ny - 10, { align: 'center' });

  // ---- Scale bar ----
  const scaleY = mapY + mapH - 7, scaleX = mapX + 8;
  const mPerPt = ((maxLng - minLng) / mapW) * 111320;
  const barPt = 40;
  const barM = Math.round(mPerPt * barPt / 10) * 10;
  doc.setDrawColor(40, 40, 40);
  doc.setLineWidth(0.5);
  doc.line(scaleX, scaleY, scaleX + barPt, scaleY);
  doc.line(scaleX, scaleY - 2, scaleX, scaleY + 2);
  doc.line(scaleX + barPt, scaleY - 2, scaleX + barPt, scaleY + 2);
  doc.setFontSize(6);
  doc.setTextColor(40, 40, 40);
  doc.text('0', scaleX, scaleY + 5, { align: 'center' });
  doc.text(`${barM}m`, scaleX + barPt, scaleY + 5, { align: 'center' });

  // ====================================================================
  // RIGHT-HAND BANNER — white background
  // ====================================================================
  doc.setFillColor(255, 255, 255);
  doc.rect(bx, by, bw, bh, 'F');
  // Full border around banner, matching map border weight
  doc.setDrawColor(20, 20, 20);
  doc.setLineWidth(0.5);
  doc.rect(bx, by, bw, bh, 'S');

  const labelColor: [number, number, number] = [110, 115, 112];
  const valueColor: [number, number, number] = [20, 20, 20];
  const divColor:   [number, number, number] = [210, 210, 208];

  // Each cell has a fixed height; label + value are vertically centered inside it.
  const CELL_H = 46;
  const BLOCK_H = 26;
  let cy2 = by;

  function bannerField(label: string, value: string) {
    const blockTop = cy2 + (CELL_H - BLOCK_H) / 2;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...labelColor);
    doc.text(label.toUpperCase(), bx + 10, blockTop + 8);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(...valueColor);
    doc.text(value, bx + 10, blockTop + 21, { maxWidth: bw - 14 });
    cy2 += CELL_H;
    doc.setDrawColor(...divColor);
    doc.setLineWidth(0.3);
    doc.line(bx, cy2, bx + bw, cy2);
  }

  const company = data.contractorEmail.split('@')[0].toUpperCase();

  bannerField('Reference', data.reference);
  bannerField('Status', affected === 0 ? 'CLEAR' : 'AFFECTED');
  bannerField('Submitted by', company);
  bannerField('Date', new Date().toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' }));
  bannerField('Paid via', 'FOMO Pay');

  // ---- Legend ----
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...labelColor);
  doc.text('LEGEND', bx + 10, cy2 + 10);
  cy2 += 18;

  const swatchW = 14, swatchH = 8;
  doc.setFillColor(58, 125, 92);
  doc.rect(bx + 10, cy2 - 6, swatchW, swatchH, 'F');
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...valueColor);
  doc.text('Working zone', bx + 10 + swatchW + 5, cy2);
  cy2 += 14;

  if (data.conflicts.length > 0) {
    const [sr, sg, sb] = hexToRgb(UTILITY_COLORS[data.conflicts[0].utilityType] || '#9E9E9E');
    doc.setFillColor(sr, sg, sb);
    doc.rect(bx + 10, cy2 - 6, swatchW, swatchH, 'F');
    doc.setFontSize(9);
    doc.setTextColor(...valueColor);
    doc.text('Affected utility line', bx + 10 + swatchW + 5, cy2);
    cy2 += 14;
  }

  // ---- Notes section ----
  cy2 += 6;
  doc.setDrawColor(...divColor);
  doc.setLineWidth(0.3);
  doc.line(bx, cy2, bx + bw, cy2);
  cy2 += 10;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...labelColor);
  doc.text('NOTES', bx + 10, cy2);
  cy2 += 10;

  for (const note of NOTES) {
    const wrapped = doc.splitTextToSize(note, bw - 16);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...valueColor);
    doc.text(wrapped, bx + 10, cy2);
    cy2 += wrapped.length * 10 + 4;
  }

  doc.save(`DigClear-${data.reference}.pdf`);
}
