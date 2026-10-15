/**
 * 연 결과에서 화면이 쓰는 필드만 남긴다 (lib/view.ts 가 쓴다).
 * 출제 과제·시나리오·공격 문구·지원자 응답·항목별 판정을 내려 주면, 결과를 열어 본 사람들이
 * 공격 풀과 채점 체크리스트를 모아 거기에만 맞춘 .md 를 쓸 수 있다.
 * 원칙 번호·공격 ID·공격 이름도 내려 주지 않는다. 지원자에게는 무엇을 고치면 되는지만 보여 준다 (D-35).
 */
import type { StageResults } from '../../core/interview.ts';
import { detectorFeedback, redactIds } from './redact.ts';

type AnyResult = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const ban = (r: AnyResult) => (r.securityBan ? { rule: r.securityBan.rule, reason: r.securityBan.reason } : undefined);
const round = (r: AnyResult) => ({
  passed: r.passed, securityBan: ban(r), score: r.score, breakdown: r.breakdown,
  output: {
    decisive_mistake: r.output?.decisive_mistake ? redactIds(r.output.decisive_mistake) : null,
    comment: redactIds(r.output?.comment ?? ''),
  },
});

export function publicResults(results: StageResults): StageResults {
  const r = results as Record<string, AnyResult | undefined>;
  const out: Record<string, unknown> = {};
  if (r.security) out.security = { passed: r.security.passed, securityBan: ban(r.security) };
  if (r.doc) {
    out.doc = {
      passed: r.doc.passed, securityBan: ban(r.doc), score: r.doc.score, breakdown: r.doc.breakdown,
      output: { feedback: (r.doc.output?.feedback ?? []).map((f: AnyResult) => ({ problem: redactIds(f.problem ?? ''), fix_example: redactIds(f.fix_example ?? '') })), persona: { waiting_room_monologue: r.doc.output?.persona?.waiting_room_monologue } },
    };
  }
  if (r.r1) out.r1 = round(r.r1);
  if (r.r2) out.r2 = round(r.r2);
  if (r.final) {
    out.final = {
      passed: r.final.passed, securityBan: ban(r.final),
      executiveComment: r.final.executiveComment ? redactIds(r.final.executiveComment) : r.final.executiveComment,
      // 공격은 순서(공격 1~5)와 방어 여부, 고칠 방향만 보여 준다. 탐지기가 잡은 실패는 탐지 상세 대신 일반 문장으로 바꾼다.
      attacks: (r.final.attacks ?? []).map((a: AnyResult) => ({
        defended: a.defended,
        reason: a.decided_by === 'detector' ? detectorFeedback(a.detector_hits ?? []) : redactIds(a.reason ?? ''),
      })),
    };
  }
  return out as StageResults;
}

