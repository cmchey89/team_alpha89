// lib/db/client.ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set.');
}

// In serverless environments (Vercel functions), each invocation can spin up
// a new connection. `max: 1` plus a global cache avoids exhausting Postgres'
// connection limit — for real production traffic, put this behind a pooler
// (Supabase's built-in pooler on port 6543, or PgBouncer/Neon's pooled URL).
declare global {
  // eslint-disable-next-line no-var
  var __digclear_pg__: ReturnType<typeof postgres> | undefined;
}

const client =
  global.__digclear_pg__ ??
  postgres(process.env.DATABASE_URL, {
    max: 1,
    prepare: false, // required when using a transaction-mode pooler (e.g. Supabase pgbouncer)
  });

if (process.env.NODE_ENV !== 'production') {
  global.__digclear_pg__ = client;
}

export const db = drizzle(client, { schema });
