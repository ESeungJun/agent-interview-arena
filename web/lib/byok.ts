/**
 * 무제한급 BYOK(지원자 API 키) 처리 (docs/08 3번).
 * - 지원자 엔진 호출에만 쓴다. 면접관은 운영자 키다.
 * - 저장하지 않는다. 대기열을 거쳐야 해서 면접 단위로 암호화해 대기열 행에만 잠깐 두고, 단계가 끝나거나 2시간이 지나면 행과 함께 지운다.
 * - 로그·오류 메시지에서 키 모양 문자열을 가린다.
 */
import Anthropic from '@anthropic-ai/sdk';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { MODEL_IDS } from '../../core/engine.ts';

/** 대기열에 담긴 키를 이 시간이 지나면 버린다 */
export const BYOK_TTL_MS = 2 * 3600_000;

const g = globalThis as unknown as { __arenaByokKey?: Buffer };

/** 암호화 키. 운영은 ARENA_BYOK_SECRET(base64 32바이트), 로컬은 프로세스마다 새로 만든다 (워커가 같은 프로세스라 문제없다) */
function secret(): Buffer {
  const env = process.env.ARENA_BYOK_SECRET;
  if (env) {
    const key = Buffer.from(env, 'base64');
    if (key.length !== 32) throw new Error('ARENA_BYOK_SECRET 은 base64 로 인코딩한 32바이트여야 합니다');
    return key;
  }
  if (process.env.NODE_ENV === 'production') throw new Error('ARENA_BYOK_SECRET 이 없습니다');
  g.__arenaByokKey ??= randomBytes(32);
  return g.__arenaByokKey;
}

export function sealKey(apiKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', secret(), iv);
  const body = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map(b => b.toString('base64')).join('.');
}

export function openKey(sealed: string): string {
  const [iv, tag, body] = sealed.split('.').map(s => Buffer.from(s, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', secret(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}

/** 키 모양 문자열을 앞 4자만 남기고 가린다 */
export function maskKeys(text: string): string {
  return text.replace(/sk-[A-Za-z0-9_-]{8,}/g, m => `${m.slice(0, 4)}…(가림)`);
}

export const looksLikeKey = (v: unknown): v is string => typeof v === 'string' && /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(v.trim());

/** 제출할 때 한 번, 키가 유효하고 그 모델을 쓸 수 있는지 확인한다 (모델 조회라 토큰 비용이 들지 않는다) */
export async function verifyKey(apiKey: string, model: keyof typeof MODEL_IDS): Promise<string | null> {
  try {
    await new Anthropic({ apiKey, maxRetries: 0, timeout: 15_000 }).models.retrieve(MODEL_IDS[model]);
    return null;
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 401) return 'API 키가 올바르지 않습니다.';
    if (status === 403 || status === 404) return `이 키로는 ${MODEL_IDS[model]} 를 쓸 수 없습니다.`;
    return `키를 확인하지 못했습니다: ${maskKeys(e instanceof Error ? e.message : String(e))}`;
  }
}
