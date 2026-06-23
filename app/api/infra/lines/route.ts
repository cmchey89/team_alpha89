export const runtime = 'nodejs';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { requireUser } from '@/lib/auth/session';

export async function GET(req: NextRequest) {
  const user = await requireUser(req, { role: 'owner' });
  if (!user) {
    return NextResponse.json({ error: 'Owner account required.' }, { status: 401 });
  }

  const sql = neon(process.env.DATABASE_URL!);
  const rows = await sql`
    SELECT
      id,
      utility_type AS "utilityType",
      label,
      ST_AsGeoJSON(geom)::json AS geometry
    FROM infra_lines
    WHERE owner_id = ${user.id}
    ORDER BY created_at DESC
  `;

  return NextResponse.json({ lines: rows });
}
