'use client';

import { useMap } from 'react-leaflet';
import type L from 'leaflet';

interface Props {
  onMap: (map: L.Map) => void;
}

// Renders inside MapContainer context — captures the Leaflet map instance and
// hands it to the parent via onMap so the parent can call dragging.disable()
// synchronously from a button click handler, before any React effect runs.
export default function MapCapture({ onMap }: Props) {
  const map = useMap();
  // Ref mutation during render is fine — triggers no re-render, no state update.
  onMap(map);
  return null;
}
