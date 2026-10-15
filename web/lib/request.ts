import { NextResponse } from 'next/server';
import { MAX_MD_BYTES } from '../../core/gate.ts';

/** 요청 본문 상한. .md 상한에 JSON 이스케이프와 다른 필드를 넉넉히 더한다 */
const MAX_BODY_BYTES = MAX_MD_BYTES * 2 + 4096;

/**
 * JSON 본문을 상한까지만 읽는다. Content-Length 가 없는 요청(chunked)도 읽으면서 바이트를 세다가 넘치면 끊는다.
 * 넘치면 413 응답을, 형식이 틀리면 null 본문을 돌려준다.
 */
export async function readJson<T>(req: Request): Promise<{ body: T | null; error?: NextResponse }> {
  const tooBig = () => NextResponse.json({ error: `요청이 너무 큽니다. .md 는 ${MAX_MD_BYTES / 1024}KB 이하만 받습니다.` }, { status: 413 });
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return { body: null, error: tooBig() };
  if (!req.body) return { body: null };
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return { body: null, error: tooBig() };
    }
    chunks.push(value);
  }
  try {
    return { body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as T };
  } catch {
    return { body: null };
  }
}
