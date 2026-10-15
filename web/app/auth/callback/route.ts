import { NextResponse } from 'next/server';
import { supabaseEnabled, supabaseServer } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** 돌아갈 사이트 주소. 프록시 뒤에서는 요청 주소가 내부 호스트일 수 있어 SITE_URL 을 먼저 쓴다 */
function siteUrl(req: Request): string {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/+$/, '');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  const proto = req.headers.get('x-forwarded-proto') ?? new URL(req.url).protocol.replace(':', '');
  return host ? `${proto}://${host}` : new URL(req.url).origin;
}

/** GitHub 로그인 뒤 돌아오는 곳. 받은 코드를 세션으로 바꾸고 바탕화면으로 보낸다 */
export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get('code');
  const home = siteUrl(req);
  if (!supabaseEnabled() || !code) return NextResponse.redirect(`${home}/`);
  const { error } = await (await supabaseServer()).auth.exchangeCodeForSession(code);
  return NextResponse.redirect(error ? `${home}/?login=failed` : `${home}/`);
}
