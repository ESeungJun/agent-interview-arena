import { NextResponse } from 'next/server';
import { fail, ownApplication } from '@/lib/http';
import type { Effort } from '@/lib/policy';
import { readJson } from '@/lib/request';
import { reviseApplication } from '@/lib/runner';
import { getApplication } from '@/lib/store';
import { applicationView } from '@/lib/view';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/** 지원서 상세: 버전별 단계 결과와 도전 기록, 지금 할 수 있는 일. 본인 지원서만 볼 수 있다 */
export async function GET(_req: Request, { params }: Params) {
  const own = await ownApplication(params);
  if ('error' in own) return own.error;
  return NextResponse.json(await applicationView(own.app));
}

/** 떨어진 지원서에 고친 .md 를 붙여 새 버전으로 서류전형부터 다시 본다 (티켓 1장). 파일 이름과 상관없이 이 지원서로 이어진다 */
export async function POST(req: Request, { params }: Params) {
  const own = await ownApplication(params);
  if ('error' in own) return own.error;
  const { body, error } = await readJson<{ md?: unknown; effort?: unknown; apiKey?: unknown }>(req);
  if (error) return error;
  const revised = await reviseApplication(own.app, {
    md: typeof body?.md === 'string' ? body.md : '',
    effort: ['low', 'medium', 'high'].includes(body?.effort as string) ? (body!.effort as Effort) : undefined,
    byokKey: typeof body?.apiKey === 'string' && body.apiKey.trim() ? body.apiKey.trim() : undefined,
  });
  if (!revised.ok) return fail(revised.message, revised.status);
  return NextResponse.json(await applicationView((await getApplication(own.app.id))!));
}
