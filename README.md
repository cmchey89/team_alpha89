# DigClear

Underground utility clearance system: an infrastructure owner uploads a GIS
baseline (from QGIS, exported as GeoPackage), contractors draw a working
zone on a map, the system checks it against the baseline, and gates the
detailed drawing behind FOMO Pay payment if the zone is affected.

## What this is, honestly

This is a real, complete Next.js application scaffold — not a mockup. The
business logic (PostGIS spatial queries, payment-gated drawing release,
client-side GIS parsing) is fully implemented. But it has **not been run
against a live database, a live FOMO Pay account, or a real `.gpkg` file**,
because this was built in a sandboxed environment with no network access and
no way to `npm install` real packages. Before you rely on this in
production, budget time to verify the items in **"What needs hands-on
verification"** below — none of them are guesswork dressed up as fact, but
none of them have been executed either.

## Architecture

- **Next.js 14 (App Router)**, deployed to Vercel.
- **Postgres + PostGIS** for storage and spatial queries (`ST_Intersects`
  does the actual "does this zone overlap that line" check — see
  `lib/db/spatial.ts`). Provider-agnostic: works with Supabase, Neon, or any
  Postgres with the `postgis` extension enabled.
- **GIS parsing happens entirely in the browser**, via `gdal3.js` (GDAL
  compiled to WebAssembly — see `lib/gis/parseGisFile.ts`). This is why
  Vercel's standard serverless functions are sufficient: the server never
  receives raw `.gpkg`/`.shp` bytes, only the GeoJSON the browser already
  extracted from them.
- **Auth**: a minimal self-rolled JWT session (`lib/auth/session.ts`), kept
  deliberately swappable — if you'd rather use Supabase Auth, replace the
  body of `requireUser()` and nothing else needs to change.
- **Payments**: FOMO Pay, via the adapter in `lib/payments/fomoPay.ts`. See
  the FOMO Pay section below — this is the part most in need of your review.

## About your .qgz file specifically

A `.qgz`/`.qgs` QGIS project file is a project/styling file — it points to
your actual data (shapefiles, GeoPackage, etc.) by file path, it does not
contain the geometry itself. Uploading just the `.qgz` gives the system
nothing to parse.

Before uploading, in QGIS: right-click your layer(s) -> Export -> Save
Features As... -> format GeoPackage. This bundles everything into one
`.gpkg` file with no external path dependencies. Upload that instead. The
upload page (`app/owner/upload/page.tsx`) explicitly rejects `.qgz`/`.qgs`
uploads with this same explanation, rather than silently failing.

## Getting started

```
npm install
cp .env.example .env.local
```

Fill in `.env.local`, then enable PostGIS and push the schema:

```
psql $DATABASE_URL -f lib/db/migrations/0000_init.sql
npm run db:push
psql $DATABASE_URL -f lib/db/migrations/0000_init.sql
```

(Running the migration file twice is intentional: once before `db:push` to
enable the `postgis` extension, once after to add the spatial indexes,
which reference tables that only exist post-push.)

```
npm run dev
```

## Deploying to Vercel

1. Push this repo to GitHub.
2. Import it in Vercel.
3. Add the environment variables from `.env.example` under Project Settings
   -> Environment Variables.
4. Deploy. No special build configuration is needed since GIS parsing runs
   client-side, so there's no GDAL binary for Vercel's build to worry about.

## What needs hands-on verification before production

These aren't bugs I found and left in. They're the specific places where
"correct based on documentation" and "confirmed by actually running it"
diverge, because this sandboxed environment couldn't run them.

1. lib/gis/parseGisFile.ts, the gdal3.js API calls. The method names
   (Gdal.open, Gdal.ogr2ogr, Gdal.ogrinfo, Gdal.getOutputFile) are based on
   gdal3.js's published docs, but this has not been run against a real
   .gpkg file. Test this first, with a small real GeoPackage, before
   building anything else on top of it.

2. lib/payments/fomoPay.ts, every field name and endpoint path. FOMO Pay's
   actual Web Payment API spec is a document you download after registering
   as a merchant at developers.fomopay.com; it could not be accessed from
   here. Every "TODO: confirm" comment in that file marks a specific
   guess: the request shape, the auth header, the webhook signature
   algorithm, the webhook payload fields. The overall flow (create payment
   -> redirect -> webhook -> verify signature -> mark paid) is standard and
   almost certainly right; the field names need a side-by-side check
   against the real doc.

3. package.json dependency versions. Written from training knowledge, not
   checked against the live npm registry. Run npm install and let npm
   resolve to current compatible versions; if anything's deprecated, npm
   outdated will tell you.

4. Vercel's serverless function behavior: DB connection handling
   (lib/db/client.ts uses max: 1 per the standard serverless-Postgres
   advice) and the next.config.js WASM/webpack settings are correct in
   principle but worth confirming against Vercel's current docs, since
   platform specifics shift over time.

## Known simplifications in this scaffold

- Single-owner assumption: the contractor draw page hardcodes
  NEXT_PUBLIC_DEFAULT_OWNER_ID. A multi-tenant version needs an owner
  picker.
- PDF/GeoJSON export on the post-payment page is stubbed with a comment
  pointing at the prototype's buildDrawingSheetPDF() logic, which works
  there; porting it over is mechanical, just omitted here for scope.
- No rate limiting or abuse protection on the zone-check endpoint yet.
- No automated tests. Given the payment-gating logic is the part where a
  bug is most costly (it's the line between "paid" and "free"), prioritize
  testing app/api/zones/[id]/release/route.ts and the webhook handler
  before anything else.
