'use client';

import { useMapEvents } from 'react-leaflet';

export interface MapView {
  zoom: number;
  bounds: { minLng: number; maxLng: number; minLat: number; maxLat: number };
}

export default function MapTracker({ onChange }: { onChange: (view: MapView) => void }) {
  useMapEvents({
    moveend(e) {
      const map = e.target;
      const b = map.getBounds();
      onChange({
        zoom: map.getZoom(),
        bounds: {
          minLng: b.getWest(),
          maxLng: b.getEast(),
          minLat: b.getSouth(),
          maxLat: b.getNorth(),
        },
      });
    },
    zoomend(e) {
      const map = e.target;
      const b = map.getBounds();
      onChange({
        zoom: map.getZoom(),
        bounds: {
          minLng: b.getWest(),
          maxLng: b.getEast(),
          minLat: b.getSouth(),
          maxLat: b.getNorth(),
        },
      });
    },
  });
  return null;
}
