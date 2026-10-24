import { NextResponse } from 'next/server';
import { fail } from '@/lib/http';
import { leaderboard } from '@/lib/leaderboard';
import { isDivision } from '@/lib/policy';
import { audited } from '@/lib/audited';

export const dynamic = 'force-dynamic';

/** 체급별 명예의 전당. 로그인하지 않아도 볼 수 있다 */
async function handleGET(req: Request) {
  const division = new URL(req.url).searchParams.get('division') ?? 'light';
  if (!isDivision(division)) return fail('알 수 없는 체급입니다.', 400);
  return NextResponse.json(await leaderboard(division));
}

export const GET = audited('leaderboard_view', handleGET);
