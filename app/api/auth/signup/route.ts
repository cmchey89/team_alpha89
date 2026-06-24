// app/api/auth/signup/route.ts
export const runtime = 'nodejs';
export const maxDuration = 60; // needs crypto.scrypt, not available on Edge runtime

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import { users } from '@/lib/db/schema';
import { hashPassword } from '@/lib/auth/password';
import { createSessionToken, getSessionCookieName } from '@/lib/auth/session';
import { checkRateLimit, clientIp } from '@/lib/auth/rateLimit';

const SignupBody = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
  role: z.enum(['owner', 'contractor']),
  companyName: z.string().min(1).optional(),
});

export async function POST(req: NextRequest) {
  // 5 accounts per IP per hour — stricter than login since signup is slower
  if (!checkRateLimit(`signup:${clientIp(req)}`, 5, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'Too many signup attempts. Please try again later.' }, { status: 429 });
  }

  const json = await req.json().catch(() => null);
  const parsed = SignupBody.safeParse(json);
  if (!parsed.success) {
    const details = parsed.error.flatten();
    // Log only which fields failed — never log raw user input (contains password)
    console.error('Signup validation failed on fields:', Object.keys(details.fieldErrors).join(', '));
    return NextResponse.json(
      { error: 'Invalid signup data', details },
      { status: 400 }
    );
  }
  const { email, password, role, companyName } = parsed.data;

  const passwordHash = await hashPassword(password);

  // onConflictDoNothing makes the INSERT atomic — no SELECT→INSERT race.
  // If email already exists the INSERT is silently skipped and `created` is undefined.
  const [created] = await db
    .insert(users)
    .values({ email, passwordHash, role, companyName: companyName ?? null })
    .onConflictDoNothing()
    .returning();

  if (!created) {
    return NextResponse.json({ error: 'An account with this email already exists.' }, { status: 409 });
  }

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
    sameSite: 'strict',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });
  return res;
}
