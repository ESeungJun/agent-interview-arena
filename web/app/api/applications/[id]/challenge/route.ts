import { NextResponse } from 'next/server';
import { CHALLENGES, type Challenge } from '@core/interview.ts';
import { fail, ownApplication } from '@/lib/http';
import { readJson } from '@/lib/request';
import { startChallenge } from '@/lib/runner';
import { getApplication } from '@/lib/store';
import { applicationView } from '@/lib/view';

export const dynamic = 'force-dynamic';

/** 지금 버전의 다음 단계 도전 (티켓을 쓰지 않는다). 서버 오류로 끝난 단계도 다시 도전할 수 있다. 무제한급은 지원자 키가 필요하다 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const own = await ownApplication(params);
  if ('error' in own) return own.error;
  const { body, error } = await readJson<{ challenge?: unknown; apiKey?: unknown }>(req);
  if (error) return error;
  const challenge = body?.challenge as Challenge;
  if (!CHALLENGES.includes(challenge)) return fail('알 수 없는 단계입니다.', 400);
  const started = await startChallenge(own.app, challenge, typeof body?.apiKey === 'string' && body.apiKey.trim() ? body.apiKey.trim() : undefined);
  if (!started.ok) return fail(started.message, started.status);
  return NextResponse.json(await applicationView((await getApplication(own.app.id))!));
}
