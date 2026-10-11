import { NextResponse } from 'next/server';
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
    return new NextResponse(null, { status: 404 });
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/api/v1/storefront/lookbooks/images/${id}`,
      { cache: 'force-cache', signal: AbortSignal.timeout(15000) },
    );
    if (!res.ok) return new NextResponse(null, { status: res.status === 404 ? 404 : 502 });
    return new NextResponse(await res.arrayBuffer(), {
      headers: {
        'Content-Type': 'image/webp',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}
