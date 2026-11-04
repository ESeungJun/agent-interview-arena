// 프롬프트를 바꾼 전후(예: 번역 전후)의 서류 판정을 항목 단위로 비교한다.
//   node runner/compare_verdicts.ts <기준 결과 폴더> <비교 결과 폴더>
// 같은 쪽 안의 회차끼리 갈린 항목(원래 흔들리는 항목)과, 두 쪽의 다수 판정이 갈린 항목을 따로 센다.
// 두 쪽이 갈린 항목이 같은 쪽 안의 흔들림보다 많으면 프롬프트 변경이 판정을 바꿨다고 본다.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

type Verdict = { id: string; result: string; target?: string };
type Report = { agent: string; stages: { doc?: { score: number; passed: boolean; output?: { verdicts?: Verdict[] } } } };

function load(dir: string): Map<string, Report[]> {
  const byAgent = new Map<string, Report[]>();
  for (const f of readdirSync(dir).filter(n => n.endsWith(".json"))) {
    const r = JSON.parse(readFileSync(join(dir, f), "utf8")) as Report;
    if (!r.stages.doc?.output?.verdicts) continue;
    byAgent.set(r.agent, [...(byAgent.get(r.agent) ?? []), r]);
  }
  return byAgent;
}

const verdictMap = (r: Report) => new Map((r.stages.doc!.output!.verdicts ?? []).map(v => [v.id, v.result]));

/** 회차들의 항목별 최빈 판정. 동률이면 null. */
function majority(runs: Report[]): Map<string, string | null> {
  const ids = new Set(runs.flatMap(r => [...verdictMap(r).keys()]));
  const out = new Map<string, string | null>();
  for (const id of ids) {
    const counts = new Map<string, number>();
    for (const r of runs) {
      const v = verdictMap(r).get(id);
      if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    out.set(id, sorted.length > 1 && sorted[0][1] === sorted[1][1] ? null : sorted[0]?.[0] ?? null);
  }
  return out;
}

/** 같은 쪽 회차끼리 판정이 갈린 항목 */
function unstable(runs: Report[]): string[] {
  const ids = new Set(runs.flatMap(r => [...verdictMap(r).keys()]));
  return [...ids].filter(id => new Set(runs.map(r => verdictMap(r).get(id))).size > 1);
}

const [baseDir, nextDir] = process.argv.slice(2);
if (!baseDir || !nextDir) {
  console.error("사용법: node runner/compare_verdicts.ts <기준 결과 폴더> <비교 결과 폴더>");
  process.exit(2);
}
const base = load(baseDir);
const next = load(nextDir);
let totalItems = 0;
let totalDiff = 0;
for (const [agent, baseRuns] of base) {
  const nextRuns = next.get(agent);
  if (!nextRuns) continue;
  const a = majority(baseRuns);
  const b = majority(nextRuns);
  const diff = [...a.keys()].filter(id => b.has(id) && a.get(id) !== null && b.get(id) !== null && a.get(id) !== b.get(id));
  totalItems += a.size;
  totalDiff += diff.length;
  const scores = (rs: Report[]) => rs.map(r => r.stages.doc!.score).join("/");
  console.log(`${agent}: 점수 기준 ${scores(baseRuns)} → 비교 ${scores(nextRuns)}`);
  console.log(`  흔들린 항목 — 기준 안: ${unstable(baseRuns).join(", ") || "없음"} · 비교 안: ${unstable(nextRuns).join(", ") || "없음"}`);
  for (const id of diff) console.log(`  ≠ ${id}: ${a.get(id)} → ${b.get(id)}`);
}
console.log(`\n다수 판정이 갈린 항목 ${totalDiff}/${totalItems}건 (${((totalDiff / Math.max(1, totalItems)) * 100).toFixed(1)}%)`);
