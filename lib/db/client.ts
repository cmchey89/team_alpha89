// lib/db/client.ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

declare global {
  // eslint-disable-next-line no-var
  var __digclear_pg__: ReturnType<typeof postgres> | undefined;
}

function getDb() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set.');
  }
  const client =
    global.__digclear_pg__ ??
    postgres(process.env.DATABASE_URL, {
      max: 1,
      prepare: false,
    });
  if (process.env.NODE_ENV !== 'production') {
    global.__digclear_pg__ = client;
  }
  return drizzle(client, { schema });
}

export const db = new Proxy({} as ReturnType<typeof getDb>, {
  get(_target, prop) {
    return getDb()[prop as keyof ReturnType<typeof getDb>];
  },
});
