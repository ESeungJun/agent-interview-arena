/**
 * 누가 보고 있는지. 운영은 Supabase Auth(GitHub 로그인) 세션 쿠키에서, 로컬 개발은 개발용 닉네임 쿠키에서 읽는다.
 * 개발용 로그인은 Supabase 설정이 없고 production 이 아닐 때만 켜진다.
 */
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getDb } from './db.ts';

export type Viewer = { id: string; name: string };

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
    // 표시 이름은 GitHub 이 준 신원 정보에서 읽는다. user_metadata 는 사용자가 직접 고칠 수 있어 남을 사칭할 수 있고,
    // 이메일은 명예의 전당에 공개되면 안 되므로 쓰지 않는다
    const github = user.identities?.find(i => i.provider === 'github')?.identity_data as { user_name?: string; preferred_username?: string } | undefined;
    const name = github?.user_name ?? github?.preferred_username ?? `지원자-${user.id.slice(0, 6)}`;
    return { id: user.id, name: cleanNickname(name) || `지원자-${user.id.slice(0, 6)}` };
  }
  if (!devLoginEnabled()) return null;
  const nick = cleanNickname((await cookies()).get(DEV_COOKIE)?.value ?? '');
  return nick ? { id: `dev:${nick}`, name: nick } : null;
}

/** 계정 행을 만들거나 표시 이름을 맞춘다 (지원·리더보드에 쓰인다) */
export async function ensureAccount(viewer: Viewer): Promise<void> {
  await (await getDb()).query(
    'insert into accounts (id, display_name) values ($1, $2) on conflict (id) do update set display_name = excluded.display_name',
    [viewer.id, viewer.name],
  );
}
