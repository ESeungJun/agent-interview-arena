// 서류전형 결과의 근거 보강 (D-21)
//  1. 피드백-판정 연결: 피드백이 실제 감점 판정에 근거하는지 코드가 확인한다.
//  2. "없다" 판정 재확인 대상 추출: 인용 없는 false는 코드로 검증할 수 없어 다른 면접관이 원문을 다시 찾는다.
import { validateEvidence, type Verdict } from "./scoring.ts";

export type ChecklistItem = { id: string; tag: string; text: string };
export type Feedback = { principle: string; problem: string; fix_example: string };

/** 서류 프롬프트의 체크리스트 줄(`- \`D1-2\` [P-02] 설명`)에서 항목 → 원칙 대응표를 읽는다. */
export function parseChecklist(prompt: string): Map<string, ChecklistItem> {
  const items = new Map<string, ChecklistItem>();
  for (const m of prompt.matchAll(/^\s*-\s*`((?:D\d-\d)|(?:M-[A-Z0-9]+))`\s*\[([^\]]+)\]\s*(.+)$/gm)) {
    items.set(m[1], { id: m[1], tag: m[2].trim(), text: m[3].trim() });
  }
  return items;
}

/** 피드백의 principle("P-01/P-02", "P-11", "M-A1")에서 ID들을 뽑는다. */
function principleIds(principle: string): string[] {
  return principle.match(/P-\d{2}|M-[A-Z0-9]+|D\d-\d/g) ?? [];
}

/** 이 판정이 걸린 ID들: 항목 ID 자체와 그 항목의 원칙 태그. */
function idsOf(v: Verdict, checklist: Map<string, ChecklistItem>): string[] {
  return [v.id, ...principleIds(checklist.get(v.id)?.tag ?? "")];
}

/**
 * 피드백 중 실제 false 판정에 근거하지 않는 항목은 뺀다. 빠진 자리는 아직 피드백에 없는 감점 원칙으로
 * 코드가 채운다(감점 건수가 많은 원칙부터, 체크리스트 문구를 고칠 방향으로 쓴다). 최대 limit개.
 */
export function linkFeedback(
  feedback: Feedback[], verdicts: Verdict[], checklist: Map<string, ChecklistItem>, limit = 3,
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
      problem: vs.map(v => v.reason).join(" "),
      fix_example: `다음을 .md에 적어 주세요: ${vs.map(v => checklist.get(v.id)?.text ?? v.id).join(" / ")}`,
    }));
  return { feedback: [...kept.slice(0, limit), ...fill], dropped, added: fill.length };
}

/** 인용 없이 "없다"고 판정한 감점. 코드가 원문과 대조할 수 없어 재확인 대상이다. */
export function absentFailures(verdicts: Verdict[]): Verdict[] {
  return verdicts.filter(v => v.result === "false" && !v.evidence && !v.excluded);
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
