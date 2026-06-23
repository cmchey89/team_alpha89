// components/ZoneDrawer.tsx
//
// Renders inside a react-leaflet <MapContainer>. This is a CONTROLLED
// component: the parent page owns the `points` array in its own state and
// passes it down, so a toolbar "Done" button can finish the zone at any
// time — not just on double-click. This avoids the awkward problem of a
// child component's local state being unreachable from a sibling toolbar
// button.

'use client';

import { useMapEvents, Polygon, CircleMarker } from 'react-leaflet';
import type { LatLngTuple } from 'leaflet';

interface ZoneDrawerProps {
  active: boolean;
  points: LatLngTuple[];
  onPointAdded: (point: LatLngTuple) => void;
  onDoubleClickFinish: () => void;
}

export default function ZoneDrawer({ active, points, onPointAdded, onDoubleClickFinish }: ZoneDrawerProps) {
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

  return (
    <>
      {points.length >= 2 && (
        <Polygon
          positions={points}
          pathOptions={{ color: '#5FBE8E', weight: 2, fillColor: '#5FBE8E', fillOpacity: 0.15, dashArray: '6,5' }}
        />
      )}
      {points.map((p, i) => (
        <CircleMarker
          key={i}
          center={p}
          radius={4}
          pathOptions={{ color: '#5FBE8E', fillColor: '#5FBE8E', fillOpacity: 1 }}
        />
      ))}
    </>
  );
}

