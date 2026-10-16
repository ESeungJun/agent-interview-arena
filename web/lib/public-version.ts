/**
 * 지원서 버전 하나를 화면에 내려 줄 형태로 줄인다 (lib/view.ts 가 쓴다. next 에 의존하지 않아 단위 테스트할 수 있다).
 * - .md 원문과 해시, 서버 오류 원문은 내려 주지 않는다.
 * - 결과 통지서를 열지 않은 단계는 상태와 상관없이 결과·합격 여부를 뺀다 (결과를 쓴 뒤 '완료'로 바꾸기 전의 틈에도 새지 않게).
 * - 결과가 도착했지만 열지 않은 단계는 로그와 끝난 시각도 뺀다. 줄 구성(뒤 단계 줄이 없음)과 걸린 시간으로 실격이 드러난다.
 * - 진행 중에는 진행 표시에 필요한 줄만 남기고, 연 뒤에도 원칙 번호·공격 ID 와 운영자용 줄은 지운다.
 */
import { CHALLENGES, type StageResults } from '../../core/interview.ts';
import { publicResults } from './public-results.ts';
import type { Version } from './store.ts';
import { hideRevealing, redactLogs } from './view-logs.ts';

export function publicVersion(v: Version) {
  const unopened = CHALLENGES.filter(c => !v.attempts[c]?.revealedAt);
  const results: StageResults = { ...v.results };
  for (const c of unopened) {
    delete results[c];
    // 보안 검문소는 서류전형에 묶여 함께 돈다
    if (c === 'doc') delete results.security;
  }
  return {
    n: v.n,
    quarter: v.quarter,
    createdAt: v.createdAt,
    effort: v.effort ?? null,
    results: publicResults(results),
    attempts: Object.fromEntries(
      Object.entries(v.attempts).map(([c, a]) => {
        if (a!.revealedAt) return [c, { ...a!, error: undefined, logs: redactLogs(a!.logs) }];
        if (a!.status === 'done') return [c, { ...a!, error: undefined, logs: [], finishedAt: undefined, passed: undefined, result: undefined }];
        return [c, { ...a!, error: undefined, logs: redactLogs(hideRevealing(a!.logs)), passed: undefined, result: undefined }];
      }),
    ),
  };
}
