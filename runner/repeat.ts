// 재면접 묶음의 합격률 (arena again). 파일을 읽지 않는 순수 계산이라 따로 둔다.
import { nextChallenge, type StageResults } from "../core/interview.ts";

/** 합격률 계산에 필요한 세션 필드 (runner/arena.ts 의 SessionState 가 이 모양을 갖는다) */
export type RepeatSession = {
  session: string; mdHash: string; promptsHash?: string; group?: string; repeatTarget?: number;
  options: { mode: string; division: string; target: string }; stages: StageResults;
};

export const MAX_REPEAT = 10;

export type RepeatStats = {
  group: string; target: number | null;
  /** 끝까지 본 판 수와 그중 최종 합격한 판 수 */
  runs: number; passes: number;
  /** 아직 볼 판 수 (target 이 있을 때). 진행 중인 판은 본 것으로 치지 않는다 */
  remaining: number | null;
  /** 단계별: 그 단계를 본 판 수(seen)와 통과한 판 수(passed) */
  stages: Record<string, { seen: number; passed: number }>;
  /** 공격 범주별: 실행한 회차 수(runs)와 막은 회차 수(held) */
  attacks: { category: string; held: number; runs: number }[];
};

/**
 * 재면접 묶음의 합격률. 같은 명세·같은 설정·같은 프롬프트로 본 세션만 센다 (묶음 ID 는 파일에서 온 값이라 그대로 믿지 않는다).
 * 한 번의 합·불은 표본 하나다. 지원자 응답이 확률적이라 같은 명세도 판마다 결과가 갈릴 수 있어, 몇 판 중 몇 판인지를 함께 본다.
 */
export function repeatStats<S extends RepeatSession>(s: S, all: S[]): RepeatStats | null {
  const group = s.group ?? s.session;
  const same = (o: S) => (o.group ?? o.session) === group && o.mdHash === s.mdHash && o.promptsHash === s.promptsHash
    && o.options.mode === s.options.mode && o.options.division === s.options.division && o.options.target === s.options.target;
  const members = all.filter(same);
  if (members.length <= 1 && !s.repeatTarget) return null;
  const finished = members.filter(m => nextChallenge(m.stages) === null);
  const stages: RepeatStats["stages"] = {};
  const attacks = new Map<string, { held: number; runs: number }>();
  for (const m of finished) {
    for (const name of ["doc", "r1", "r2", "final"] as const) {
      const st = m.stages[name];
      if (!st) continue;
      const row = (stages[name] ??= { seen: 0, passed: 0 });
      row.seen++;
      if (st.passed) row.passed++;
    }
    for (const a of m.stages.final?.attacks ?? []) {
      const row = attacks.get(a.category) ?? { held: 0, runs: 0 };
      row.runs += a.runs?.length ?? 1;
      row.held += a.runs ? a.runs.filter(r => r.defended).length : Number(a.defended);
      attacks.set(a.category, row);
    }
  }
  const target = s.repeatTarget ?? null;
  return {
    group, target, runs: finished.length, passes: finished.filter(m => !!m.stages.final?.passed).length,
    remaining: target === null ? null : Math.max(0, target - members.length),
    stages, attacks: [...attacks].map(([category, v]) => ({ category, ...v })),
  };
}
