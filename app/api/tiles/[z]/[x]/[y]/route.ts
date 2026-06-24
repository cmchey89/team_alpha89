import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  _req: NextRequest,
  { params }: { params: { z: string; x: string; y: string } }
) {
  const { z, x, y } = params;
  const url = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
  try {
    const res = await fetch(url, {
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
