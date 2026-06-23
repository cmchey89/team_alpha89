export const runtime = 'nodejs';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { neon } from '@neondatabase/serverless';
import { db } from '@/lib/db/client';
import { workZones } from '@/lib/db/schema';
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
    return NextResponse.json({ cleared: true, conflicts: [], zoneGeoJSON: null });
  }

  if (zone.status !== 'affected_paid') {
    if (process.env.BYPASS_PAYMENT === 'true') {
      await db.update(workZones).set({ status: 'affected_paid', paid: true }).where(eq(workZones.id, zone.id));
    } else {
      return NextResponse.json(
        { error: 'Payment required before the drawing can be released.', status: zone.status },
        { status: 402 }
      );
    }
  }

  const sql = neon(process.env.DATABASE_URL!);

  // Return conflict lines as GeoJSON
  const conflictRows = await sql`
    SELECT
      il.id AS "infraLineId",
      il.utility_type AS "utilityType",
      il.label,
      ST_AsGeoJSON(il.geom)::json AS geometry
    FROM work_zone_conflicts wzc
    JOIN infra_lines il ON wzc.infra_line_id = il.id
    WHERE wzc.work_zone_id = ${zone.id}
  `;

  // Return work zone polygon as GeoJSON
  const zoneRows2 = await sql`
    SELECT ST_AsGeoJSON(geom)::json AS geometry FROM work_zones WHERE id = ${zone.id}
  `;

  return NextResponse.json({
    cleared: false,
    reference: zone.reference,
    conflicts: conflictRows,
    zoneGeoJSON: zoneRows2[0]?.geometry ?? null,
  });
}
