import { NextResponse } from 'next/server';
import { CHALLENGES, type Challenge } from '@core/interview.ts';
import { fail, ownApplication, requireViewer } from '@/lib/http';
import { readJson } from '@/lib/request';
import { revealAttempt } from '@/lib/runner';
import { currentVersion } from '@/lib/store';
import { applicationView } from '@/lib/view';
import { audited } from '@/lib/audited';

export const dynamic = 'force-dynamic';

/**
 * 결과 통지서를 연다. 열었다고 기록한 뒤에야 그 단계의 합격·불합격과 결과를 담아 돌려준다
 * (열기 전에는 응답에도 담지 않는다). 화면은 받은 결과로 통지서를 펴고 도장을 찍는다.
 */
async function handlePOST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireViewer();
  if ('error' in auth) return auth.error;
  const { body, error } = await readJson<{ challenge?: unknown }>(req);
  if (error) return error;
  const challenge = body?.challenge as Challenge;
  if (!CHALLENGES.includes(challenge)) return fail('알 수 없는 단계입니다.', 400);
  // 끝난 단계면 기록과 조회를 문장 하나로 끝낸다. 못 열었을 때만 왜 못 여는지 다시 읽어 가린다
  const revealed = await revealAttempt((await params).id, auth.viewer.id, challenge);
  if (revealed) return NextResponse.json(await applicationView(revealed.app, revealed.counts));
  const own = await ownApplication(params);
  if ('error' in own) return own.error;
  if (currentVersion(own.app).attempts[challenge]?.status !== 'done') return fail('아직 결과가 없습니다.', 409);
  return fail('결과를 열지 못했습니다. 잠시 뒤 다시 시도해 주세요.', 409);
}

export const POST = audited('result_reveal', handlePOST);
