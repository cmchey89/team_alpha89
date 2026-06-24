'use client';

import { useEffect } from 'react';
import { useMap } from 'react-leaflet';

export default function MapFreezer({ frozen }: { frozen: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    if (frozen) {
      map.dragging.disable();
    } else {
      map.dragging.enable();
    }
  }, [map, frozen]);
  return null;
}
