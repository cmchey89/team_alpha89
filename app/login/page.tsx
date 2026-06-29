'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get('redirect');
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'owner' | 'contractor'>('contractor');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [redirecting, setRedirecting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/signup';
      const body = mode === 'login'
        ? { email, password }
        : { email, password, role };
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || (mode === 'login' ? 'Login failed.' : 'Sign up failed.'));
      }
      const { user } = await res.json();
      setRedirecting(true);
      router.push(redirectTo || (user.role === 'owner' ? '/owner/upload' : '/contractor/draw'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  }

  if (redirecting) return (
    <main style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', gap: 16,
    }}>
      <div className="fomo-spinner" />
      <p style={{ color: 'var(--grey)', fontSize: 14 }}>Signing in…</p>
    </main>
  );

  return (
    <main style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg)',
      padding: '24px',
    }}>
      <div style={{
        width: '100%',
        maxWidth: '420px',
        background: 'var(--panel)',
        border: '1px solid var(--line)',
        borderRadius: '12px',
        padding: '40px 36px',
      }}>
        <h1 style={{ margin: '0 0 8px', fontSize: '22px', color: 'var(--paper)', fontWeight: 700 }}>
          DigClear
        </h1>
        <p style={{ margin: '0 0 28px', color: 'var(--grey)', fontSize: '14px' }}>
          Underground utility clearance system
        </p>

        {/* Tabs */}
        <div style={{ display: 'flex', marginBottom: '28px', borderBottom: '1px solid var(--line)' }}>
          {(['login', 'signup'] as const).map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); setError(null); }}
              style={{
                flex: 1,
                padding: '10px 0',
                background: 'none',
                border: 'none',
                borderBottom: mode === m ? '2px solid var(--orange)' : '2px solid transparent',
                color: mode === m ? 'var(--paper)' : 'var(--grey)',
                fontWeight: mode === m ? 700 : 400,
                cursor: 'pointer',
                fontSize: '14px',
                transition: 'color 0.15s',
              }}
            >
              {m === 'login' ? 'Sign in' : 'Sign up'}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--paper)', marginBottom: '6px' }}>
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="you@example.com"
              style={{
                display: 'block', width: '100%', padding: '10px 12px',
                background: 'var(--bg)', border: '1px solid var(--line)',
                borderRadius: '6px', color: '#0d1f3c', fontSize: '14px',
              }}
            />
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--paper)', marginBottom: '6px' }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={mode === 'signup' ? 8 : undefined}
              placeholder={mode === 'signup' ? 'Minimum 8 characters' : '••••••••'}
              style={{
                display: 'block', width: '100%', padding: '10px 12px',
                background: '#ffffff', border: '1px solid var(--line)',
                borderRadius: '6px', color: '#0d1f3c', fontSize: '14px',
              }}
            />
          </div>

          {mode === 'signup' && (
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--paper)', marginBottom: '6px' }}>
                I am a…
              </label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as 'owner' | 'contractor')}
                style={{
                  display: 'block', width: '100%', padding: '10px 12px',
                  background: '#ffffff', border: '1px solid var(--line)',
                  borderRadius: '6px', color: '#0d1f3c', fontSize: '14px',
                }}
              >
                <option value="contractor">Contractor</option>
                <option value="owner">Infrastructure Owner</option>
              </select>
            </div>
          )}

          {error && <div className="error-box">{error}</div>}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%', padding: '12px',
              background: 'var(--accent)', color: '#ffffff',
              border: 'none', borderRadius: '6px',
              fontWeight: 700, fontSize: '14px', cursor: 'pointer',
              marginTop: '8px', opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? '…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>
      </div>
    </main>
  );
}
