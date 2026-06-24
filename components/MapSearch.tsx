'use client';

import { useState, useRef } from 'react';
import { useMap } from 'react-leaflet';

interface Result {
  display_name: string;
  lat: string;
  lon: string;
}

export default function MapSearch({ disabled }: { disabled?: boolean }) {
  const map = useMap();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function search(q: string) {
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q.trim()) { setResults([]); setOpen(false); return; }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=sg&q=${encodeURIComponent(q)}`;
        const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
        const data: Result[] = await res.json();
        setResults(data);
        setOpen(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 400);
  }

  function select(r: Result) {
    map.flyTo([parseFloat(r.lat), parseFloat(r.lon)], 18, { duration: 1.2 });
    setQuery(r.display_name.split(',').slice(0, 2).join(','));
    setResults([]);
    setOpen(false);
  }

  return (
    <div style={{
      position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
      zIndex: 1000, width: 360, pointerEvents: disabled ? 'none' : 'auto',
      opacity: disabled ? 0.4 : 1,
    }}>
      <div style={{ position: 'relative' }}>
        <span style={{
          position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
          fontSize: 15, color: '#5a7a9e', pointerEvents: 'none',
        }}>⌕</span>
        <input
          type="text"
          value={query}
          onChange={(e) => search(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Search address or postal code…"
          style={{
            width: '100%', padding: '9px 36px 9px 30px',
            border: '1.5px solid var(--line)',
            borderRadius: 8, fontSize: 14,
            background: '#fff', color: '#0d1f3c',
            boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
            outline: 'none', boxSizing: 'border-box',
          }}
        />
        {loading && (
          <span style={{
            position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
            fontSize: 11, color: '#5a7a9e',
          }}>…</span>
        )}
        {query && !loading && (
          <button
            onMouseDown={() => { setQuery(''); setResults([]); setOpen(false); }}
            style={{
              position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
              background: 'none', border: 'none', cursor: 'pointer',
              color: '#5a7a9e', fontSize: 14, padding: '0 2px',
            }}
          >✕</button>
        )}
      </div>

      {open && results.length > 0 && (
        <ul style={{
          margin: '4px 0 0', padding: 0, listStyle: 'none',
          background: '#fff', border: '1.5px solid var(--line)',
          borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
          overflow: 'hidden',
        }}>
          {results.map((r, i) => (
            <li
              key={i}
              onMouseDown={() => select(r)}
              style={{
                padding: '9px 14px', cursor: 'pointer', fontSize: 13,
                color: '#0d1f3c', borderBottom: i < results.length - 1 ? '1px solid #e8eef7' : 'none',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#dce6f2')}
              onMouseLeave={(e) => (e.currentTarget.style.background = '#fff')}
            >
              {r.display_name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
