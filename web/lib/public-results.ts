/**
 * 연 결과에서 화면이 쓰는 필드만 남긴다 (lib/view.ts 가 쓴다).
 * 출제 과제·시나리오·공격 문구·지원자 응답·항목별 판정을 내려 주면, 결과를 열어 본 사람들이
 * 공격 풀과 채점 체크리스트를 모아 거기에만 맞춘 .md 를 쓸 수 있다.
 * 원칙 번호·공격 ID·공격 이름도 내려 주지 않는다. 지원자에게는 무엇을 고치면 되는지만 보여 준다 (D-35).
 */
import type { StageResults } from '../../core/interview.ts';
import { detectorFeedback, redactIds } from './redact.ts';

type AnyResult = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** 면접관 서술 한 칸의 상한. 데이터에 숨은 지시로 면접관이 평가 기준을 길게 옮겨 적어도 통째로 내보내지 않는다 */
const MAX_TEXT = 1000;
const say = (s: string) => {
  const t = redactIds(s);
  return t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT)}…` : t;
};

const ban = (r: AnyResult) => (r.securityBan ? { rule: r.securityBan.rule, reason: say(r.securityBan.reason ?? '') } : undefined);
const round = (r: AnyResult) => ({
  passed: r.passed, securityBan: ban(r), score: r.score, breakdown: r.breakdown,
  output: {
    decisive_mistake: r.output?.decisive_mistake ? say(r.output.decisive_mistake) : null,
    comment: say(r.output?.comment ?? ''),
  },
});

export function publicResults(results: StageResults): StageResults {
  const r = results as Record<string, AnyResult | undefined>;
  const out: Record<string, unknown> = {};
  if (r.security) out.security = { passed: r.security.passed, securityBan: ban(r.security) };
  if (r.doc) {
    out.doc = {
      passed: r.doc.passed, securityBan: ban(r.doc), score: r.doc.score, breakdown: r.doc.breakdown,
      output: { feedback: (r.doc.output?.feedback ?? []).map((f: AnyResult) => ({ problem: say(f.problem ?? ''), fix_example: say(f.fix_example ?? '') })), persona: { waiting_room_monologue: r.doc.output?.persona?.waiting_room_monologue ? say(r.doc.output.persona.waiting_room_monologue) : undefined } },
    };
  }
  if (r.r1) out.r1 = round(r.r1);
  if (r.r2) out.r2 = round(r.r2);
  if (r.final) {
    out.final = {
      passed: r.final.passed, securityBan: ban(r.final),
      executiveComment: r.final.executiveComment ? say(r.final.executiveComment) : r.final.executiveComment,
      // 공격은 순서(공격 1~5)와 방어 여부, 고칠 방향만 보여 준다. 탐지기가 잡은 실패는 탐지 상세 대신 일반 문장으로 바꾼다.
      attacks: (r.final.attacks ?? []).map((a: AnyResult) => ({
        defended: a.defended,
        reason: a.decided_by === 'detector' ? detectorFeedback(a.detector_hits ?? []) : say(a.reason ?? ''),
      })),
    };
  }
  return out as StageResults;
}

