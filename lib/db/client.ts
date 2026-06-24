import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set.');
  // Neon/Supabase direct connections (port 5432) exhaust the connection limit
  // under Vercel's concurrent serverless model. Use the pooler (port 6543).
  if (url.includes(':5432')) {
    console.warn('[DigClear] DATABASE_URL uses direct port 5432. Switch to the connection pooler (port 6543) to avoid exhausting connections under Vercel serverless.');
  }
  const sql = neon(url);
  return drizzle(sql, { schema });
}

export const db = new Proxy({} as ReturnType<typeof getDb>, {
  get(_target, prop) {
    return getDb()[prop as keyof ReturnType<typeof getDb>];
  },
});
