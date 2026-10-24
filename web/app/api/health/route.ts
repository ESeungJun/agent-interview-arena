import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** ?db=1 이면 DB 까지 열어 본다. 값은 숨기고 연결 종류와 오류 코드만 알려 준다 (컨테이너 생존 확인은 DB 없이 빨리 답한다) */
export async function GET(request: Request) {
  const ts = new Date().toISOString();
  if (new URL(request.url).searchParams.get('db') !== '1') return Response.json({ ok: true, ts });
  try {
    const db = await getDb();
    await db.query('select 1');
    return Response.json({ ok: true, ts, db: db.kind });
  } catch (e) {
    const err = e as { code?: string; name?: string };
    console.error('[health] DB 연결 실패', e);
    return Response.json({ ok: false, ts, db: 'error', code: err.code ?? err.name ?? 'unknown' }, { status: 503 });
  }
}
