'use client';

import { useLayoutEffect } from 'react';
import { useMap } from 'react-leaflet';

export default function MapFreezer({ frozen }: { frozen: boolean }) {
  const map = useMap();
  // useLayoutEffect fires synchronously before the browser paints, so the map
  // is frozen/unfrozen in the same frame as the button click — no visible gap.
  useLayoutEffect(() => {
    if (!map) return;
    if (frozen) {
      map.dragging.disable();
    } else {
      map.dragging.enable();
    }
  }, [map, frozen]);
  return null;
}
