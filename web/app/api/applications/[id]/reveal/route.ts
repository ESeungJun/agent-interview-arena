import { NextResponse } from 'next/server';
import { CHALLENGES, type Challenge } from '@core/interview.ts';
import { fail, ownApplication } from '@/lib/http';
import { readJson } from '@/lib/request';
import { currentVersion, getApplication, mutateAttempt } from '@/lib/store';
import { applicationView } from '@/lib/view';

export const dynamic = 'force-dynamic';

/**
 * 결과 통지서를 연다. 열었다고 기록한 뒤에야 그 단계의 합격·불합격과 결과를 담아 돌려준다
 * (열기 전에는 응답에도 담지 않는다). 화면은 받은 결과로 통지서를 펴고 도장을 찍는다.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const own = await ownApplication(params);
  if ('error' in own) return own.error;
  const { body, error } = await readJson<{ challenge?: unknown }>(req);
  if (error) return error;
  const challenge = body?.challenge as Challenge;
  if (!CHALLENGES.includes(challenge)) return fail('알 수 없는 단계입니다.', 400);
  const v = currentVersion(own.app);
  if (v.attempts[challenge]?.status !== 'done') return fail('아직 결과가 없습니다.', 409);
  await mutateAttempt(own.app.id, v.n, challenge, a => (a.revealedAt ? a : { ...a, revealedAt: new Date().toISOString() }));
  return NextResponse.json(await applicationView((await getApplication(own.app.id))!));
}
