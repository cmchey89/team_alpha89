'use client';

import { useEffect, useRef } from 'react';
import { useMapEvents, useMap } from 'react-leaflet';
import type { LatLngTuple } from 'leaflet';
import L from 'leaflet';

const LINE_COLOR = 'rgb(255,0,255)';

// Pencil cursor — tip at bottom-left (hotspot 2,14)
const PENCIL_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16'%3E%3Cpath d='M13 1l2 2-1.5 1.5-2-2zM2 11L11.5 1.5l2 2L4 13l-3 1z' fill='white' stroke='black' stroke-width='0.5'/%3E%3Cpath d='M2 11l2 2-3 1z' fill='%23555'/%3E%3C/svg%3E") 2 14, crosshair`;

export interface DrawnLine {
  points: LatLngTuple[];
}

interface LineDrawerProps {
  active: boolean;
  lines: DrawnLine[];           // completed lines
  currentPoints: LatLngTuple[]; // in-progress line
  onPointAdded: (point: LatLngTuple) => void;
  onLineFinished: () => void;
}

export default function LineDrawer({
  active, lines, currentPoints, onPointAdded, onLineFinished,
}: LineDrawerProps) {
  const map = useMap();
  const completedLayerRef = useRef<L.LayerGroup | null>(null);
  const currentLayerRef   = useRef<L.Polyline | null>(null);
  const pendingClickRef   = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pencil cursor when active
  useEffect(() => {
    if (!map) return;
    map.getContainer().style.cursor = active ? PENCIL_CURSOR : '';
    return () => { map.getContainer().style.cursor = ''; };
  }, [map, active]);

  // Render completed lines
  useEffect(() => {
    if (!map) return;
    if (completedLayerRef.current) {
      completedLayerRef.current.clearLayers();
      map.removeLayer(completedLayerRef.current);
    }
    if (lines.length === 0) return;
    const group = L.layerGroup().addTo(map);
    completedLayerRef.current = group;
    lines.forEach((line) => {
      if (line.points.length >= 2) {
        L.polyline(line.points, { color: LINE_COLOR, weight: 2 }).addTo(group);
      }
    });
    return () => {
      if (completedLayerRef.current) {
        completedLayerRef.current.clearLayers();
        map.removeLayer(completedLayerRef.current);
        completedLayerRef.current = null;
      }
    };
  }, [map, lines]);

  // Render in-progress line (dashed)
  useEffect(() => {
    if (!map) return;
    if (currentLayerRef.current) { map.removeLayer(currentLayerRef.current); currentLayerRef.current = null; }
    if (currentPoints.length >= 2) {
      currentLayerRef.current = L.polyline(currentPoints, {
        color: LINE_COLOR, weight: 2, dashArray: '6,5',
      }).addTo(map);
    }
    return () => {
      if (currentLayerRef.current) { map.removeLayer(currentLayerRef.current); currentLayerRef.current = null; }
    };
  }, [map, currentPoints]);

  useMapEvents({
    click(e) {
      if (!active) return;
      if (pendingClickRef.current) clearTimeout(pendingClickRef.current);
      pendingClickRef.current = setTimeout(() => {
        pendingClickRef.current = null;
        onPointAdded([e.latlng.lat, e.latlng.lng]);
      }, 250);
    },
    dblclick() {
      if (!active) return;
      if (pendingClickRef.current) { clearTimeout(pendingClickRef.current); pendingClickRef.current = null; }
      if (currentPoints.length >= 2) onLineFinished();
    },
  });

  return null;
}
