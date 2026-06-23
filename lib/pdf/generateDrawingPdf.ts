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

interface DrawingData {
  reference: string;
  conflicts: Conflict[];
  zoneGeoJSON: { type: string; coordinates: any } | null;
  contractorEmail: string;
}

function lon2tile(lon: number, zoom: number) { return Math.floor((lon + 180) / 360 * Math.pow(2, zoom)); }
function lat2tile(lat: number, zoom: number) { return Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom)); }
function tile2lon(x: number, zoom: number) { return x / Math.pow(2, zoom) * 360 - 180; }
function tile2lat(y: number, zoom: number) { const n = Math.PI - 2 * Math.PI * y / Math.pow(2, zoom); return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); }

async function drawOsmTiles(
  doc: jsPDF,
  mapX: number, mapY: number, mapW: number, mapH: number,
  minLng: number, maxLng: number, minLat: number, maxLat: number
) {
  const zoom = 16;
  const tileXmin = lon2tile(minLng, zoom);
  const tileXmax = lon2tile(maxLng, zoom);
  const tileYmin = lat2tile(maxLat, zoom); // note: y is inverted
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
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  // Layout
  const sideW = 70;
  const mapX = 10;
  const mapY = 10;
  const mapW = pageW - sideW - 15;
  const mapH = pageH - 20;

  // --- Gather all coordinates to compute bounding box ---
  const allCoords: number[][] = [];
  if (data.zoneGeoJSON) allCoords.push(...collectPolygonCoords(data.zoneGeoJSON));
  for (const c of data.conflicts) allCoords.push(...collectCoords(c.geometry));

  if (allCoords.length === 0) return;

  const lngs = allCoords.map((c) => c[0]);
  const lats = allCoords.map((c) => c[1]);
  let minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  let minLat = Math.min(...lats), maxLat = Math.max(...lats);

  // Pad bounding box 20%
  const padLng = (maxLng - minLng) * 0.2 || 0.001;
  const padLat = (maxLat - minLat) * 0.2 || 0.001;
  minLng -= padLng; maxLng += padLng;
  minLat -= padLat; maxLat += padLat;

  function project(lng: number, lat: number): [number, number] {
    const x = mapX + ((lng - minLng) / (maxLng - minLng)) * mapW;
    const y = mapY + mapH - ((lat - minLat) / (maxLat - minLat)) * mapH;
    return [x, y];
  }

  // --- Map background using OSM tiles ---
  await drawOsmTiles(doc, mapX, mapY, mapW, mapH, minLng, maxLng, minLat, maxLat);
  doc.setDrawColor(100, 100, 100);
  doc.setLineWidth(0.3);
  doc.rect(mapX, mapY, mapW, mapH, 'S');

  // --- Draw work zone polygon ---
  if (data.zoneGeoJSON) {
    const coords = collectPolygonCoords(data.zoneGeoJSON);
    if (coords.length >= 3) {
      const pts = coords.map(([lng, lat]) => project(lng, lat));
      doc.setDrawColor(95, 190, 142);
      doc.setLineWidth(1.2);
      // Draw as dashed outline only — no fill to avoid black artifact
      for (let i = 0; i < pts.length - 1; i++) {
        doc.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
      }
      doc.line(pts[pts.length - 1][0], pts[pts.length - 1][1], pts[0][0], pts[0][1]);
      // Label
      const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
      const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
      doc.setFontSize(7);
      doc.setTextColor(40, 160, 100);
      doc.setFont('helvetica', 'bold');
      doc.text('WORK ZONE', cx, cy, { align: 'center' });
      doc.setFont('helvetica', 'normal');
    }
  }

  // --- Draw conflict lines ---
  for (const c of data.conflicts) {
    const coords = collectCoords(c.geometry);
    if (coords.length < 2) continue;
    const color = UTILITY_COLORS[c.utilityType] || '#9E9E9E';
    const [r, g, b] = hexToRgb(color);
    doc.setDrawColor(r, g, b);
    doc.setLineWidth(0.6);
    const pts = coords.map(([lng, lat]: number[]) => project(lng, lat));
    for (let i = 0; i < pts.length - 1; i++) {
      doc.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    }
  }

  // --- North arrow ---
  const nx = mapX + mapW - 12;
  const ny = mapY + 12;
  doc.setDrawColor(60, 60, 60);
  doc.setFillColor(60, 60, 60);
  doc.setLineWidth(0.4);
  doc.line(nx, ny + 6, nx, ny - 6);
  doc.triangle(nx - 2, ny - 2, nx + 2, ny - 2, nx, ny - 7, 'F');
  doc.setFontSize(6);
  doc.setTextColor(60, 60, 60);
  doc.text('N', nx, ny - 9, { align: 'center' });

  // --- Scale bar ---
  const scaleY = mapY + mapH - 6;
  const scaleX = mapX + 6;
  const degPerMm = (maxLng - minLng) / mapW;
  const mPerMm = degPerMm * 111320;
  const barMm = 20;
  const barM = Math.round(mPerMm * barMm / 10) * 10;
  doc.setDrawColor(60, 60, 60);
  doc.setLineWidth(0.4);
  doc.line(scaleX, scaleY, scaleX + barMm, scaleY);
  doc.line(scaleX, scaleY - 1.5, scaleX, scaleY + 1.5);
  doc.line(scaleX + barMm, scaleY - 1.5, scaleX + barMm, scaleY + 1.5);
  doc.setFontSize(6);
  doc.setTextColor(60, 60, 60);
  doc.text(`0`, scaleX, scaleY + 4, { align: 'center' });
  doc.text(`${barM}m`, scaleX + barMm, scaleY + 4, { align: 'center' });

  // --- Side panel ---
  const sx = pageW - sideW - 2;
  const sy = mapY;
  const sw = sideW;
  const sh = mapH;

  doc.setFillColor(22, 36, 28);
  doc.rect(sx, sy, sw, sh, 'F');
  doc.setDrawColor(42, 59, 48);
  doc.setLineWidth(0.3);
  doc.rect(sx, sy, sw, sh, 'S');

  // Logo placeholder
  doc.setFillColor(30, 50, 38);
  doc.rect(sx + 4, sy + 4, sw - 8, 18, 'F');
  doc.setFontSize(11);
  doc.setTextColor(255, 106, 26);
  doc.setFont('helvetica', 'bold');
  doc.text('DigClear', sx + sw / 2, sy + 14, { align: 'center' });
  doc.setFontSize(6);
  doc.setTextColor(138, 147, 140);
  doc.setFont('helvetica', 'normal');
  doc.text('Underground Utility Clearance', sx + sw / 2, sy + 19, { align: 'center' });

  // Divider
  doc.setDrawColor(42, 59, 48);
  doc.setLineWidth(0.3);
  doc.line(sx + 4, sy + 25, sx + sw - 4, sy + 25);

  // Drawing info
  let infoY = sy + 32;
  const labelColor: [number, number, number] = [138, 147, 140];
  const valueColor: [number, number, number] = [242, 239, 230];

  function infoRow(label: string, value: string) {
    doc.setFontSize(6);
    doc.setTextColor(...labelColor);
    doc.text(label.toUpperCase(), sx + 4, infoY);
    infoY += 4;
    doc.setFontSize(8);
    doc.setTextColor(...valueColor);
    doc.setFont('helvetica', 'bold');
    doc.text(value, sx + 4, infoY, { maxWidth: sw - 8 });
    doc.setFont('helvetica', 'normal');
    infoY += 7;
  }

  infoRow('Reference', data.reference);
  infoRow('Date', new Date().toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' }));
  infoRow('Contractor', data.contractorEmail);
  infoRow('Affected Lines', String(data.conflicts.length));
  infoRow('Drawing Scale', '1:NTS');
  infoRow('CRS', 'WGS84 / EPSG:4326');

  // Divider
  infoY += 2;
  doc.setDrawColor(42, 59, 48);
  doc.line(sx + 4, infoY, sx + sw - 4, infoY);
  infoY += 6;

  // Legend
  doc.setFontSize(7);
  doc.setTextColor(...labelColor);
  doc.text('LEGEND', sx + 4, infoY);
  infoY += 5;

  // Work zone legend entry
  doc.setFillColor(95, 190, 142);
  doc.rect(sx + 4, infoY - 3, 8, 3, 'F');
  doc.setFontSize(6.5);
  doc.setTextColor(...valueColor);
  doc.text('Work Zone', sx + 15, infoY, {});
  infoY += 6;

  // Utility type entries — only show types present in conflicts
  const presentTypes = [...new Set(data.conflicts.map((c) => c.utilityType))];
  for (const type of presentTypes) {
    const color = UTILITY_COLORS[type] || '#9E9E9E';
    const [r, g, b] = hexToRgb(color);
    doc.setFillColor(r, g, b);
    doc.rect(sx + 4, infoY - 3, 8, 3, 'F');
    doc.setFontSize(6.5);
    doc.setTextColor(...valueColor);
    doc.text(UTILITY_LABELS[type] || type, sx + 15, infoY);
    infoY += 6;
  }

  // Divider
  infoY += 2;
  doc.setDrawColor(42, 59, 48);
  doc.line(sx + 4, infoY, sx + sw - 4, infoY);
  infoY += 6;

  // Warning note
  doc.setFontSize(5.5);
  doc.setTextColor(...labelColor);
  const warning = 'This drawing is for utility clearance reference only. Depths are not indicated. Verify on site before excavation.';
  const lines = doc.splitTextToSize(warning, sw - 8);
  doc.text(lines, sx + 4, infoY);

  // Bottom stamp
  const stampY = sy + sh - 8;
  doc.setDrawColor(42, 59, 48);
  doc.line(sx + 4, stampY - 4, sx + sw - 4, stampY - 4);
  doc.setFontSize(5.5);
  doc.setTextColor(...labelColor);
  doc.text('CONFIDENTIAL — Not for redistribution', sx + sw / 2, stampY, { align: 'center' });

  doc.save(`DigClear-${data.reference}.pdf`);
}
