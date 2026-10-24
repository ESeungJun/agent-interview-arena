/**
 * 누가 보고 있는지. 운영은 Supabase Auth(Google 로그인) 세션 쿠키에서, 로컬 개발은 개발용 닉네임 쿠키에서 읽는다.
 * 개발용 로그인은 Supabase 설정이 없고 production 이 아닐 때만 켜진다.
 */
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getDb } from './db.ts';

/** email·provider 는 운영 기록과 운영자 화면에만 쓴다. 공개 화면에는 name 만 나간다 */
export type Viewer = { id: string; name: string; email?: string; provider?: string };

export const SUPABASE = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
};
export const supabaseEnabled = () => Boolean(SUPABASE.url && SUPABASE.anonKey);
export const devLoginEnabled = () => !supabaseEnabled() && process.env.NODE_ENV !== 'production';
export const DEV_COOKIE = 'arena_dev_user';

/** 서버 컴포넌트·라우트에서 쓰는 Supabase 클라이언트 (세션 쿠키를 읽고, 갱신되면 다시 쓴다) */
export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(SUPABASE.url, SUPABASE.anonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: list => {
        // 서버 컴포넌트에서는 쿠키를 쓸 수 없다. 세션 갱신은 proxy.ts 가 맡는다
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {}
      },
    },
  });
}

/** 개발용 닉네임에서 쓸 수 있는 글자만 남긴다 */
export const cleanNickname = (name: string) => name.replace(/[^\w가-힣.-]/g, '').slice(0, 24);

export async function getViewer(): Promise<Viewer | null> {
  if (supabaseEnabled()) {
    const { data } = await (await supabaseServer()).auth.getUser();
    const user = data.user;
    if (!user) return null;
    // 구글 계정 이름은 실명이라 명예의 전당에 그대로 내보내지 않는다. 이메일도 공개하지 않는다 (운영자 화면에서만 본다)
    const fallback = `지원자-${user.id.slice(0, 6)}`;
    return { id: user.id, name: fallback, email: user.email ?? undefined, provider: user.app_metadata?.provider ?? 'google' };
  }
  if (!devLoginEnabled()) return null;
  const nick = cleanNickname((await cookies()).get(DEV_COOKIE)?.value ?? '');
  return nick ? { id: `dev:${nick}`, name: nick, provider: 'dev' } : null;
}

/** 계정 행을 만들거나 맞춘다 (지원·리더보드에 쓰인다). login 이면 마지막 로그인 시각도 남긴다 */
export async function ensureAccount(viewer: Viewer, opts: { login?: boolean } = {}): Promise<void> {
  await (await getDb()).query(
    `insert into accounts (id, display_name, email, provider, last_login_at) values ($1, $2, $3, $4, case when $5 then now() end)
     on conflict (id) do update set display_name = excluded.display_name, email = coalesce(excluded.email, accounts.email),
       provider = coalesce(excluded.provider, accounts.provider), last_login_at = coalesce(excluded.last_login_at, accounts.last_login_at)`,
    [viewer.id, viewer.name, viewer.email ?? null, viewer.provider ?? null, Boolean(opts.login)],
  );
}
