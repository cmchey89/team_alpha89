'use client';

import { useEffect } from 'react';
import { useMap } from 'react-leaflet';

export default function MapFreezer({ frozen }: { frozen: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    if (frozen) {
      map.dragging.disable();
      map.scrollWheelZoom.disable();
      map.doubleClickZoom.disable();
      map.touchZoom.disable();
      map.boxZoom.disable();
      map.keyboard.disable();
    } else {
      map.dragging.enable();
      // leave scroll/double-click disabled — they were never enabled for this app
    }
  }, [map, frozen]);
  return null;
}
