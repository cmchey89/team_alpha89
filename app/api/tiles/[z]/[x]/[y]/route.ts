export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';

export async function GET(
  req: NextRequest,
  { params }: { params: { z: string; x: string; y: string } }
) {
  const user = await requireUser(req);
  if (!user) return new NextResponse(null, { status: 401 });

  const z = parseInt(params.z, 10);
  const x = parseInt(params.x, 10);
  const y = parseInt(params.y, 10);
  const maxTile = Math.pow(2, z);
  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y)
    || z < 0 || z > 19 || x < 0 || x >= maxTile || y < 0 || y >= maxTile) {
    return new NextResponse(null, { status: 400 });
  }

  try {
    const res = await fetch(`https://tile.openstreetmap.org/${z}/${x}/${y}.png`, {
      headers: { 'User-Agent': 'DigClear/1.0 (underground utility clearance system)' },
    });
    if (!res.ok) return new NextResponse(null, { status: res.status });
    const buf = await res.arrayBuffer();
    return new NextResponse(buf, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}
