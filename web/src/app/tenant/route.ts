import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(
    {
      code: 410,
      message: 'deprecated route: use backend /api/v1/auth/me',
    },
    { status: 410 },
  );
}
