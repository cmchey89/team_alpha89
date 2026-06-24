'use client';

import { useRouter } from 'next/navigation';

export default function Navbar({ title, userEmail, role }: { title: string; userEmail?: string; role?: string }) {
  const router = useRouter();

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  }

  return (
    <nav className="titleblock">
      <div className="tb-left">
        <div className="logo">
          <span className="logo-dot" />
          DIGCLEAR
        </div>
        {role && (
          <div className={`mode-pill ${role}`}>
            {role === 'contractor' ? 'CONTRACTOR VIEW' : 'OWNER SETUP'}
          </div>
        )}
      </div>
      <div className="tb-right">
        {userEmail && (
          <div className="user-chip">
            <span className="pulse-dot" />
            <span className="who">{userEmail}</span>
          </div>
        )}
        <button className="text-btn" onClick={handleLogout}>Sign out</button>
      </div>
    </nav>
  );
}
