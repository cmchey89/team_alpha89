// app/api/auth/login/route.ts
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { users } from '@/lib/db/schema';
import { verifyPassword } from '@/lib/auth/password';
import { createSessionToken, getSessionCookieName } from '@/lib/auth/session';

const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => null);
  const parsed = LoginBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid login data' }, { status: 400 });
  }
  const { email, password } = parsed.data;

  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const user = rows[0];

  // Deliberately give the same error for "no such user" and "wrong password"
  // — distinguishing the two lets an attacker enumerate valid emails.
  const genericError = NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 });
  if (!user) return genericError;

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) return genericError;

  const token = createSessionToken({
    id: user.id,
    email: user.email,
    role: user.role as 'owner' | 'contractor',
    companyName: user.companyName,
  });

  const res = NextResponse.json({
    user: { id: user.id, email: user.email, role: user.role, companyName: user.companyName },
  });
  res.cookies.set(getSessionCookieName(), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });
  return res;
}
