// 로컬 면접 실행기 (CLI). 면접 흐름은 core/interview.ts, 여기는 파일 읽기·저장과 콘솔 출력만 한다.
//   node runner/run.ts <agent.md> [--target claude|gpt|gpt-reasoning|gemini|generic] [--division light|middle|open]
//                      [--engine haiku|sonnet|opus] [--interviewer haiku|sonnet|opus] [--until security|doc|r1|r2|final]
//                      [--seed N] [--screen-all] [--quiet] [--no-stop] [--fresh-exam]
//   --fresh-exam: 분기 고정 출제를 쓰지 않고 새로 출제한다 (출제 편차 측정용, 저장도 안 함)
//   --no-stop: 1·2차에서 탈락해도 다음 단계까지 진행한다 (채점 편차 측정용 응답 수집. 보안 실격은 그대로 멈춘다)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { ModelAlias } from "../core/engine.ts";
import { interview, type InterviewReport, type Stage } from "../core/interview.ts";
import { localLlm } from "./cli_engine.ts";
import { fsExamStore } from "./fs_exam_store.ts";

export type { InterviewReport };

export type LocalInterviewOptions = {
  mdPath: string; target: string; division: string; engine?: ModelAlias; interviewer: ModelAlias;
  until: Stage; seed?: number; screenAll: boolean; quiet: boolean; noStop?: boolean; freshExam?: boolean;
};

/** 로컬 파일의 .md로 면접을 본다. API 키가 있으면 API, 없으면 claude -p로 호출하고 출제분은 exams/에 둔다. */
export function interviewFile(opts: LocalInterviewOptions): Promise<InterviewReport> {
  const { mdPath, quiet, ...rest } = opts;
  return interview({
    ...rest,
    md: readFileSync(mdPath, "utf8"),
    agentName: basename(mdPath),
    llm: localLlm(),
    examStore: fsExamStore(),
    log: quiet ? undefined : (m: string) => console.log(m),
  });
}

export function saveReport(report: InterviewReport): string {
  const dir = join(fileURLToPath(new URL("..", import.meta.url)), "results");
  mkdirSync(dir, { recursive: true });
  // 병렬 실행은 시작 시각이 같을 수 있어 seed를 붙인다.
  const file = join(dir, `${report.agent.replace(/\.md$/, "")}-${report.startedAt.replace(/[:.]/g, "-")}-s${report.config.seed}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2));
  return file;
}

function printSummary(r: InterviewReport, file: string): void {
  const u = r.usage;
  console.log(`\n━━ ${r.agent} ━━ ${r.result}`);
  console.log(`엔진 ${r.config.engine} (${r.config.division}) · 면접관 ${r.config.interviewer} · 백엔드 ${r.backend} · seed ${r.config.seed}`);
  const doc = r.stages.doc as { output?: { feedback?: { principle: string; problem: string; fix_example: string }[] } } | undefined;
  for (const f of doc?.output?.feedback ?? []) console.log(`  [${f.principle}] ${f.problem}\n      → ${f.fix_example}`);
  const cost = (u.interviewer.costUsd + u.candidate.costUsd).toFixed(4);
  console.log(`호출: 면접관 ${u.interviewer.calls}회 / 지원자 ${u.candidate.calls}회 · 비용 $${cost}${r.backend === "api" ? " (API 백엔드는 비용 미집계)" : ""}`);
  console.log(`결과 파일: ${file}`);
}

// 경로에 공백 등이 있으면 URL이 퍼센트 인코딩되므로 파일 경로로 바꿔 비교한다.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      target: { type: "string", default: "claude" },
      division: { type: "string", default: "light" },
      engine: { type: "string" },
      interviewer: { type: "string", default: "sonnet" },
      until: { type: "string", default: "final" },
      seed: { type: "string" },
      "screen-all": { type: "boolean", default: false },
      quiet: { type: "boolean", default: false },
      "no-stop": { type: "boolean", default: false },
      "fresh-exam": { type: "boolean", default: false },
    },
  });
  if (positionals.length !== 1) {
    console.error("사용법: node runner/run.ts <agent.md> [--target claude] [--division light|middle|open] [--until doc] ...");
    process.exit(2);
  }
  const report = await interviewFile({
    mdPath: positionals[0],
    target: values.target!,
    division: values.division!,
    engine: values.engine as ModelAlias | undefined,
    interviewer: values.interviewer as ModelAlias,
    until: values.until as Stage,
    seed: values.seed ? Number(values.seed) : undefined,
    screenAll: values["screen-all"]!,
    quiet: values.quiet!,
    noStop: values["no-stop"]!,
    freshExam: values["fresh-exam"]!,
  });
  printSummary(report, saveReport(report));
}
