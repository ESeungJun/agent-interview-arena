import { NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth';
import { ticketsUsedToday } from '@/lib/runner';

export const dynamic = 'force-dynamic';

/** 지금 로그인한 사람과 오늘 쓴 체급별 티켓 */
export async function GET() {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ viewer: null });
  return NextResponse.json({ viewer, ticketsUsed: await ticketsUsedToday(viewer.id) });
}
