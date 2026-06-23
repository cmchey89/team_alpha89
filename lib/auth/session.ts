// lib/auth/session.ts
//
// Minimal JWT-based session layer. This is intentionally provider-agnostic:
// if you choose Supabase later, swap the body of `requireUser` to call
// `supabase.auth.getUser()` instead and keep the same function signature —
// nothing in the API routes that call `requireUser` needs to change.
//
// For now this implements a self-rolled session so the app works against
// plain Postgres (Neon or otherwise) with zero external auth dependency.

import { NextRequest } from 'next/server';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { users } from '@/lib/db/schema';

const SESSION_COOKIE = 'digclear_session';

export interface SessionUser {
  id: string;
  email: string;
  role: 'owner' | 'contractor';
  companyName: string | null;
}

function getJwtSecret(): string {
  const secret = process.env.SESSION_JWT_SECRET;
  if (!secret) {
    throw new Error(
      'SESSION_JWT_SECRET is not set. Generate one with `openssl rand -base64 32` and add it to .env.local.'
    );
  }
  return secret;
}

export function createSessionToken(user: SessionUser): string {
  return jwt.sign(user, getJwtSecret(), { expiresIn: '7d' });
}

export function getSessionCookieName() {
  return SESSION_COOKIE;
}

/**
 * Verifies the session cookie on an incoming request and optionally enforces
 * a required role (e.g. only an 'owner' can hit the infra upload route).
 * Returns null (never throws) if there's no valid session — callers should
 * respond 401 themselves, since the right error shape differs per-route.
 */
export async function requireUser(
  req: NextRequest,
  opts?: { role?: 'owner' | 'contractor' }
): Promise<SessionUser | null> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  let decoded: SessionUser;
  try {
    decoded = jwt.verify(token, getJwtSecret()) as SessionUser;
  } catch {
    return null; // expired or tampered token
  }

  if (opts?.role && decoded.role !== opts.role) {
    return null;
  }

  // Re-check against the DB rather than trusting the token's claims blindly —
  // covers the case where a user's role changed or the account was disabled
  // after the token was issued. Slightly more DB load per request; worth it
  // for a payment-gated system. Cache this with a short TTL if it becomes
  // a bottleneck at scale.
  const rows = await db.select().from(users).where(eq(users.id, decoded.id)).limit(1);
  const dbUser = rows[0];
  if (!dbUser) return null;
  if (opts?.role && dbUser.role !== opts.role) return null;

  return {
    id: dbUser.id,
    email: dbUser.email,
    role: dbUser.role as 'owner' | 'contractor',
    companyName: dbUser.companyName,
  };
}
