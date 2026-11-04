// 서류전형 결과의 근거 보강
//  1. 체크리스트 읽기·판정 정리: 체크리스트 항목표를 읽고, 면접관 판정을 그 모양(빠짐·중복·잘못 적은 id)에 맞춘다.
//  2. 피드백-판정 연결: 피드백이 실제 감점 판정에 근거하는지 코드가 확인한다.
//  3. "없다" 판정 재확인: 인용 없는 false는 코드로 검증할 수 없어 다른 면접관이 원문을 다시 찾고, 그 결과를 반영한다.
import { NO_QUOTE_ITEMS, targetItems, validateEvidence, type Verdict } from "./scoring.ts";

export type ChecklistItem = { id: string; tag: string; text: string };
export type Feedback = { principle: string; problem: string; fix_example: string };

/**
 * 서류 프롬프트의 체크리스트 줄(`- \`D1-2\` [P-02] 설명`)에서 항목 → 원칙 대응표를 읽는다.
 * 설명이 여러 줄이면(D2-3 의 세는 규칙처럼) 들여 쓴 다음 줄들까지 이어 읽는다.
 */
export function parseChecklist(prompt: string): Map<string, ChecklistItem> {
  const items = new Map<string, ChecklistItem>();
  for (const m of prompt.matchAll(/^-\s*`((?:D\d-\d)|(?:M-[A-Z0-9]+))`\s*\[([^\]]+)\]\s*(.+)((?:\n[ \t]+\S.*)*)/gm)) {
    const more = m[4].split("\n").map(l => l.trim()).filter(Boolean);
    items.set(m[1], { id: m[1], tag: m[2].trim(), text: [m[3].trim(), ...more].join("\n") });
  }
  return items;
}

/** 대상 모델에 대해 서류 판정에 반드시 있어야 하는 항목: D1-1 ~ D7-3 전부와 그 모델의 전공 가산 항목 */
export function requiredDocIds(checklist: Map<string, ChecklistItem>, target: string): string[] {
  return [...[...checklist.keys()].filter(id => id.startsWith("D")), ...targetItems(target)];
}

/**
 * 서류 판정을 체크리스트 모양으로 맞춘다. 순위표가 항목이 빠짐없이 있는지 보므로 정직한 결과가 걸리지 않게 한다.
 *  - 면접관이 영역 이름을 붙여 적은 id(`D8-M-A1`)는 체크리스트 id(`M-A1`)로 고친다. 그 밖의 모르는 id 는 버린다
 *  - 같은 항목을 두 번 냈으면 앞의 것만 남긴다
 *  - 빠뜨린 필수 항목은 "채점 제외"로 채운다. 제외된 항목은 분모에 들지 않으므로 점수는 그대로다
 */
export function completeDocVerdicts(verdicts: Verdict[], checklist: Map<string, ChecklistItem>, required: string[]): Verdict[] {
  const seen = new Set<string>();
  const unique = verdicts
    .map(v => (!checklist.has(v.id) && checklist.has(v.id.replace(/^D\d-(?=M-)/, "")) ? { ...v, id: v.id.replace(/^D\d-(?=M-)/, "") } : v))
    .filter(v => checklist.has(v.id) && !seen.has(v.id) && !!seen.add(v.id));
  const missing = required.filter(id => !seen.has(id))
    .map((id): Verdict => ({ id, result: "na", evidence: null, reason: "[면접관이 판정하지 않아 채점 제외]", excluded: true }));
  return [...unique, ...missing];
}

/** 피드백의 principle("P-01/P-02", "P-11", "M-A1")에서 ID들을 뽑는다. */
function principleIds(principle: string): string[] {
  return principle.match(/P-\d{2}|M-[A-Z0-9]+|D\d-\d/g) ?? [];
}

/** 이 판정이 걸린 ID들: 항목 ID 자체와 그 항목의 원칙 태그. */
function idsOf(v: Verdict, checklist: Map<string, ChecklistItem>): string[] {
  return [v.id, ...principleIds(checklist.get(v.id)?.tag ?? "")];
}

/** 코드가 채운 피드백의 개선안. 지원자에게 보이는 문장이라 출력 언어로 쓴다 */
const FILL_FIX: Record<"ko" | "en", string> = {
  ko: "위 문제를 해결하는 규칙을 .md에 직접 적어 주세요. 무엇을, 언제, 어떻게 할지까지 쓰면 됩니다.",
  en: "Add a rule to the .md that solves the problem above. Say what to do, when, and how.",
};

/**
 * 피드백 중 실제 false 판정에 근거하지 않는 항목은 뺀다. 빠진 자리는 아직 피드백에 없는 감점 원칙으로
 * 코드가 채운다(감점 건수가 많은 원칙부터, 면접관이 적은 감점 이유를 문제로 쓴다). 최대 limit개.
 */
export function linkFeedback(
  feedback: Feedback[], verdicts: Verdict[], checklist: Map<string, ChecklistItem>, limit = 3, lang: "ko" | "en" = "en",
): { feedback: Feedback[]; dropped: Feedback[]; added: number } {
  const failed = verdicts.filter(v => v.result === "false");
  const failedIds = new Set(failed.flatMap(v => idsOf(v, checklist)));
  const kept = feedback.filter(f => principleIds(f.principle).some(id => failedIds.has(id)));
  const dropped = feedback.filter(f => !kept.includes(f));

  const covered = new Set(kept.flatMap(f => principleIds(f.principle)));
  const byPrinciple = new Map<string, Verdict[]>();
  for (const v of failed) {
    const p = principleIds(checklist.get(v.id)?.tag ?? "")[0] ?? v.id;
    if (covered.has(p) || covered.has(v.id)) continue;
    byPrinciple.set(p, [...(byPrinciple.get(p) ?? []), v]);
  }
  const fill = [...byPrinciple]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, Math.max(0, limit - kept.length))
    .map(([p, vs]) => ({
      principle: p,
      // 다수결 판정의 이유 앞에는 "[2/3] " 같은 표가 붙는다. 사용자가 읽는 문장이라 뗀다
      problem: vs.map(v => v.reason.replace(/^\[\d+\/\d+\] /, "")).join(" "),
      // 체크리스트 항목 원문은 비공개 프롬프트라 지원자에게 보이는 문장에 쓰지 않는다
      fix_example: FILL_FIX[lang],
    }));
  return { feedback: [...kept.slice(0, limit), ...fill], dropped, added: fill.length };
}

/**
 * 인용 없이 "없다"고 판정한 감점. 코드가 원문과 대조할 수 없어 재확인 대상이다.
 * "문제가 없는가"를 묻는 항목(D2-3·D2-4·D2-5)은 뺀다. 재확인은 "정말 없나, 찾아보라"고 묻는데, 이 항목들은 찾을 것이
 * "문제"라 질문이 거꾸로 된다 (짝이 있는 금지 규칙 한 줄만 찾아도 false 가 true 로 뒤집힌다).
 */
export function absentFailures(verdicts: Verdict[]): Verdict[] {
  return verdicts.filter(v => v.result === "false" && !v.evidence && !v.excluded && !NO_QUOTE_ITEMS.has(v.id));
}

export type Recheck = { id: string; found: boolean; evidence: string | null; reason: string };

/** 재확인에서 원문 인용과 함께 "있다"가 확인된 항목만 true로 뒤집는다. 인용이 원문에 없으면 원래 판정을 유지한다. */
export function applyRechecks(verdicts: Verdict[], rechecks: Recheck[], md: string): { verdicts: Verdict[]; flipped: string[] } {
  const flipped: string[] = [];
  const out = verdicts.map(v => {
    const r = rechecks.find(x => x.id === v.id);
    if (!r?.found || !r.evidence || v.result !== "false" || v.evidence) return v;
    const candidate: Verdict = { ...v, result: "true", evidence: r.evidence, reason: `[재확인으로 정정] ${r.reason}` };
    if (validateEvidence([candidate], [md]).invalid.length > 0) return v;
    flipped.push(v.id);
    return candidate;
  });
  return { verdicts: out, flipped };
}
