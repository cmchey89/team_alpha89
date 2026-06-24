'use client';

import { useEffect, useRef, useState } from 'react';
import { useMapEvents, useMap } from 'react-leaflet';
import type { LatLngTuple } from 'leaflet';
import L from 'leaflet';

interface ZoneDrawerProps {
  active: boolean;
  points: LatLngTuple[];
  onPointAdded: (point: LatLngTuple) => void;
  onPointMoved: (index: number, point: LatLngTuple) => void;
  onPointDeleted: (index: number) => void;
  onDoubleClickFinish: () => void;
}

export default function ZoneDrawer({
  active, points, onPointAdded, onPointMoved, onPointDeleted, onDoubleClickFinish,
}: ZoneDrawerProps) {
  const map = useMap();
  const markerLayerRef = useRef<L.LayerGroup | null>(null);
  const polygonLayerRef = useRef<L.Polygon | null>(null);
  const [pixelPoints, setPixelPoints] = useState<{ x: number; y: number }[]>([]);
  const [mapSize, setMapSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  // Set crosshair cursor when active
  useEffect(() => {
    if (!map) return;
    map.getContainer().style.cursor = active ? 'crosshair' : '';
    return () => { map.getContainer().style.cursor = ''; };
  }, [map, active]);

  // Recompute pixel points for the SVG mask overlay
  useEffect(() => {
    if (!map || !active) { setPixelPoints([]); return; }
    const size = map.getSize();
    setMapSize({ w: size.x, h: size.y });
    setPixelPoints(points.map((pt) => {
      const p = map.latLngToContainerPoint([pt[0], pt[1]]);
      return { x: p.x, y: p.y };
    }));
  }, [map, active, points]);

  useMapEvents({
    click(e) {
      if (!active) return;
      onPointAdded([e.latlng.lat, e.latlng.lng]);
    },
    dblclick() {
      if (!active) return;
      if (points.length >= 3) onDoubleClickFinish();
    },
  });

  // Leaflet polygon outline
  useEffect(() => {
    if (!map) return;
    if (polygonLayerRef.current) { map.removeLayer(polygonLayerRef.current); polygonLayerRef.current = null; }
    if (points.length >= 2) {
      polygonLayerRef.current = L.polygon(points as L.LatLngTuple[], {
        color: '#0072CE', weight: 2,
        fillColor: '#0072CE', fillOpacity: 0,
        dashArray: active ? '6,5' : undefined,
      }).addTo(map);
    }
    return () => { if (polygonLayerRef.current) { map.removeLayer(polygonLayerRef.current); polygonLayerRef.current = null; } };
  }, [map, points, active]);

  // Draggable + right-click-deletable vertex markers
  useEffect(() => {
    if (!map) return;
    if (markerLayerRef.current) { markerLayerRef.current.clearLayers(); map.removeLayer(markerLayerRef.current); }
    if (!active || points.length === 0) return;

    const group = L.layerGroup().addTo(map);
    markerLayerRef.current = group;

    points.forEach((pt, i) => {
      const marker = L.circleMarker([pt[0], pt[1]], {
        radius: 7, color: '#0072CE', fillColor: '#ffffff', fillOpacity: 1, weight: 2,
      });
      marker.addTo(group);

      // Left-drag to move
      marker.on('mousedown', (downEvt: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(downEvt);
        const onMove = (e: L.LeafletMouseEvent) => { marker.setLatLng(e.latlng); };
        const onUp   = (e: L.LeafletMouseEvent) => {
          map.off('mousemove', onMove); map.off('mouseup', onUp);
          onPointMoved(i, [e.latlng.lat, e.latlng.lng]);
        };
        map.on('mousemove', onMove); map.on('mouseup', onUp);
      });

      // Right-click to delete this vertex
      marker.on('contextmenu', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e);
        onPointDeleted(i);
      });

      marker.on('mouseover', () => { map.getContainer().style.cursor = 'grab'; });
      marker.on('mouseout',  () => { map.getContainer().style.cursor = active ? 'crosshair' : ''; });
    });

    return () => {
      if (markerLayerRef.current) { markerLayerRef.current.clearLayers(); map.removeLayer(markerLayerRef.current); markerLayerRef.current = null; }
    };
  }, [map, active, points, onPointMoved, onPointDeleted]);

  // SVG mask: dim everything outside the forming polygon
  if (!active || pixelPoints.length < 2 || mapSize.w === 0) return null;
  const polyStr = pixelPoints.map(p => `${p.x},${p.y}`).join(' ');

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 450, pointerEvents: 'none' }}>
      <svg width={mapSize.w} height={mapSize.h} style={{ display: 'block' }}>
        <defs>
          <mask id="zone-reveal">
            <rect width={mapSize.w} height={mapSize.h} fill="white" />
            {pixelPoints.length >= 3 && <polygon points={polyStr} fill="black" />}
          </mask>
        </defs>
        <rect width={mapSize.w} height={mapSize.h} fill="rgba(0,20,60,0.45)" mask="url(#zone-reveal)" />
        <polygon points={polyStr} fill="none" stroke="#0072CE" strokeWidth={2} strokeDasharray="6,5" />
      </svg>
    </div>
  );
}
