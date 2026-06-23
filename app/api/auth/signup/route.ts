// app/api/auth/signup/route.ts
export const runtime = 'nodejs'; // needs crypto.scrypt, not available on Edge runtime

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { users } from '@/lib/db/schema';
import { hashPassword } from '@/lib/auth/password';
import { createSessionToken, getSessionCookieName } from '@/lib/auth/session';

const SignupBody = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
  role: z.enum(['owner', 'contractor']),
  companyName: z.string().min(1).optional(),
});

export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => null);
  const parsed = SignupBody.safeParse(json);
  if (!parsed.success) {
    const details = parsed.error.flatten();
    console.error('Signup validation failed:', JSON.stringify({ received: json, details }));
    return NextResponse.json(
      { error: 'Invalid signup data', details },
      { status: 400 }
    );
  }
  const { email, password, role, companyName } = parsed.data;

  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing.length > 0) {
    return NextResponse.json({ error: 'An account with this email already exists.' }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);
  const [created] = await db
    .insert(users)
    .values({ email, passwordHash, role, companyName: companyName ?? null })
    .returning();

  const token = createSessionToken({
    id: created.id,
    email: created.email,
    role: created.role as 'owner' | 'contractor',
    companyName: created.companyName,
  });

  const res = NextResponse.json({
    user: { id: created.id, email: created.email, role: created.role },
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
