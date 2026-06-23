// lib/auth/password.ts
//
// Uses Node's built-in crypto.scrypt rather than adding a bcrypt dependency —
// bcrypt's native bindings are a common source of Vercel build failures
// (it needs a native compile step that doesn't always play nicely with
// serverless build images). scrypt is built into Node and works everywhere
// Next.js runs, including Vercel's standard Node.js runtime.
//
// NOTE: Vercel Edge Runtime does NOT have Node's crypto module. The routes
// using this file must declare `export const runtime = 'nodejs'` (the
// default for Next.js Route Handlers, but stated explicitly in those files
// for clarity).

import { randomBytes, scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = (await scryptAsync(plain, salt, KEY_LENGTH)) as Buffer;
  return `${salt}:${derivedKey.toString('hex')}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const [salt, hashHex] = stored.split(':');
  if (!salt || !hashHex) return false;
  const derivedKey = (await scryptAsync(plain, salt, KEY_LENGTH)) as Buffer;
  const storedKey = Buffer.from(hashHex, 'hex');
  if (derivedKey.length !== storedKey.length) return false;
  return timingSafeEqual(derivedKey, storedKey);
}
