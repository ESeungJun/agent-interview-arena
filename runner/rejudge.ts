// 채점 편차 측정: 저장된 면접 결과의 지원자 응답은 그대로 두고 1·2차 채점만 K번 다시 돌린다.
//   node runner/rejudge.ts <agent.md> <results/xxx.json> [--times 4] [--round r1|r2|both] [--interviewer sonnet] [--detail]
//   --detail: 회차마다 판정이 달라진 항목의 결과와 이유를 출력한다.
// 같은 응답에 대한 점수가 얼마나 흔들리는지(면접관 편차)만 본다. 지원자 응답의 편차는 섞이지 않는다.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { checkContracts } from "../core/detectors.ts";
import type { ModelAlias } from "../core/engine.ts";
import { memoryExamStore, openExam } from "../core/exam.ts";
import type { InterviewReport } from "./run.ts";
import { PASS_LINE, type Verdict } from "../core/scoring.ts";
import {
  evaluateRound1, evaluateRound2, type Context, type DocResult, type Round1Result, type Round2Result, type RoundJudgement,
} from "../core/stages.ts";
import { localLlm } from "./cli_engine.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    times: { type: "string", default: "4" },
    round: { type: "string", default: "both" },
    interviewer: { type: "string", default: "sonnet" },
    detail: { type: "boolean", default: false },
  },
});
if (positionals.length !== 2) {
  console.error("사용법: node runner/rejudge.ts <agent.md> <results/xxx.json> [--times 4] [--round r1|r2|both]");
  process.exit(2);
}
const md = readFileSync(positionals[0], "utf8");
const report = JSON.parse(readFileSync(positionals[1], "utf8")) as InterviewReport;
const times = Number(values.times);
const doc = (report.stages.doc as DocResult).output;

// 재채점은 저장된 응답만 다시 채점하므로 출제분을 읽거나 쓰지 않는다.
const exam = await openExam(md, { store: memoryExamStore(), fresh: true });
const llm = localLlm();

function newContext(): Context {
  return {
    md, llm, target: report.config.target, engine: report.config.engine, interviewer: values.interviewer as ModelAlias,
    rng: Math.random, screenSampleRate: 0, log: () => {}, exam,
    usage: {
      interviewer: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0, calls: 0 },
      candidate: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0, calls: 0 },
    },
  };
}

/** 같은 (target, id) 판정이 회차마다 달라진 비율. 달라진 항목은 회차별 결과와 이유를 함께 돌려준다. */
function flipRate(all: Verdict[][]): { rate: number; flipped: string[]; details: string[] } {
  const seen = new Map<string, Verdict[]>();
  for (const vs of all) {
    for (const v of vs) {
      const key = `${v.target ?? ""} ${v.id}`;
      if (!seen.has(key)) seen.set(key, []);
      seen.get(key)!.push(v);
    }
  }
  const unstable = [...seen].filter(([, vs]) => new Set(vs.map(v => v.result)).size > 1);
  return {
    rate: unstable.length / Math.max(1, seen.size),
    flipped: unstable.map(([k, vs]) => `${k}(${[...new Set(vs.map(v => v.result))].join("/")})`),
    details: unstable.flatMap(([k, vs]) => [`  · ${k}`, ...vs.map(v => `      ${v.result}: ${v.reason}`)]),
  };
}

async function measure(label: string, passLine: number, run: (ctx: Context) => Promise<RoundJudgement>): Promise<void> {
  const ctxs = Array.from({ length: times }, newContext);
  const started = Date.now();
  const results = await Promise.all(ctxs.map(run));
  const scores = results.map(r => r.score);
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const sd = Math.sqrt(scores.reduce((s, x) => s + (x - mean) ** 2, 0) / scores.length);
  const passes = scores.filter(s => s >= passLine).length;
  const { rate, flipped, details } = flipRate(results.map(r => r.output.verdicts));
  // 가격을 모르는 모델이 섞이면 null (비용을 모른다)
  const cost = ctxs.reduce<number | null>((s, c) => (s === null || c.usage.interviewer.costUsd === null ? null : s + c.usage.interviewer.costUsd), 0);
  const calls = ctxs.reduce((s, c) => s + c.usage.interviewer.calls, 0);
  const input = ctxs.reduce((s, c) => s + c.usage.interviewer.inputTokens, 0);
  const cached = ctxs.reduce((s, c) => s + c.usage.interviewer.cacheReadTokens, 0);
  console.log(`\n━━ ${label} (통과선 ${passLine}) × ${times}회`);
  console.log(`  점수 ${scores.join(" / ")}  평균 ${mean.toFixed(1)} · 표준편차 ${sd.toFixed(1)} · 범위 ${Math.max(...scores) - Math.min(...scores)}`);
  console.log(`  합격 ${passes}/${times}  ${passes === 0 || passes === times ? "합불 일치" : "⚠️ 합불이 갈림"}`);
  console.log(`  판정 불일치 ${(rate * 100).toFixed(0)}%  ${flipped.join(", ")}`);
  if (values.detail) for (const d of details) console.log(d);
  console.log(`  면접관 호출 ${calls}회 · 비용 $${cost === null ? "?" : cost.toFixed(3)} · 입력 ${input} 토큰 중 캐시 읽기 ${cached} · ${((Date.now() - started) / 1000).toFixed(0)}초`);
}

if (values.round !== "r2") {
  const r1 = report.stages.r1 as Round1Result | undefined;
  if (!r1) console.log("1차 기록 없음");
  else await measure("1차", PASS_LINE.r1, ctx => evaluateRound1(ctx, doc, r1.tasks, r1.responses, r1.contractViolations));
}
if (values.round !== "r1") {
  const r2 = report.stages.r2 as Round2Result | undefined;
  if (!r2) console.log("2차 기록 없음");
  else {
    const violated = r2.scenarios.filter(s => r2.transcripts[s.id].some(t => checkContracts(t, doc.verifiable_contracts).length > 0)).map(s => s.id);
    await measure("2차", PASS_LINE.r2, ctx => evaluateRound2(ctx, doc, r2.scenarios, r2.transcripts, violated));
  }
}
