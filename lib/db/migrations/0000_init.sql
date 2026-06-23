-- lib/db/migrations/0000_init.sql
--
-- Run this once against your Postgres instance BEFORE drizzle-kit push,
-- since Drizzle doesn't know how to enable Postgres extensions itself.
--
-- On Supabase: Dashboard -> Database -> Extensions -> enable "postgis".
-- On Neon / plain Postgres: run this file directly, e.g.
--   psql $DATABASE_URL -f lib/db/migrations/0000_init.sql

CREATE EXTENSION IF NOT EXISTS postgis;

-- Run `npm run db:push` (drizzle-kit) after this to create the tables defined
-- in lib/db/schema.ts. Then come back and run the spatial indexes below —
-- they reference tables that only exist after that push.

-- Spatial indexes are what make ST_Intersects fast at scale (without them,
-- every contractor zone check does a full table scan of infra_lines).
-- Safe to re-run; CREATE INDEX IF NOT EXISTS is idempotent.
CREATE INDEX IF NOT EXISTS infra_lines_geom_idx ON infra_lines USING GIST (geom);
CREATE INDEX IF NOT EXISTS work_zones_geom_idx ON work_zones USING GIST (geom);
