import { NextResponse } from 'next/server';
import { MAX_MD_BYTES } from '@core/gate.ts';
import { classifyCharacter } from '@/lib/character';
import { fail, requireViewer } from '@/lib/http';
import { takeCharacterPreview } from '@/lib/limits';
import { readJson } from '@/lib/request';

export const dynamic = 'force-dynamic';

/** 첨부한 .md 의 캐릭터 미리 보기. 지원 전에 성격·직무를 판단해 보여 준다 (Haiku 1회, 같은 .md 는 다시 판단하지 않는다) */
export async function POST(req: Request) {
  const auth = await requireViewer();
  if ('error' in auth) return auth.error;
  const { body, error } = await readJson<{ md?: unknown }>(req);
  if (error) return error;
  const md = typeof body?.md === 'string' ? body.md : '';
  if (!md.trim()) return fail('.md 내용이 비어 있습니다.', 400);
  if (Buffer.byteLength(md, 'utf8') > MAX_MD_BYTES) return fail(`.md 는 ${MAX_MD_BYTES / 1024}KB 이하만 받습니다.`, 400);
  const limited = takeCharacterPreview(auth.viewer.id);
  if (limited) return fail(limited, 429);
  return NextResponse.json(await classifyCharacter(md));
}
