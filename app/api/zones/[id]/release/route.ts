// app/api/zones/[id]/release/route.ts
//
// Returns the actual conflicting infra line geometry and details for a work
// zone — but ONLY if that zone's status is 'affected_paid' in the database.
// This check happens server-side against the DB record (set by the webhook
// handler), never against anything the client claims — a contractor cannot
// unlock this by sending `paid: true` in the request, only FOMO Pay's
// verified webhook can flip that flag.

export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { workZones, workZoneConflicts, infraLines } from '@/lib/db/schema';
import { requireUser } from '@/lib/auth/session';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const contractor = await requireUser(req, { role: 'contractor' });
  if (!contractor) {
    return NextResponse.json({ error: 'Contractor account required.' }, { status: 401 });
  }

  const zoneRows = await db.select().from(workZones).where(eq(workZones.id, params.id)).limit(1);
  const zone = zoneRows[0];

  if (!zone || zone.contractorId !== contractor.id) {
    return NextResponse.json({ error: 'Work zone not found.' }, { status: 404 });
  }

  if (zone.status === 'clear') {
    return NextResponse.json({ cleared: true, conflicts: [] });
  }

  if (zone.status !== 'affected_paid') {
    // This is the actual enforcement point. Even if a contractor somehow
    // calls this endpoint directly while unpaid, they get nothing back.
    return NextResponse.json(
      { error: 'Payment required before the drawing can be released.', status: zone.status },
      { status: 402 } // 402 Payment Required
    );
  }

  const conflictRows = await db
    .select({
      infraLineId: infraLines.id,
      utilityType: infraLines.utilityType,
      label: infraLines.label,
      geom: infraLines.geom,
    })
    .from(workZoneConflicts)
    .innerJoin(infraLines, eq(workZoneConflicts.infraLineId, infraLines.id))
    .where(eq(workZoneConflicts.workZoneId, zone.id));

  return NextResponse.json({
    cleared: false,
    reference: zone.reference,
    conflicts: conflictRows,
  });
}
