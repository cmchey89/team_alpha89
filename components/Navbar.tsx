'use client';

import { useRouter } from 'next/navigation';

export default function Navbar({ title }: { title: string }) {
  const router = useRouter();

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  }

  return (
    <nav style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 20px',
      height: '52px',
      background: 'var(--panel)',
      borderBottom: '1px solid var(--line)',
      flexShrink: 0,
    }}>
      <span style={{ fontWeight: 700, fontSize: '15px', color: 'var(--paper)' }}>
        DigClear <span style={{ color: 'var(--grey)', fontWeight: 400 }}>· {title}</span>
      </span>
      <button
        onClick={handleLogout}
        style={{
          background: 'none',
          border: '1px solid var(--line)',
          color: 'var(--grey)',
          padding: '6px 14px',
          borderRadius: '6px',
          cursor: 'pointer',
          fontSize: '13px',
        }}
      >
        Sign out
      </button>
    </nav>
  );
}
