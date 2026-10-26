/**
 * Supabase 로그인 세션을 요청마다 갱신한다 (만료 직전 토큰을 새로 받아 쿠키에 다시 쓴다).
 * Supabase 설정이 없으면(로컬 개발) 아무것도 하지 않는다.
 */
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/** 다른 사이트에서 보낸 상태 변경 요청을 막는다 (쿠키가 SameSite=Lax 라 기본으로 막히지만 한 겹 더) */
function crossSite(req: NextRequest): boolean {
  if (req.method === 'GET' || req.method === 'HEAD' || !req.nextUrl.pathname.startsWith('/api/')) return false;
  const origin = req.headers.get('origin');
  if (!origin) return false;
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

export async function proxy(req: NextRequest) {
  if (crossSite(req)) return NextResponse.json({ error: '다른 사이트에서 보낸 요청은 받지 않습니다.' }, { status: 403 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  let res = NextResponse.next({ request: req });
  if (!url || !key) return res;
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: list => {
        for (const { name, value } of list) req.cookies.set(name, value);
        res = NextResponse.next({ request: req });
        for (const { name, value, options } of list) res.cookies.set(name, value, options);
      },
    },
  });
  // 만료된 토큰만 새로 받는다. 서명은 공개 키로 바로 검증해 요청마다 인증 서버를 다녀오지 않는다
  await supabase.auth.getClaims();
  return res;
}

export const config = {
  // 정적 파일과 이미지는 세션을 볼 필요가 없다
  matcher: ['/((?!_next/static|_next/image|pixel/|favicon.ico).*)'],
};
