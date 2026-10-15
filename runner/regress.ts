// 면접관 회귀 테스트: 샘플 지원자를 N회씩 면접시켜 기대 결과와 일관성을 확인한다.
//   node runner/regress.ts [--runs 5] [--only 파일명] [--interviewer sonnet]
// 실제 모델을 호출하므로 비용이 든다. 보안 검문소까지만 보는 샘플은 정규식에서 끝나면 비용 0.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { ModelAlias } from "../core/engine.ts";
import { interviewFile, saveReport, type InterviewReport } from "./run.ts";

type Expect = { security?: "PASS" | "BANNED"; rule?: string; doc?: "PASS" | "FAIL"; doc_score_min?: number; doc_score_max?: number };
type Sample = { file: string; target: string; until: "security" | "doc"; expect: Expect };

const dir = join(fileURLToPath(new URL("..", import.meta.url)), "tests/sample_candidates");
const { values } = parseArgs({
  options: {
    runs: { type: "string", default: "1" },
    only: { type: "string" },
    interviewer: { type: "string", default: "sonnet" },
  },
});
const runs = Number(values.runs);
const { samples } = JSON.parse(readFileSync(join(dir, "expected.json"), "utf8")) as { samples: Sample[] };
const selected = samples.filter(s => !values.only || s.file.includes(values.only));

function check(s: Sample, r: InterviewReport): string[] {
  const problems: string[] = [];
  const sec = r.stages.security as { passed: boolean; securityBan?: { rule: string } } | undefined;
  const doc = r.stages.doc as { passed: boolean; score: number } | undefined;
  const e = s.expect;
  if (e.security === "BANNED" && !sec?.securityBan) problems.push("보안 실격 기대했으나 통과");
  if (e.security === "PASS" && !sec?.passed) problems.push(`보안 통과 기대했으나 실격 (${sec?.securityBan?.rule})`);
  if (e.rule && sec?.securityBan?.rule !== e.rule) problems.push(`실격 규칙 기대 ${e.rule}, 실제 ${sec?.securityBan?.rule ?? "없음"}`);
  const wantsDoc = e.doc !== undefined || e.doc_score_min !== undefined || e.doc_score_max !== undefined;
  if (wantsDoc && !doc) problems.push("서류전형까지 도달하지 못함");
  if (e.doc && doc && (doc.passed ? "PASS" : "FAIL") !== e.doc) problems.push(`서류 ${e.doc} 기대, 실제 ${doc.passed ? "PASS" : "FAIL"} (${doc.score}점)`);
  if (e.doc_score_min !== undefined && doc && doc.score < e.doc_score_min) problems.push(`서류 ${e.doc_score_min}점 이상 기대, 실제 ${doc.score}`);
  if (e.doc_score_max !== undefined && doc && doc.score > e.doc_score_max) problems.push(`서류 ${e.doc_score_max}점 이하 기대, 실제 ${doc.score}`);
  return problems;
}

let failed = 0;
for (const s of selected) {
  const outcomes: string[] = [];
  const scores: number[] = [];
  const problems = new Set<string>();
  // 같은 샘플의 반복 실행은 병렬로 돌린다.
  const reports = await Promise.all(
    Array.from({ length: runs }, () =>
      interviewFile({
        mdPath: join(dir, s.file), target: s.target, division: "light", interviewer: values.interviewer as ModelAlias,
        until: s.until, screenAll: true, quiet: true,
      }),
    ),
  );
  for (const r of reports) {
    saveReport(r);
    outcomes.push(r.result);
    const doc = r.stages.doc as { score: number } | undefined;
    if (doc) scores.push(doc.score);
    for (const p of check(s, r)) problems.add(p);
  }
  const consistent = new Set(outcomes).size === 1;
  if (!consistent) problems.add(`실행마다 결과가 다름: ${outcomes.join(" | ")}`);
  const ok = problems.size === 0;
  if (!ok) failed++;
  console.log(`${ok ? "✅" : "❌"} ${s.file.padEnd(28)} ${outcomes[0]}${scores.length ? `  서류 점수 ${scores.join("/")}` : ""}`);
  for (const p of problems) console.log(`     - ${p}`);
}
console.log(`\n${selected.length - failed}/${selected.length} 샘플이 기대 결과와 일치 (샘플당 ${runs}회)`);
process.exit(failed > 0 ? 1 : 0);
