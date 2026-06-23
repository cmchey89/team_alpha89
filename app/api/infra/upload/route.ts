// app/api/infra/upload/route.ts
//
// Receives already-parsed GeoJSON (parsing happened client-side via gdal3.js
// — see lib/gis/parseGisFile.ts). This route never touches the original
// .gpkg/.shp bytes and needs no GDAL binary, which is what makes it safe to
// run as a standard Vercel serverless function.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { gisUploads } from '@/lib/db/schema';
import { insertInfraLine } from '@/lib/db/spatial';
import { requireUser } from '@/lib/auth/session';

const FeatureInput = z.object({
  utilityType: z.enum(['electrical', 'water', 'gas', 'telecom', 'other']),
  label: z.string().nullable().optional(),
  sourceProperties: z.record(z.unknown()).nullable().optional(),
  geometry: z.object({
    type: z.enum(['LineString', 'MultiLineString']),
    coordinates: z.array(z.unknown()),
  }),
});

const UploadBody = z.object({
  sourceFormat: z.string(),
  features: z.array(FeatureInput).min(1).max(5000),
});

export async function POST(req: NextRequest) {
  const user = await requireUser(req, { role: 'owner' });
  if (!user) {
    return NextResponse.json({ error: 'Owner account required.' }, { status: 401 });
  }

  const json = await req.json().catch(() => null);
  const parsed = UploadBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid upload payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { sourceFormat, features } = parsed.data;
  const uploadId = randomUUID();

  await db.insert(gisUploads).values({
    id: uploadId,
    ownerId: user.id,
    filename: `${sourceFormat}-upload`,
    sourceFormat,
    featureCount: features.length,
    status: 'processing',
  });

  try {
    // MultiLineString features are split into individual LineStrings before
    // insert, since infra_lines models one geometry per row and ST_Intersects
    // works the same either way — splitting just keeps each row's geometry
    // simple and keeps the conflict list (which line, specifically) granular.
    let inserted = 0;
    for (const f of features) {
      const lineStrings: number[][][] =
        f.geometry.type === 'MultiLineString'
          ? (f.geometry.coordinates as number[][][])
          : [f.geometry.coordinates as number[][]];

      for (const coords of lineStrings) {
        await insertInfraLine({
          ownerId: user.id,
          sourceUploadId: uploadId,
          utilityType: f.utilityType,
          label: f.label ?? undefined,
          sourceProperties: (f.sourceProperties as Record<string, unknown>) ?? undefined,
          geometry: { type: 'LineString', coordinates: coords },
        });
        inserted++;
      }
    }

    await db
      .update(gisUploads)
      .set({ status: 'completed', featureCount: inserted })
      .where(eq(gisUploads.id, uploadId));

    return NextResponse.json({ uploadId, inserted });
  } catch (err) {
    await db
      .update(gisUploads)
      .set({ status: 'failed', errorMessage: err instanceof Error ? err.message : String(err) })
      .where(eq(gisUploads.id, uploadId));

    return NextResponse.json(
      { error: 'Failed to save infrastructure lines.', details: String(err) },
      { status: 500 }
    );
  }
}
