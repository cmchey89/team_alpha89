'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'owner' | 'contractor'>('contractor');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
      router.push(user.role === 'owner' ? '/owner/upload' : '/contractor/draw');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="zone-detail">
      <h1>DigClear</h1>

      <div style={{ display: 'flex', marginBottom: 24, borderBottom: '1px solid #ccc' }}>
        {(['login', 'signup'] as const).map((m) => (
          <button
            key={m}
            onClick={() => { setMode(m); setError(null); }}
            style={{
              flex: 1,
              padding: '10px 0',
              background: 'none',
              border: 'none',
              borderBottom: mode === m ? '2px solid #000' : '2px solid transparent',
              fontWeight: mode === m ? 700 : 400,
              cursor: 'pointer',
              fontSize: 15,
            }}
          >
            {m === 'login' ? 'Sign in' : 'Sign up'}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 14 }}>
          <label>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{ display: 'block', width: '100%', padding: 10, marginTop: 6 }}
          />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={mode === 'signup' ? 8 : undefined}
            style={{ display: 'block', width: '100%', padding: 10, marginTop: 6 }}
          />
          {mode === 'signup' && (
            <small style={{ color: '#666' }}>Minimum 8 characters</small>
          )}
        </div>

        {mode === 'signup' && (
          <div style={{ marginBottom: 14 }}>
            <label>I am a…</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as 'owner' | 'contractor')}
              style={{ display: 'block', width: '100%', padding: 10, marginTop: 6 }}
            >
              <option value="contractor">Contractor</option>
              <option value="owner">Infrastructure Owner</option>
            </select>
          </div>
        )}

        {error && <div className="error-box">{error}</div>}
        <button type="submit" disabled={loading} style={{ padding: 12, width: '100%' }}>
          {loading ? '…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
      </form>
    </main>
  );
}
