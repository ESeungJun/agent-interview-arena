/** 라우트 공통: 로그인 확인과 본인 지원서 찾기 */
import { NextResponse } from 'next/server';
import { getViewer, type Viewer } from './auth.ts';
import { getApplication, type Application } from './store.ts';

export const fail = (message: string, status: number) => NextResponse.json({ error: message }, { status });

export async function requireViewer(): Promise<{ viewer: Viewer } | { error: NextResponse }> {
  const viewer = await getViewer();
  return viewer ? { viewer } : { error: fail('로그인이 필요합니다.', 401) };
}

/** 남의 지원서는 존재 여부도 알리지 않는다 */
export async function ownApplication(params: Promise<{ id: string }>): Promise<{ viewer: Viewer; app: Application } | { error: NextResponse }> {
  const auth = await requireViewer();
  if ('error' in auth) return auth;
  const app = await getApplication((await params).id);
  if (!app || app.ownerId !== auth.viewer.id) return { error: fail('지원서가 없습니다.', 404) };
  return { viewer: auth.viewer, app };
}
