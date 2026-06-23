// app/api/auth/logout/route.ts
import { NextResponse } from 'next/server';
import { getSessionCookieName } from '@/lib/auth/session';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(getSessionCookieName(), '', { path: '/', maxAge: 0 });
  return res;
}
