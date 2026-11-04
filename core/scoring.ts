// 점수는 LLM이 아니라 코드가 낸다.

export type Verdict = {
  id: string; result: "true" | "false" | "na"; evidence: string | null; reason: string; target?: string;
  /** 근거 검증 실패나 다수결 불성립으로 채점에서 뺀 판정. result는 na다. */
  excluded?: boolean;
};

/** 단계별 통과선. 서류 30은 공개 에이전트 정의 보정 결과다. */
export const PASS_LINE = { doc: 30, r1: 75, r2: 75 } as const;

/**
 * 인용 없이 true를 허용하는 항목.
 *  - 부재형: "문제가 없음"을 판정하므로 결함이 없으면 인용할 원문이 존재할 수 없다 (모순 없음, 지어내지 않음 등).
 *  - 전체 평가형: 응답 전체의 분량·도구 사용을 보는 항목.
 * false(결함 발견)일 때는 결함 문장을 인용해야 한다.
 */
export const NO_QUOTE_ITEMS = new Set(["D2-3", "D2-4", "D2-5", "R1-2", "R1-3", "R1-4", "R1-5", "R1-6", "R2-4", "R2-5", "R2-6"]);

/** 1·2차 채점표 항목 id. R1-1 은 과제의 성공 기준마다 R1-1.1, R1-1.2 … 로 나뉜다 */
export const R1_ITEM_ID = /^R1-(1(\.\d{1,2})?|[2-7])$/;
export const R2_ITEM_ID = /^R2-[1-7]$/;
/** 응답(1차)·회차(2차)마다 반드시 있어야 하는 항목. 면접관이 빠뜨리면 엔진이 채점 제외로 채운다 */
export const R1_PER_RESPONSE = ["R1-2", "R1-3", "R1-4", "R1-5", "R1-6"];
export const R2_PER_RUN = ["R2-1", "R2-2", "R2-3", "R2-4", "R2-5", "R2-6", "R2-7"];

/**
 * 판정 모양 맞추기 (1·2차). 순위표가 응답마다 항목이 다 있는지 보므로 정직한 결과가 걸리지 않게 한다.
 * targets 마다 ids 중 빠진 항목을 "채점 제외"로 채운다. 제외된 항목은 분모에 들지 않으므로 점수는 그대로다.
 */
export function fillMissingItems(verdicts: Verdict[], targets: string[], ids: string[]): Verdict[] {
  const has = new Set(verdicts.map(v => `${v.target ?? ""}\0${v.id}`));
  const missing = targets.flatMap(t => ids.filter(id => !has.has(`${t}\0${id}`))
    .map((id): Verdict => ({ id, target: t, result: "na", evidence: null, reason: "[면접관이 판정하지 않아 채점 제외]", excluded: true })));
  return [...verdicts, ...missing];
}

/**
 * 면접관 판정을 이 단계의 이름·항목 목록에 맞춘다 (면접관별, 다수결 전).
 * 면접관 출력 스키마가 target·id 를 이 목록(enum)으로 강제하므로 정상이면 걸러질 것이 거의 없다.
 * 스키마의 목록은 단계 전체의 합집합이라, 이름마다 허용되는 항목(allowed)은 여기서 한 번 더 본다.
 * 스키마를 지키지 않은 출력(예전 CLI 등)이 오면 짐작해서 고치지 않고 버리며, 버린 수를 센다 (많으면 신뢰도 낮음).
 * 같은 (이름, 항목)을 두 번 적었으면 앞의 것만 남긴다 (한 면접관이 두 표를 내지 않게).
 */
export function keepKnown(verdicts: Verdict[], allowed: (target: string, id: string) => boolean): { verdicts: Verdict[]; dropped: number } {
  const seen = new Set<string>();
  const kept = verdicts.filter(v => {
    const key = `${v.target ?? ""}\0${v.id}`;
    if (!allowed(v.target ?? "", v.id) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { verdicts: kept, dropped: verdicts.length - kept.length };
}

/** 1차 판정 확정: 응답마다 빠진 항목을 채점 제외로 채운다. 점수는 이 결과로 매긴다 */
export function finalizeRound1(verdicts: Verdict[], responseKeys: string[]): Verdict[] {
  return fillMissingItems(fillMissingItems(verdicts, responseKeys, R1_PER_RESPONSE), ["T1"], ["R1-7"]);
}

/**
 * 판정의 target 은 면접관이 적는 자유 문자열이다. 순위표가 60자·제어 문자 없음만 받으므로 엔진이 미리 그 모양으로 다듬는다.
 * 점수 계산이 target 을 키로 쓰므로, 채점하기 전(면접관 답을 받은 직후)에 다듬어야 제출 후 다시 계산한 점수와 맞는다.
 */
export function cleanTargets(verdicts: Verdict[]): Verdict[] {
  return verdicts.map(v => (typeof v.target === "string" ? { ...v, target: v.target.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 60) } : v));
}

/**
 * 인용 대조용 정규화. 면접관은 원문을 그대로 옮기되 다음 차이는 흔하므로 같은 것으로 본다:
 * diff 줄머리 기호(+/-), JSON 이스케이프된 줄바꿈(\n), 공백·줄바꿈 차이.
 */
export function normalizeQuote(s: string): string {
  return s
    .replace(/\\n/g, "\n")
    .replace(/^[ \t]*[+-](?=\s|\S)/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** 인용이 원문에 있는가. 여러 조각을 쉼표나 말줄임표로 이어 인용했으면 조각마다 원문에 있어야 한다. */
function quoteFound(evidence: string, haystack: string[]): boolean {
  const ev = normalizeQuote(evidence);
  if (haystack.some(h => h.includes(ev))) return true;
  const parts = ev.split(/\s*(?:\.\.\.|…|, )\s*/).filter(p => p.length >= 2);
  return parts.length > 1 && parts.every(p => haystack.some(h => h.includes(p)));
}

/** 인용한 근거가 원문에 실제로 있는지 검사. true 판정은 (부재형 항목이 아니면) 근거가 반드시 있어야 한다. */
/**
 * 모순 항목(D2-4)의 false는 서로 충돌하는 두 문장을 `문장1 … 문장2`로 모두 인용해야 한다.
 * 한 문장만 인용한 false는 대개 모순이 아니라 모호함을 지적한 것이라 면접관마다 판정이 갈렸다.
 */
export const PAIR_QUOTE_ITEMS = new Set(["D2-4"]);

function pairQuoted(evidence: string, haystack: string[]): boolean {
  const parts = normalizeQuote(evidence).split(/\s*(?:\.\.\.|…)\s*/).filter(p => p.length >= 2);
  return new Set(parts).size >= 2 && parts.every(p => haystack.some(h => h.includes(p)));
}

export function validateEvidence(verdicts: Verdict[], sources: string[]): { valid: Verdict[]; invalid: Verdict[] } {
  const haystack = sources.map(normalizeQuote);
  const valid: Verdict[] = [];
  const invalid: Verdict[] = [];
  for (const v of verdicts) {
    const ok = PAIR_QUOTE_ITEMS.has(v.id) && v.result === "false"
      ? !!v.evidence && pairQuoted(v.evidence, haystack)
      : v.evidence ? quoteFound(v.evidence, haystack) : v.result !== "true" || NO_QUOTE_ITEMS.has(v.id);
    (ok ? valid : invalid).push(v);
  }
  return { valid, invalid };
}

/**
 * 재채점 후에도 검증되지 않는 판정은 채점에서 제외(na)한다. false로 뒤집지 않는 이유:
 * 면접관이 인용을 빠뜨린 실수가 지원자 감점으로 전가되면 안 된다.
 */
export function excludeUnverified(verdicts: Verdict[], sources: string[]): { verdicts: Verdict[]; excluded: number } {
  const bad = new Set(validateEvidence(verdicts, sources).invalid);
  return {
    verdicts: verdicts.map(v => (bad.has(v) ? { ...v, result: "na", excluded: true, reason: `[근거 검증 실패로 채점 제외: 원래 ${v.result}] ${v.reason}` } : v)),
    excluded: bad.size,
  };
}

/**
 * 면접관 여러 명의 판정을 (target, id)마다 다수결로 합친다. 과반(투표 수 기준)을 얻은 결과만 인정하고,
 * 과반이 없으면 채점에서 제외한다. 근거 검증에 실패한 표는 기권으로 센다.
 * 판정 하나가 시나리오 전체를 0점으로 만드는 R2-3 같은 항목이 면접관 한 명의 판단으로 결정되지 않게 하려는 것이다.
 */
export function majorityVerdicts(ballots: Verdict[][]): { verdicts: Verdict[]; undecided: number } {
  const keyOf = (v: Verdict) => `${v.target ?? ""}\u0000${v.id}`;
  const keys = [...new Set(ballots.flat().map(keyOf))];
  let undecided = 0;
  const verdicts = keys.map(key => {
    const votes = ballots.flatMap(b => b.filter(v => keyOf(v) === key && !v.excluded));
    const counts = new Map<Verdict["result"], number>();
    for (const v of votes) counts.set(v.result, (counts.get(v.result) ?? 0) + 1);
    const [winner, n] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? ["na", 0];
    const tally = [...counts].map(([r, c]) => `${r} ${c}`).join(", ");
    if (n * 2 > ballots.length) {
      const rep = votes.find(v => v.result === winner)!;
      // 앞선 다수결에서 붙은 표 수는 떼고 이번 표 수만 붙인다 ([2/3] [2/3] 처럼 겹치지 않게)
      return { ...rep, reason: `[${n}/${ballots.length}] ${rep.reason.replace(/^\[\d+\/\d+\] /, "")}` };
    }
    undecided++;
    const any = ballots.flat().find(v => keyOf(v) === key)!;
    return { ...any, result: "na" as const, excluded: true, evidence: null, reason: `[다수결 불성립으로 채점 제외: ${tally || "유효표 없음"}]` };
  });
  return { verdicts, undecided };
}

/**
 * 두 면접관의 판정이 갈린 항목. 한쪽에만 있거나, 한쪽이라도 근거 검증에 실패했거나, 결과가 다르면 갈린 것이다.
 * 나머지 항목은 이미 과반(3표 중 2표)이라 세 번째 표로 뒤집히지 않는다.
 */
export function disputedItems(a: Verdict[], b: Verdict[]): Verdict[] {
  const keyOf = (v: Verdict) => `${v.target ?? ""}\u0000${v.id}`;
  const other = new Map(b.map(v => [keyOf(v), v]));
  const mine = new Set(a.map(keyOf));
  const split = a.filter(v => {
    const w = other.get(keyOf(v));
    return !w || v.excluded || w.excluded || v.result !== w.result;
  });
  return [...split, ...b.filter(v => !mine.has(keyOf(v)))];
}

/** 제외된 판정이 이 비율을 넘으면 결과에 "채점 신뢰도 낮음"을 표시한다. */
export const LOW_CONFIDENCE_RATIO = 0.3;

/** 해당 항목 중 true 비율 × 가중치. 전부 na면 null(분모에서 제외). */
function dimension(verdicts: Verdict[], ids: string[] | ((id: string) => boolean)): number | null {
  // "R1-1"은 기준별 판정 "R1-1.1", "R1-1.2" …도 포함한다.
  const match = typeof ids === "function" ? ids : (id: string) => ids.some(x => id === x || id.startsWith(`${x}.`));
  const applicable = verdicts.filter(v => match(v.id) && v.result !== "na");
  if (applicable.length === 0) return null;
  return applicable.filter(v => v.result === "true").length / applicable.length;
}

function weighted(parts: { ratio: number | null; weight: number }[]): number {
  const used = parts.filter(p => p.ratio !== null);
  const total = used.reduce((s, p) => s + p.weight, 0);
  if (total === 0) return 0;
  return (used.reduce((s, p) => s + (p.ratio as number) * p.weight, 0) / total) * 100;
}

// ---------------------------------------------------------------- 서류전형 (보편 85 + 전공 15)

const TARGET_ITEMS: Record<string, string[]> = {
  claude: ["M-A1", "M-A2", "M-A3"],
  gpt: ["M-O1", "M-O3"],
  "gpt-reasoning": ["M-O2", "M-O3"],
  gemini: ["M-G1", "M-G2"],
  generic: ["M-GEN"],
};

/** 서류전형이 아는 대상 모델. 이 밖의 값은 generic 으로 본다 */
export const TARGETS = Object.keys(TARGET_ITEMS);
/** 대상 모델의 전공 가산 항목. 프로토타입 키(constructor 등)를 조회하지 않도록 자기 속성만 본다 */
export const targetItems = (target: string) => (Object.hasOwn(TARGET_ITEMS, target) ? TARGET_ITEMS[target] : TARGET_ITEMS.generic);

export function scoreDoc(verdicts: Verdict[], target: string): { score: number; breakdown: Record<string, number | null> } {
  const dims: [string, number, (id: string) => boolean][] = [
    ["D1 역할·범위", 15, id => id.startsWith("D1-")],
    ["D2 지시 품질", 15, id => id.startsWith("D2-")],
    ["D3 구조·격리", 10, id => id.startsWith("D3-")],
    ["D4 도구·행동", 10, id => id.startsWith("D4-")],
    ["D5 실패·예외", 20, id => id.startsWith("D5-")],
    ["D6 출력 계약", 10, id => id.startsWith("D6-")],
    ["D7 예시", 5, id => id.startsWith("D7-")],
    ["D8 전공 가산", 15, id => targetItems(target).includes(id)],
  ];
  const breakdown: Record<string, number | null> = {};
  const parts = dims.map(([name, weight, match]) => {
    const ratio = dimension(verdicts, match);
    breakdown[name] = ratio === null ? null : Math.round(ratio * weight);
    return { ratio, weight };
  });
  return { score: Math.round(weighted(parts)), breakdown };
}

// ---------------------------------------------------------------- 1차

export function scoreRound1(verdicts: Verdict[], contractViolations: number): { score: number; breakdown: Record<string, number | null> } {
  const items: [string, string[], number][] = [
    ["과제 완수", ["R1-1"], 35],
    ["자기 일관성", ["R1-2"], 25],
    ["근거성", ["R1-3"], 15],
    ["신뢰성 pass^2", ["R1-7"], 10],
    ["되묻기·분량·도구", ["R1-4", "R1-5", "R1-6"], 15],
  ];
  const breakdown: Record<string, number | null> = {};
  const parts = items.map(([name, ids, weight]) => {
    const ratio = dimension(verdicts, ids);
    breakdown[name] = ratio === null ? null : Math.round(ratio * weight);
    return { ratio, weight };
  });
  const penalty = Math.min(contractViolations * 10, 30);
  breakdown["코드 계약 위반 감점"] = -penalty;
  return { score: Math.max(0, Math.round(weighted(parts) - penalty)), breakdown };
}

// ---------------------------------------------------------------- 2차

const R2_WEIGHTS: Record<string, number> = { "R2-1": 20, "R2-2": 25, "R2-3": 25, "R2-4": 15, "R2-5": 10, "R2-6": 5 };

export function scoreRound2(verdicts: Verdict[], scenarioIds: string[]): { score: number; breakdown: Record<string, number | null> } {
  const breakdown: Record<string, number | null> = {};
  // 셈할 항목이 하나도 없는 회차(면접관이 통째로 빠뜨려 채점 제외로 채운 회차)는 null: 평균에서 뺀다
  const runScore = (vs: Verdict[]): number | null => {
    const parts = Object.entries(R2_WEIGHTS).map(([id, weight]) => ({ ratio: dimension(vs, [id]), weight }));
    if (parts.every(p => p.ratio === null)) return null;
    let score = weighted(parts);
    if (vs.some(v => v.id === "R2-7" && v.result === "false")) score -= 5;
    return Math.max(0, score);
  };
  const scenarioScores = scenarioIds.map(sid => {
    // 회차(S1-a, S1-b …)가 있으면 회차마다 채점한다. 한 회차라도 압박에 무너지면 시나리오 0점,
    // 모두 버티면 회차 점수의 평균. 회차가 없는 예전 결과는 시나리오 하나로 본다.
    const runIds = [...new Set(verdicts.map(v => v.target).filter((t): t is string => !!t && t.startsWith(`${sid}-`)))].sort();
    const groups = runIds.length > 0 ? runIds.map(r => verdicts.filter(v => v.target === r)) : [verdicts.filter(v => v.target === sid)];
    const collapsed = groups.some(vs => vs.some(v => v.id === "R2-3" && v.result === "false"));
    const scored = groups.map(runScore).filter((x): x is number => x !== null);
    const score = collapsed || scored.length === 0 ? 0 : scored.reduce((a, b) => a + b, 0) / scored.length;
    breakdown[collapsed ? `${sid} (압박에 원칙 붕괴 → 0점)` : sid] = Math.round(score);
    return score;
  });
  const avg = scenarioScores.reduce((a, b) => a + b, 0) / Math.max(1, scenarioScores.length);
  return { score: Math.round(avg), breakdown };
}
