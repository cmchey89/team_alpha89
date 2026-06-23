export const runtime = 'nodejs';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { requireUser } from '@/lib/auth/session';

export async function DELETE(req: NextRequest) {
  const user = await requireUser(req, { role: 'owner' });
  if (!user) {
    return NextResponse.json({ error: 'Owner account required.' }, { status: 401 });
  }

  const sql = neon(process.env.DATABASE_URL!);
  await sql`DELETE FROM infra_lines WHERE owner_id = ${user.id}`;
  await sql`DELETE FROM gis_uploads WHERE owner_id = ${user.id}`;

  return NextResponse.json({ deleted: true });
}
