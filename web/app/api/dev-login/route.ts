import { NextResponse } from 'next/server';
import { cleanNickname, DEV_COOKIE, devLoginEnabled } from '@/lib/auth';
import { fail } from '@/lib/http';
import { readJson } from '@/lib/request';

export const dynamic = 'force-dynamic';

/** 로컬 개발용 닉네임 로그인. Supabase 설정이 없고 production 이 아닐 때만 열린다 */
export async function POST(req: Request) {
  if (!devLoginEnabled()) return fail('개발용 로그인은 꺼져 있습니다.', 404);
  const { body, error } = await readJson<{ name?: unknown }>(req);
  if (error) return error;
  const name = cleanNickname(typeof body?.name === 'string' ? body.name : '');
  if (!name) return fail('닉네임을 입력해 주세요 (한글·영문·숫자).', 400);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(DEV_COOKIE, name, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 30 * 86_400 });
  return res;
}
