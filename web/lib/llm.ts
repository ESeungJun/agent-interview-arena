/**
 * 면접에 쓸 LLM 호출기.
 * - 면접관 호출과 경량·중량 지원자 호출은 운영자 키(ANTHROPIC_API_KEY)로 보낸다.
 * - 무제한급 지원자 호출은 지원자 키(BYOK)로 보낸다.
 * - 지원자 호출에는 지원자가 고른 추론 강도를 붙인다 (체급 상한 안).
 * 로컬 개발에서 운영자 키가 없으면 로컬 Claude Code(`claude -p`)로 대신한다.
 */
import { createApiLlm, type Llm } from '../../core/engine.ts';
import type { Effort } from './policy.ts';

export async function operatorLlm(): Promise<Llm> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) return createApiLlm({ apiKey });
  if (process.env.NODE_ENV === 'production') throw new Error('ANTHROPIC_API_KEY 가 없습니다');
  const { cliLlm } = await import('../../runner/cli_engine.ts');
  return cliLlm;
}

export async function arenaLlm(opts: { effort?: Effort; byokKey?: string }): Promise<Llm> {
  const operator = await operatorLlm();
  const candidate = opts.byokKey ? createApiLlm({ apiKey: opts.byokKey }) : operator;
  return {
    backend: operator.backend,
    converse: req =>
      req.role === 'candidate' ? candidate.converse(opts.effort ? { ...req, effort: opts.effort } : req) : operator.converse(req),
  };
}
