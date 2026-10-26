import { NextResponse } from 'next/server';
import { CHALLENGES, type Challenge } from '@core/interview.ts';
import { fail, requireViewer } from '@/lib/http';
import { readJson } from '@/lib/request';
import { startChallenge } from '@/lib/runner';
import { applicationView } from '@/lib/view';
import { audited } from '@/lib/audited';

export const dynamic = 'force-dynamic';

/** 지금 버전의 다음 단계 도전 (티켓을 쓰지 않는다). 서버 오류로 끝난 단계도 다시 도전할 수 있다. 무제한급은 지원자 키가 필요하다 */
async function handlePOST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireViewer();
  if ('error' in auth) return auth.error;
  const { body, error } = await readJson<{ challenge?: unknown; apiKey?: unknown }>(req);
  if (error) return error;
  const challenge = body?.challenge as Challenge;
  if (!CHALLENGES.includes(challenge)) return fail('알 수 없는 단계입니다.', 400);
  // 본인 지원서인지는 접수하며 행을 잠글 때 함께 본다. 접수한 지원서와 계정 수치를 그대로 내려 다시 읽지 않는다
  const started = await startChallenge((await params).id, auth.viewer.id, challenge, typeof body?.apiKey === 'string' && body.apiKey.trim() ? body.apiKey.trim() : undefined);
  if (!started.ok) return fail(started.message, started.status);
  return NextResponse.json(await applicationView(started.app, started.counts));
}

export const POST = audited('challenge_start', handlePOST);
