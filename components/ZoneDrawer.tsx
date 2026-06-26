'use client';

import { useEffect, useRef, useMemo } from 'react';
import { useMapEvents, useMap } from 'react-leaflet';
import type { LatLngTuple } from 'leaflet';
import L from 'leaflet';

interface ZoneDrawerProps {
  active: boolean;
  frozen: boolean; // true in all non-idle phases — drives the dim overlay
  points: LatLngTuple[];
  completedZones: LatLngTuple[][];
  onPointAdded: (point: LatLngTuple) => void;
  onPointMoved: (index: number, point: LatLngTuple) => void;
  onPointDeleted: (index: number) => void;
  onDoubleClickFinish: () => void;
}

const ZONE_RED = '#FF1744';

export default function ZoneDrawer({
  active, frozen, points, completedZones, onPointAdded, onPointMoved, onPointDeleted, onDoubleClickFinish,
}: ZoneDrawerProps) {
  const map = useMap();
  const markerLayerRef    = useRef<L.LayerGroup | null>(null);
  const polygonLayerRef   = useRef<L.Polygon | null>(null);
  const completedLayerRef = useRef<L.LayerGroup | null>(null);
  const pendingClickRef   = useRef<{ timer: ReturnType<typeof setTimeout>; latlng: L.LatLng } | null>(null);

  // Set crosshair cursor when active
  useEffect(() => {
    if (!map) return;
    map.getContainer().style.cursor = active ? 'crosshair' : '';
    return () => { map.getContainer().style.cursor = ''; };
  }, [map, active]);

  // Pixel coords for SVG overlay — current in-progress zone + all completed zones
  const { pixelPoints, pixelCompletedZones, mapSize } = useMemo(() => {
    if (!map || (!active && !frozen)) {
      return { pixelPoints: [] as { x: number; y: number }[], pixelCompletedZones: [] as { x: number; y: number }[][], mapSize: { w: 0, h: 0 } };
    }
    const size = map.getSize();
    const toPixel = (pt: LatLngTuple) => { const p = map.latLngToContainerPoint([pt[0], pt[1]]); return { x: p.x, y: p.y }; };
    return {
      mapSize: { w: size.x, h: size.y },
      pixelPoints: points.map(toPixel),
      pixelCompletedZones: completedZones.map((zone) => zone.map(toPixel)),
    };
  }, [map, active, frozen, points, completedZones]);

  // Debounce single click vs double-click
  useMapEvents({
    click(e) {
      if (!active) return;
      if (pendingClickRef.current) clearTimeout(pendingClickRef.current.timer);
      pendingClickRef.current = {
        latlng: e.latlng,
        timer: setTimeout(() => {
          pendingClickRef.current = null;
          onPointAdded([e.latlng.lat, e.latlng.lng]);
        }, 250),
      };
    },
    dblclick() {
      if (!active) return;
      if (pendingClickRef.current) {
        clearTimeout(pendingClickRef.current.timer);
        pendingClickRef.current = null;
      }
      if (points.length >= 3) onDoubleClickFinish();
    },
  });

  // Render completed zones as solid red polygons
  useEffect(() => {
    if (!map) return;
    if (completedLayerRef.current) { completedLayerRef.current.clearLayers(); map.removeLayer(completedLayerRef.current); completedLayerRef.current = null; }
    if (completedZones.length === 0) return;
    const group = L.layerGroup().addTo(map);
    completedLayerRef.current = group;
    completedZones.forEach((zonePoints) => {
      if (zonePoints.length >= 3) {
        L.polygon(zonePoints as L.LatLngTuple[], { color: ZONE_RED, weight: 2, fillColor: ZONE_RED, fillOpacity: 0 }).addTo(group);
      }
    });
    return () => {
      if (completedLayerRef.current) { completedLayerRef.current.clearLayers(); map.removeLayer(completedLayerRef.current); completedLayerRef.current = null; }
    };
  }, [map, completedZones]);

  // Leaflet polygon outline (red) — in-progress zone
  useEffect(() => {
    if (!map) return;
    if (polygonLayerRef.current) { map.removeLayer(polygonLayerRef.current); polygonLayerRef.current = null; }
    if (points.length >= 2) {
      polygonLayerRef.current = L.polygon(points as L.LatLngTuple[], {
        color: ZONE_RED, weight: 2,
        fillColor: ZONE_RED, fillOpacity: 0,
        dashArray: active ? '6,5' : undefined,
      }).addTo(map);
    }
    return () => {
      if (polygonLayerRef.current) { map.removeLayer(polygonLayerRef.current); polygonLayerRef.current = null; }
    };
  }, [map, points, active]);

  // Solid red draggable + right-click-deletable vertex markers
  useEffect(() => {
    if (!map) return;
    if (markerLayerRef.current) { markerLayerRef.current.clearLayers(); map.removeLayer(markerLayerRef.current); }
    if (!active || points.length === 0) return;

    const group = L.layerGroup().addTo(map);
    markerLayerRef.current = group;

    points.forEach((pt, i) => {
      const marker = L.circleMarker([pt[0], pt[1]], {
        radius: 7, color: ZONE_RED, fillColor: ZONE_RED, fillOpacity: 1, weight: 2,
      });
      marker.addTo(group);

      marker.on('mousedown', (downEvt: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(downEvt);
        const onMove = (e: L.LeafletMouseEvent) => { marker.setLatLng(e.latlng); };
        const onUp   = (e: L.LeafletMouseEvent) => {
          map.off('mousemove', onMove); map.off('mouseup', onUp);
          onPointMoved(i, [e.latlng.lat, e.latlng.lng]);
        };
        map.on('mousemove', onMove); map.on('mouseup', onUp);
      });

      marker.on('contextmenu', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e);
        onPointDeleted(i);
      });

      marker.on('mouseover', () => { map.getContainer().style.cursor = 'grab'; });
      marker.on('mouseout',  () => { map.getContainer().style.cursor = active ? 'crosshair' : ''; });
    });

    return () => {
      if (markerLayerRef.current) {
        markerLayerRef.current.clearLayers();
        map.removeLayer(markerLayerRef.current);
        markerLayerRef.current = null;
      }
    };
  }, [map, active, points, onPointMoved, onPointDeleted]);

  // Dim overlay — shows when frozen (all non-idle phases)
  // Punches clear through every completed zone + current in-progress zone (3+ points)
  if (!frozen || mapSize.w === 0) return null;
  const polyStr = pixelPoints.length >= 2 ? pixelPoints.map(p => `${p.x},${p.y}`).join(' ') : '';

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 450, pointerEvents: 'none' }}>
      <svg width={mapSize.w} height={mapSize.h} style={{ display: 'block' }}>
        <defs>
          <mask id="zone-reveal">
            <rect width={mapSize.w} height={mapSize.h} fill="white" />
            {/* Punch through all completed zones */}
            {pixelCompletedZones.map((zone, i) =>
              zone.length >= 3 ? <polygon key={i} points={zone.map(p => `${p.x},${p.y}`).join(' ')} fill="black" /> : null
            )}
            {/* Punch through current in-progress zone */}
            {pixelPoints.length >= 3 && <polygon points={polyStr} fill="black" />}
          </mask>
        </defs>
        <rect width={mapSize.w} height={mapSize.h} fill="rgba(0,20,60,0.35)" mask="url(#zone-reveal)" />
        {polyStr && (
          <polygon points={polyStr} fill="none" stroke={ZONE_RED} strokeWidth={2} strokeDasharray={active ? '6,5' : undefined} />
        )}
      </svg>
    </div>
  );
}
