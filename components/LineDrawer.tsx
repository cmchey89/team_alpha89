'use client';

import { useEffect, useRef } from 'react';
import { useMapEvents, useMap } from 'react-leaflet';
import type { LatLngTuple } from 'leaflet';
import L from 'leaflet';

const LINE_COLOR = 'rgb(255,0,255)';

export interface DrawnLine {
  points: LatLngTuple[];
}

interface LineDrawerProps {
  active: boolean;
  lines: DrawnLine[];
  currentPoints: LatLngTuple[];
  onPointAdded: (point: LatLngTuple) => void;
  onLineFinished: () => void;
}

function addDots(points: LatLngTuple[], group: L.LayerGroup) {
  points.forEach((pt) => {
    L.circleMarker([pt[0], pt[1]], {
      radius: 5, color: LINE_COLOR, fillColor: LINE_COLOR, fillOpacity: 1, weight: 1,
    }).addTo(group);
  });
}

export default function LineDrawer({
  active, lines, currentPoints, onPointAdded, onLineFinished,
}: LineDrawerProps) {
  const map = useMap();
  const completedLayerRef = useRef<L.LayerGroup | null>(null);
  const currentLayerRef   = useRef<L.LayerGroup | null>(null);
  const pendingClickRef   = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!map) return;
    map.getContainer().style.cursor = active ? 'crosshair' : '';
    return () => { map.getContainer().style.cursor = ''; };
  }, [map, active]);

  // Render completed lines + their dots
  useEffect(() => {
    if (!map) return;
    if (completedLayerRef.current) {
      completedLayerRef.current.clearLayers();
      map.removeLayer(completedLayerRef.current);
      completedLayerRef.current = null;
    }
    if (lines.length === 0) return;
    const group = L.layerGroup().addTo(map);
    completedLayerRef.current = group;
    lines.forEach((line) => {
      if (line.points.length >= 2) {
        L.polyline(line.points, { color: LINE_COLOR, weight: 4 }).addTo(group);
        addDots(line.points, group);
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

  // Render in-progress line (dashed) + dots
  useEffect(() => {
    if (!map) return;
    if (currentLayerRef.current) {
      currentLayerRef.current.clearLayers();
      map.removeLayer(currentLayerRef.current);
      currentLayerRef.current = null;
    }
    if (currentPoints.length === 0) return;
    const group = L.layerGroup().addTo(map);
    currentLayerRef.current = group;
    if (currentPoints.length >= 2) {
      L.polyline(currentPoints, { color: LINE_COLOR, weight: 4, dashArray: '8,5' }).addTo(group);
    }
    addDots(currentPoints, group);
    return () => {
      if (currentLayerRef.current) {
        currentLayerRef.current.clearLayers();
        map.removeLayer(currentLayerRef.current);
        currentLayerRef.current = null;
      }
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
