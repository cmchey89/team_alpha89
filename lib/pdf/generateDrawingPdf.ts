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
        const url = `https://tile.openstreetmap.org/${zoom}/${tx}/${ty}.png`;
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
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const PW = doc.internal.pageSize.getWidth();   // ~841.89 pt
  const PH = doc.internal.pageSize.getHeight();  // ~595.28 pt

  // Layout constants
  const MARGIN    = 14;
  const BANNER_W  = 160;
  const TITLE_H   = 48;
  const INNER_PAD = 5;

  const frameX = MARGIN, frameY = MARGIN;
  const frameW = PW - MARGIN * 2, frameH = PH - MARGIN * 2;
  const innerX = frameX + INNER_PAD, innerY = frameY + INNER_PAD;
  const innerW = frameW - INNER_PAD * 2, innerH = frameH - INNER_PAD * 2;

  const mapX = innerX;
  const mapY = innerY + TITLE_H;
  const mapW = innerW - BANNER_W;
  const mapH = innerH - TITLE_H;

  const bx = innerX + innerW - BANNER_W;
  const by = innerY;
  const bw = BANNER_W;
  const bh = innerH;

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
  // 40 % padding so the zone isn't crammed edge-to-edge
  const padLng = Math.max((maxLng - minLng) * 0.4, 0.003);
  const padLat = Math.max((maxLat - minLat) * 0.4, 0.003);
  minLng -= padLng; maxLng += padLng;
  minLat -= padLat; maxLat += padLat;

  // Tile zoom: clamp between 14 and 17 for good street-level resolution
  const rawZoom = data.mapView?.zoom ?? 16;
  const tileZoom = Math.min(17, Math.max(14, rawZoom));

  function project(lng: number, lat: number): [number, number] {
    const x = mapX + ((lng - minLng) / (maxLng - minLng)) * mapW;
    const y = mapY + mapH - ((lat - minLat) / (maxLat - minLat)) * mapH;
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
  doc.line(innerX, innerY + TITLE_H, innerX + innerW - BANNER_W, innerY + TITLE_H);

  doc.setTextColor(20, 20, 20);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('DIGCLEAR — UNDERGROUND UTILITY CLEARANCE DRAWING', innerX + 8, innerY + 16);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(80, 80, 80);
  const affected = data.conflicts.length;
  const resultLine = affected === 0
    ? 'RESULT: CLEAR — no recorded underground utility overlaps this working zone'
    : `RESULT: AFFECTED — overlaps ${affected} recorded utility line${affected > 1 ? 's' : ''}, shown on map`;
  doc.text(resultLine, innerX + 8, innerY + 29);
  doc.text('Tai Seng, Singapore  ·  Datum: SVY21', innerX + 8, innerY + 40);

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
  doc.setDrawColor(20, 20, 20);
  doc.setLineWidth(0.6);
  doc.line(bx, by, bx, by + bh); // left divider

  const labelColor: [number, number, number] = [110, 115, 112];
  const valueColor: [number, number, number] = [20, 20, 20];
  const divColor:   [number, number, number] = [210, 210, 208];

  let cy2 = by + 14;

  function bannerField(label: string, value: string) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...labelColor);
    doc.text(label.toUpperCase(), bx + 8, cy2);
    cy2 += 9;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...valueColor);
    doc.text(value, bx + 8, cy2, { maxWidth: bw - 12 });
    cy2 += 10;
    doc.setDrawColor(...divColor);
    doc.setLineWidth(0.3);
    doc.line(bx + 4, cy2, bx + bw - 4, cy2);
    cy2 += 10;
  }

  const company = data.contractorEmail.split('@')[0].toUpperCase();

  bannerField('Reference', data.reference);
  bannerField('Status', affected === 0 ? 'CLEAR' : 'AFFECTED');
  bannerField('Submitted by', company);
  bannerField('Date', new Date().toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' }));
  bannerField('Paid via', 'FOMO Pay');

  // ---- Legend ----
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(...labelColor);
  doc.text('LEGEND', bx + 8, cy2);
  cy2 += 10;

  doc.setFillColor(58, 125, 92);
  doc.rect(bx + 8, cy2 - 5, 12, 7, 'F');
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...valueColor);
  doc.text('Working zone', bx + 24, cy2);
  cy2 += 13;

  if (data.conflicts.length > 0) {
    const [sr, sg, sb] = hexToRgb(UTILITY_COLORS[data.conflicts[0].utilityType] || '#9E9E9E');
    doc.setFillColor(sr, sg, sb);
    doc.rect(bx + 8, cy2 - 5, 12, 7, 'F');
    doc.setFontSize(8.5);
    doc.setTextColor(...valueColor);
    doc.text('Affected utility line', bx + 24, cy2);
    cy2 += 13;
  }

  // ---- Notes section ----
  cy2 += 4;
  doc.setDrawColor(...divColor);
  doc.setLineWidth(0.3);
  doc.line(bx + 4, cy2, bx + bw - 4, cy2);
  cy2 += 8;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.setTextColor(...labelColor);
  doc.text('NOTES', bx + 8, cy2);
  cy2 += 8;

  for (const note of NOTES) {
    const wrapped = doc.splitTextToSize(note, bw - 14);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...valueColor);
    doc.text(wrapped, bx + 8, cy2);
    cy2 += wrapped.length * 8 + 4;
  }

  // ---- Footer disclaimer pinned to bottom ----
  const footY = by + bh - 16;
  doc.setDrawColor(...divColor);
  doc.setLineWidth(0.3);
  doc.line(bx + 4, footY - 6, bx + bw - 4, footY - 6);
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(6);
  doc.setTextColor(...labelColor);
  doc.text(
    doc.splitTextToSize('Do not excavate without reviewing this drawing in full.', bw - 16),
    bx + 8,
    footY
  );

  doc.save(`DigClear-${data.reference}.pdf`);
}
