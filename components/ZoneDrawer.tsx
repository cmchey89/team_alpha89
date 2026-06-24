'use client';

import { useEffect, useRef } from 'react';
import { useMapEvents, Polygon, useMap } from 'react-leaflet';
import type { LatLngTuple } from 'leaflet';
import L from 'leaflet';

interface ZoneDrawerProps {
  active: boolean;
  points: LatLngTuple[];
  onPointAdded: (point: LatLngTuple) => void;
  onPointMoved: (index: number, point: LatLngTuple) => void;
  onDoubleClickFinish: () => void;
}

export default function ZoneDrawer({ active, points, onPointAdded, onPointMoved, onDoubleClickFinish }: ZoneDrawerProps) {
  const map = useMap();
  // Track draggable vertex markers so we can remove/re-add when points change
  const markerLayerRef = useRef<L.LayerGroup | null>(null);

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

  // Rebuild draggable vertex markers whenever points change (and drawing is active)
  useEffect(() => {
    if (!map) return;

    // Remove previous layer group
    if (markerLayerRef.current) {
      markerLayerRef.current.clearLayers();
      map.removeLayer(markerLayerRef.current);
    }

    if (!active || points.length === 0) return;

    const group = L.layerGroup().addTo(map);
    markerLayerRef.current = group;

    points.forEach((pt, i) => {
      const marker = L.circleMarker([pt[0], pt[1]], {
        radius: 6,
        color: '#0072CE',
        fillColor: '#ffffff',
        fillOpacity: 1,
        weight: 2,
        // @ts-ignore — draggable is supported via plugin but we implement manually
      });

      marker.addTo(group);

      // Make vertex draggable via mousedown → mousemove → mouseup
      marker.on('mousedown', (downEvt: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(downEvt);
        map.dragging.disable();

        const onMove = (e: L.LeafletMouseEvent) => {
          marker.setLatLng(e.latlng);
        };
        const onUp = (e: L.LeafletMouseEvent) => {
          map.dragging.enable();
          map.off('mousemove', onMove);
          map.off('mouseup', onUp);
          onPointMoved(i, [e.latlng.lat, e.latlng.lng]);
        };

        map.on('mousemove', onMove);
        map.on('mouseup', onUp);
      });

      // Show move cursor on hover
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
  }, [map, active, points, onPointMoved]);

  return (
    <>
      {points.length >= 2 && (
        <Polygon
          positions={points}
          pathOptions={{ color: '#0072CE', weight: 2, fillColor: '#0072CE', fillOpacity: 0.08, dashArray: '6,5' }}
        />
      )}
    </>
  );
}
