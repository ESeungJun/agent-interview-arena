import { NextResponse } from 'next/server';
import { fail, ownApplication } from '@/lib/http';
import { setTrashed } from '@/lib/runner';
import { removeApplication } from '@/lib/store';
import { audited } from '@/lib/audited';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/** 휴지통으로 옮기기 */
async function handlePOST(_req: Request, { params }: Params) {
  const own = await ownApplication(params);
  if ('error' in own) return own.error;
  const done = await setTrashed(own.app, true);
  return done.ok ? NextResponse.json({ ok: true }) : fail(done.message, done.status);
}

/** 휴지통에서 되돌리기 */
async function handlePATCH(_req: Request, { params }: Params) {
  const own = await ownApplication(params);
  if ('error' in own) return own.error;
  await setTrashed(own.app, false);
  return NextResponse.json({ ok: true });
}

/** 완전 삭제. 휴지통에 있는 것만 지운다 (쓴 티켓과 받은 경고는 그대로 남는다) */
async function handleDELETE(_req: Request, { params }: Params) {
  const own = await ownApplication(params);
  if ('error' in own) return own.error;
  if (!own.app.trashedAt) return fail('휴지통에 있는 지원서만 완전히 삭제할 수 있습니다.', 409);
  await removeApplication(own.app.id);
  return NextResponse.json({ ok: true });
}

export const POST = audited('application_trash', handlePOST);
export const PATCH = audited('application_restore', handlePATCH);
export const DELETE = audited('application_delete', handleDELETE);
