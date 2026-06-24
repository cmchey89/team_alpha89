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
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
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
  // A4 landscape — matches the reference drawing sheet
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });

  const PW = doc.internal.pageSize.getWidth();  // ~841.89 pt
  const PH = doc.internal.pageSize.getHeight(); // ~595.28 pt

  // Layout constants (pt)
  const MARGIN   = 14;   // outer margin
  const BANNER_W = 155;  // right-hand info column width
  const TITLE_H  = 48;   // title strip height
  const INNER_PAD = 5;   // gap inside double border

  // Outer frame
  const frameX = MARGIN;
  const frameY = MARGIN;
  const frameW = PW - MARGIN * 2;
  const frameH = PH - MARGIN * 2;

  // Inner usable rect (inside double border)
  const innerX = frameX + INNER_PAD;
  const innerY = frameY + INNER_PAD;
  const innerW = frameW - INNER_PAD * 2;
  const innerH = frameH - INNER_PAD * 2;

  // Map area (left of banner, below title strip)
  const mapX = innerX;
  const mapY = innerY + TITLE_H;
  const mapW = innerW - BANNER_W;
  const mapH = innerH - TITLE_H;

  // Banner rect
  const bx = innerX + innerW - BANNER_W;
  const by = innerY;
  const bw = BANNER_W;
  const bh = innerH;

  // --- Gather bounding box ---
  const allCoords: number[][] = [];
  if (data.zoneGeoJSON) allCoords.push(...collectPolygonCoords(data.zoneGeoJSON));
  for (const c of data.conflicts) allCoords.push(...collectCoords(c.geometry));
  if (allCoords.length === 0) return;

  let minLng: number, maxLng: number, minLat: number, maxLat: number;
  if (data.mapView) {
    ({ minLng, maxLng, minLat, maxLat } = data.mapView.bounds);
  } else {
    const lngs = allCoords.map((c) => c[0]);
    const lats = allCoords.map((c) => c[1]);
    minLng = Math.min(...lngs); maxLng = Math.max(...lngs);
    minLat = Math.min(...lats); maxLat = Math.max(...lats);
    const padLng = (maxLng - minLng) * 1.2 || 0.005;
    const padLat = (maxLat - minLat) * 1.2 || 0.005;
    minLng -= padLng; maxLng += padLng;
    minLat -= padLat; maxLat += padLat;
  }

  function project(lng: number, lat: number): [number, number] {
    const x = mapX + ((lng - minLng) / (maxLng - minLng)) * mapW;
    const y = mapY + mapH - ((lat - minLat) / (maxLat - minLat)) * mapH;
    return [x, y];
  }

  // ---- White page background ----
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, PW, PH, 'F');

  // ---- Double border ----
  doc.setDrawColor(20, 20, 20);
  doc.setLineWidth(1.4);
  doc.rect(frameX, frameY, frameW, frameH); // outer
  doc.setLineWidth(0.5);
  doc.rect(innerX, innerY, innerW, innerH); // inner

  // ---- Title strip (top-left, above map) ----
  // background already white; draw bottom border only
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
    : `RESULT: AFFECTED — overlaps ${affected} recorded utility line${affected > 1 ? '(s)' : ''}, shown on map`;
  doc.text(resultLine, innerX + 8, innerY + 29);
  doc.text('Tai Seng, Singapore  ·  Datum: SVY21', innerX + 8, innerY + 40);

  // ---- Map white background ----
  doc.setFillColor(255, 255, 255);
  doc.rect(mapX, mapY, mapW, mapH, 'F');

  // ---- OSM tiles ----
  const tileZoom = data.mapView?.zoom ?? 15;
  await drawOsmTiles(doc, mapX, mapY, mapW, mapH, minLng, maxLng, minLat, maxLat, tileZoom);

  // Mask overflow outside map rect
  doc.setFillColor(255, 255, 255);
  doc.rect(0,       0,       mapX,          PH, 'F');
  doc.rect(mapX + mapW, 0,   PW - mapX - mapW, PH, 'F');
  doc.rect(0,       0,       PW,            mapY, 'F');
  doc.rect(0, mapY + mapH,   PW, PH - mapY - mapH, 'F');

  // Map border
  doc.setDrawColor(20, 20, 20);
  doc.setLineWidth(0.5);
  doc.rect(mapX, mapY, mapW, mapH, 'S');

  // ---- Draw work zone polygon (green outline, no fill) ----
  if (data.zoneGeoJSON) {
    const coords = collectPolygonCoords(data.zoneGeoJSON);
    if (coords.length >= 3) {
      const pts = coords.map(([lng, lat]) => project(lng, lat));
      doc.setDrawColor(58, 125, 92);
      doc.setLineWidth(2.0);
      for (let i = 0; i < pts.length - 1; i++) {
        doc.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
      }
      doc.line(pts[pts.length - 1][0], pts[pts.length - 1][1], pts[0][0], pts[0][1]);

      const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
      const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
      doc.setFontSize(6.5);
      doc.setTextColor(40, 120, 80);
      doc.setFont('helvetica', 'bold');
      doc.text('WORK ZONE', cx, cy, { align: 'center' });
      doc.setFont('helvetica', 'normal');
    }
  }

  // ---- Draw conflict lines ----
  for (const c of data.conflicts) {
    const coords = collectCoords(c.geometry);
    if (coords.length < 2) continue;
    const color = UTILITY_COLORS[c.utilityType] || '#9E9E9E';
    const [r, g, b] = hexToRgb(color);
    doc.setDrawColor(r, g, b);
    doc.setLineWidth(2.5);
    const pts = coords.map(([lng, lat]: number[]) => project(lng, lat));
    for (let i = 0; i < pts.length - 1; i++) {
      doc.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    }
  }

  // ---- North arrow ----
  const nx = mapX + mapW - 14;
  const ny = mapY + 14;
  doc.setDrawColor(40, 40, 40);
  doc.setFillColor(40, 40, 40);
  doc.setLineWidth(0.5);
  doc.line(nx, ny + 7, nx, ny - 7);
  doc.triangle(nx - 2.5, ny - 2, nx + 2.5, ny - 2, nx, ny - 8, 'F');
  doc.setFontSize(6);
  doc.setTextColor(40, 40, 40);
  doc.text('N', nx, ny - 10, { align: 'center' });

  // ---- Scale bar ----
  const scaleY = mapY + mapH - 7;
  const scaleX = mapX + 8;
  const degPerPt = (maxLng - minLng) / mapW;
  const mPerPt = degPerPt * 111320;
  const barPt = 40; // target ~40pt bar
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
  // RIGHT-HAND BANNER — light paper background, matching reference PDF
  // ====================================================================
  doc.setFillColor(248, 247, 243);
  doc.rect(bx, by, bw, bh, 'F');

  // Left border of banner (vertical divider from map)
  doc.setDrawColor(20, 20, 20);
  doc.setLineWidth(0.6);
  doc.line(bx, by, bx, by + bh);

  const labelColor: [number, number, number] = [110, 115, 112];
  const valueColor: [number, number, number] = [20, 20, 20];
  const divColor:   [number, number, number] = [200, 200, 195];

  let cy2 = by + 12;

  function bannerField(label: string, value: string) {
    // grey label
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...labelColor);
    doc.text(label.toUpperCase(), bx + 8, cy2);
    cy2 += 5;
    // bold value
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...valueColor);
    doc.text(value, bx + 8, cy2, { maxWidth: bw - 12 });
    cy2 += 5;
    // divider
    doc.setDrawColor(...divColor);
    doc.setLineWidth(0.3);
    doc.line(bx + 4, cy2, bx + bw - 4, cy2);
    cy2 += 8;
  }

  // Contractor company: derive from email (part before @)
  const company = data.contractorEmail.split('@')[0].toUpperCase();

  const areaSqm = (() => {
    const coords = data.zoneGeoJSON ? collectPolygonCoords(data.zoneGeoJSON) : [];
    if (coords.length < 3) return 0;
    const R = 111320;
    const lat0 = (coords[0][1] * Math.PI) / 180;
    const pts2 = coords.map(([lng, lat]) => [lng * R * Math.cos(lat0), lat * R]);
    let sum = 0;
    for (let i = 0; i < pts2.length; i++) {
      const [x1, y1] = pts2[i], [x2, y2] = pts2[(i + 1) % pts2.length];
      sum += x1 * y2 - x2 * y1;
    }
    return Math.round(Math.abs(sum / 2));
  })();

  bannerField('Reference', data.reference);
  bannerField('Status', data.conflicts.length === 0 ? 'CLEAR' : 'AFFECTED');
  bannerField('Submitted by', company);
  bannerField('Date', new Date().toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' }));
  bannerField('Area (approx.)', `${areaSqm.toLocaleString()} m²`);
  bannerField('Paid via', 'FOMO Pay');

  // ---- Legend ----
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(...labelColor);
  doc.text('LEGEND', bx + 8, cy2);
  cy2 += 6;

  // Working zone swatch
  doc.setFillColor(58, 125, 92);
  doc.rect(bx + 8, cy2 - 4, 10, 6, 'F');
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...valueColor);
  doc.text('Working zone', bx + 22, cy2);
  cy2 += 9;

  // Affected utility line swatch (only if there are conflicts)
  if (data.conflicts.length > 0) {
    // Use the first conflict's color
    const firstType = data.conflicts[0].utilityType;
    const [sr, sg, sb] = hexToRgb(UTILITY_COLORS[firstType] || '#9E9E9E');
    doc.setFillColor(sr, sg, sb);
    doc.rect(bx + 8, cy2 - 4, 10, 6, 'F');
    doc.setFontSize(8);
    doc.setTextColor(...valueColor);
    doc.text('Affected utility line', bx + 22, cy2);
    cy2 += 9;
  }

  // ---- Affected lines list ----
  if (data.conflicts.length > 0) {
    cy2 += 4;
    doc.setDrawColor(...divColor);
    doc.setLineWidth(0.3);
    doc.line(bx + 4, cy2, bx + bw - 4, cy2);
    cy2 += 7;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...labelColor);
    doc.text('AFFECTED LINES', bx + 8, cy2);
    cy2 += 7;

    const MAX_LISTED = 10;
    const maxY = by + bh - 28;
    const toList = data.conflicts.slice(0, MAX_LISTED);
    for (const c of toList) {
      if (cy2 > maxY) break;
      const typeLabel = UTILITY_LABELS[c.utilityType] || c.utilityType;
      const shortId = c.infraLineId ? c.infraLineId.slice(0, 8) : '';
      const line = `${typeLabel} (infra_${shortId})`;
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...valueColor);
      const wrapped = doc.splitTextToSize(line, bw - 16);
      doc.text(wrapped, bx + 8, cy2);
      cy2 += wrapped.length * 9 + 1;
    }
    if (data.conflicts.length > MAX_LISTED) {
      doc.setFontSize(7);
      doc.setFont('helvetica', 'italic');
      doc.setTextColor(...labelColor);
      doc.text(`+ ${data.conflicts.length - MAX_LISTED} more`, bx + 8, cy2);
    }
  }

  // ---- Footer note pinned to bottom of banner ----
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
