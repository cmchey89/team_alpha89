// app/api/zones/check/route.ts
//
// Receives a contractor's drawn working zone (GeoJSON Polygon), runs the
// real PostGIS intersection check against the owner's infra_lines baseline,
// and returns a result WITHOUT revealing which lines were hit, or where —
// that detail is only released after payment confirms (see
// app/api/zones/[id]/release/route.ts), mirroring the prototype's
// payment-gating behavior exactly.

export const runtime = 'nodejs';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { workZones, workZoneConflicts, users } from '@/lib/db/schema';
import { findConflicts, insertWorkZone } from '@/lib/db/spatial';
import { requireUser } from '@/lib/auth/session';

const CheckBody = z.object({
  ownerId: z.string().uuid(),
  geometry: z.object({
    type: z.literal('Polygon'),
    coordinates: z.array(z.array(z.array(z.number()))),
  }),
  areaSqm: z.number().nonnegative(),
});

function generateReference(): string {
  return 'DC-' + Math.floor(10000 + Math.random() * 90000);
}

export async function POST(req: NextRequest) {
  const contractor = await requireUser(req, { role: 'contractor' });
  if (!contractor) {
    return NextResponse.json({ error: 'Contractor account required.' }, { status: 401 });
  }

  const json = await req.json().catch(() => null);
  console.log('zones/check received:', JSON.stringify(json));
  const parsed = CheckBody.safeParse(json);
  if (!parsed.success) {
    console.error('zones/check validation failed:', JSON.stringify(parsed.error.flatten()));
    return NextResponse.json(
      { error: 'Invalid zone payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { ownerId, geometry, areaSqm } = parsed.data;

  const ownerRows = await db.select().from(users).where(eq(users.id, ownerId)).limit(1);
  if (!ownerRows[0] || ownerRows[0].role !== 'owner') {
    return NextResponse.json({ error: 'Unknown infrastructure owner.' }, { status: 404 });
  }

  const reference = generateReference();
  const zoneId = await insertWorkZone({
    contractorId: contractor.id,
    ownerId,
    reference,
    geometry,
    areaSqm: Math.round(areaSqm),
  });

  const conflicts = await findConflicts(ownerId, geometry);
  const cleared = conflicts.length === 0;

  await db
    .update(workZones)
    .set({
      status: cleared ? 'clear' : 'affected_unpaid',
      checkedAt: new Date(),
    })
    .where(eq(workZones.id, zoneId));

  if (!cleared) {
    // Persist which lines conflicted now, at check time, so the result is
    // stable even if the owner edits their baseline later. The contractor
    // does NOT get this list back in this response — only the count.
    for (const c of conflicts) {
      await db.insert(workZoneConflicts).values({ workZoneId: zoneId, infraLineId: c.infraLineId });
    }
  }

  return NextResponse.json({
    zoneId,
    reference,
    cleared,
    conflictCount: conflicts.length,
    // Deliberately omitted: conflicts[].infraLineId / label / geometry.
    // That detail is only returned by the post-payment release endpoint.
  });
}
