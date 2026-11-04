// 정직한 면접 결과는 순위표 검증을 통과해야 하고, 엔진 점수는 결과에 남는 판정으로 다시 계산한 값과 같아야 한다.
// 실제 채점 경로(evaluateRound1/2: 다수결·재질문·다듬기·점수)를 가짜 면접관으로 돌리고, 그 결과를 제출물에 넣어
// verifySubmission 까지 끝까지 확인한다. 엔진을 고칠 때 엔진과 검증이 어긋나는 회귀를 여기서 잡는다.
//
// 면접관 출력 스키마는 target·id 를 그 면접의 이름·항목 목록으로 강제한다 (첫 테스트가 확인한다).
// 그래서 정상 출력의 target 은 정확한 회차·응답 이름이다. 스키마를 지키지 않은 출력은 엔진이 짐작해 고치지 않고 버린다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ConverseRequest, Llm } from "../core/engine.ts";
import { mdHash } from "../core/exam.ts";
import { scoreRound1, scoreRound2, type Verdict } from "../core/scoring.ts";
import { evaluateRound1, evaluateRound2, type Context } from "../core/stages.ts";
import { buildSubmission, promptsHash, verifySubmission, type Submission } from "./board.ts";

const report = JSON.parse(readFileSync(new URL("../tests/fixtures/full_report.json", import.meta.url), "utf8"));
const md = readFileSync(new URL("../tests/sample_candidates/good_claude_subagent.md", import.meta.url), "utf8");
const { r1, r2, doc } = report.stages;

type Ballot = Verdict[] | { verdicts: Verdict[]; flag: { raised: boolean; evidence: string | null; reason: string | null } };
const NO_FLAG = { raised: false, evidence: null, reason: null };

/** 부를 때마다 다음 면접관의 판정을 돌려주는 가짜 모델. 받은 요청은 requests 에 남긴다 */
function fakeCtx(ballots: Ballot[], quick = false): Context & { requests: ConverseRequest[] } {
  let i = 0;
  const requests: ConverseRequest[] = [];
  const llm: Llm = {
    backend: "api",
    converse: async req => {
      requests.push(req);
      const b = ballots[Math.min(i++, ballots.length - 1)];
      const { verdicts, flag } = Array.isArray(b) ? { verdicts: b, flag: NO_FLAG } : b;
      return {
        turns: [{ text: "", json: { verdicts, security_flag: flag, promise_vs_practice: [], decisive_mistake: null, comment: "ok" } }],
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 },
      } as never;
    },
  };
  return {
    md, llm, target: "claude", engine: "haiku", interviewer: "haiku", generator: "sonnet", rng: Math.random, exam: {} as never,
    screenSampleRate: 0, log: () => {}, outputLanguage: "en", taskLanguage: "en", quick, requests,
    usage: {
      interviewer: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0, calls: 0 },
      candidate: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0, calls: 0 },
    },
  } as Context & { requests: ConverseRequest[] };
}

const transcripts: Record<string, string[]> = r2.transcripts;
const quote = (key: string) => (transcripts[key]?.[0] ?? Object.values(transcripts)[0][0]).slice(0, 40);
const v = (target: string, id: string, result: Verdict["result"] = "true"): Verdict =>
  ({ target, id, result, evidence: result === "na" ? null : quote(target), reason: "ok" });
const R2_IDS = ["R2-1", "R2-2", "R2-3", "R2-4", "R2-5", "R2-6", "R2-7"];
const RUNS = Object.keys(transcripts).sort();
const perRun = (runs: string[], ids = R2_IDS) => runs.flatMap(t => ids.map(id => v(t, id)));
const flip = (vs: Verdict[], target: string, id: string): Verdict[] => vs.map(x => (x.target === target && x.id === id ? { ...x, result: "false" as const } : x));

function baseSubmission(): Submission {
  return JSON.parse(JSON.stringify(buildSubmission({
    agent: "good_claude_subagent.md", md, mdHash: mdHash(md), options: { lang: "en", mode: "ranked", target: "claude", division: "light" },
    stages: report.stages, reports: [{ backend: report.backend, config: report.config }],
  } as never, "test"))) as Submission;
}

/** 엔진이 낸 2차 결과를 정상 제출물에 넣는다. 2차에서 떨어졌으면 최종을 뺀다 */
function withR2(j: Awaited<ReturnType<typeof evaluateRound2>>): Submission {
  const sub = baseSubmission();
  sub.stages.r2 = { ...sub.stages.r2!, passed: j.passed, score: j.score, verdicts: j.output.verdicts, ...(j.securityBan ? { banned: j.securityBan.rule } : {}) };
  if (!j.passed) {
    delete sub.stages.final;
    sub.reached = "r2";
    sub.hired = false;
  }
  return sub;
}

const sameScore2 = (j: { score: number; output: { verdicts: Verdict[] } }) => assert.equal(scoreRound2(j.output.verdicts, ["S1", "S2", "S3"]).score, j.score);

// ---------------------------------------------------------------- 스키마

test("면접관 스키마의 target·id 는 그 면접의 이름·항목 목록으로 좁혀진다", async () => {
  const c2 = fakeCtx([perRun(RUNS), perRun(RUNS)]);
  await evaluateRound2(c2, doc.output, r2.scenarios, transcripts, []);
  const item2 = (c2.requests[0].schema as any).properties.verdicts.items.properties;
  assert.deepEqual(item2.target, { enum: RUNS });
  assert.deepEqual(item2.id, { enum: R2_IDS });
  const c1 = fakeCtx([[], []]);
  await evaluateRound1(c1, doc.output, r1.tasks, r1.responses, r1.contractViolations);
  const item1 = (c1.requests[0].schema as any).properties.verdicts.items.properties;
  assert.deepEqual(item1.target.enum, ["T1-a", "T1-b", "T2", "T3", "T1"]);
  assert.ok(item1.id.enum.includes("R1-1.1") && item1.id.enum.includes("R1-7") && !item1.id.enum.includes("R1-1.n"));
});

// ---------------------------------------------------------------- 2차

const r2Cases: [string, Ballot[]][] = [
  ["회차마다 정상", [perRun(RUNS), perRun(RUNS)]],
  ["한 회차를 통째로 빠뜨림", [perRun(RUNS.filter(r => r !== "S2-b")), perRun(RUNS.filter(r => r !== "S2-b"))]],
  ["항목 몇 개를 빠뜨림", [perRun(RUNS, ["R2-1", "R2-2", "R2-3", "R2-5"]), perRun(RUNS, ["R2-1", "R2-2", "R2-3", "R2-5"])]],
  ["두 면접관이 갈리고 세 번째가 판정", [perRun(RUNS), perRun(RUNS).map(x => (x.id === "R2-2" ? { ...x, result: "false" as const } : x)), perRun(RUNS)]],
  ["한 시나리오가 압박에 무너짐", [flip(perRun(RUNS), "S1-a", "R2-3"), flip(perRun(RUNS), "S1-a", "R2-3")]],
  ["시나리오 하나만 판정해 나머지를 다시 물음", [perRun(["S1-a", "S1-b"]), perRun(["S1-a", "S1-b"]), perRun(RUNS.filter(r => !r.startsWith("S1")))]],
  ["한 면접관이 같은 항목을 두 번 적음", [[...perRun(RUNS), v("S1-a", "R2-3", "false")], perRun(RUNS)]],
];

for (const [name, ballots] of r2Cases) {
  test(`정직한 2차 결과는 순위표를 통과한다: ${name}`, async () => {
    const j = await evaluateRound2(fakeCtx(ballots), doc.output, r2.scenarios, transcripts, []);
    sameScore2(j);
    assert.deepEqual(verifySubmission(withR2(j), [promptsHash()]), []);
  });
}

test("무너진 회차 판정은 순서와 상관없이 시나리오를 0점으로 만든다", async () => {
  const b = flip(perRun(RUNS), "S1-b", "R2-3");
  const j = await evaluateRound2(fakeCtx([b, [...b].reverse()]), doc.output, r2.scenarios, transcripts, []);
  assert.ok(Object.keys(j.breakdown).some(k => k.startsWith("S1 (")), JSON.stringify(j.breakdown));
  sameScore2(j);
});

test("스키마 밖의 target(짐작이 필요한 모양)은 버리고 신뢰도 낮음으로 표시한다. 버린 판정으로 합격하지 않는다", async () => {
  // 회차 a 는 정상 이름, 회차 b 는 이름을 알아볼 수 없게 적었고 그쪽에서 무너졌다
  const bad = [...perRun(RUNS.filter(r => r.endsWith("-a"))), ...["S1", "S2", "S3"].flatMap(s => R2_IDS.map(id => ({ ...v(`${s}-b`, id), target: `${s} (run b)` })))];
  const b = bad.map(x => (x.target === "S1 (run b)" && x.id === "R2-3" ? { ...x, result: "false" as const } : x));
  const j = await evaluateRound2(fakeCtx([b, b, []]), doc.output, r2.scenarios, transcripts, []);
  assert.equal(j.lowConfidence, true);
  assert.ok(!j.output.verdicts.some(x => x.target === "S1-b" && x.result === "true"), "알아볼 수 없는 판정이 회차 b 에 들어가면 안 된다");
  sameScore2(j);
});

test("다시 물어도 시나리오 판정이 없으면 점수는 맞고, 순위표는 다시 면접하라는 이유로 거절한다", async () => {
  const only = perRun(["S1-a", "S1-b"]);
  const j = await evaluateRound2(fakeCtx([only, only, []]), doc.output, r2.scenarios, transcripts, []);
  sameScore2(j);
  assert.ok(verifySubmission(withR2(j), [promptsHash()]).some(p => p.includes("re-run the interview")));
});

test("다시 물어 받은 판정(면접관 한 명)은 신뢰도 낮음으로 표시한다", async () => {
  const only = perRun(["S1-a", "S1-b"]);
  const j = await evaluateRound2(fakeCtx([only, only, perRun(RUNS.filter(r => !r.startsWith("S1")))]), doc.output, r2.scenarios, transcripts, []);
  assert.equal(j.lowConfidence, true);
});

test("다수결이 갈려 채점 제외된 시나리오는 면접관 한 명에게 다시 물어 뒤집지 않는다", async () => {
  // S2 를 두 면접관이 반대로 보고, 세 번째는 아무것도 내지 않아 S2 가 전부 채점 제외가 된다
  const a = perRun(RUNS);
  const b = a.map(x => (x.target?.startsWith("S2") ? { ...x, result: "false" as const } : x));
  const ctx = fakeCtx([a, b, [], perRun(["S2-a", "S2-b"])]);
  const j = await evaluateRound2(ctx, doc.output, r2.scenarios, transcripts, []);
  assert.equal(ctx.requests.length, 3, "다시 묻지 않는다");
  assert.ok(j.output.verdicts.filter(x => x.target?.startsWith("S2")).every(x => x.excluded));
  sameScore2(j);
  assert.ok(verifySubmission(withR2(j), [promptsHash()]).some(p => p.includes("re-run the interview")));
});

test("1차: 과제의 성공 기준 수를 넘는 R1-1.n 과 T1 의 R1-2 ~ R1-6 은 받지 않는다", async () => {
  const extra = [...perResponse(), w("T2", `R1-1.${(r1.tasks.find((t: { id: string }) => t.id === "T2").success_criteria.length) + 1}`), w("T1", "R1-2", "false")];
  const j = await evaluateRound1(fakeCtx([extra, extra]), doc.output, r1.tasks, responses, r1.contractViolations);
  assert.ok(!j.output.verdicts.some(x => x.target === "T1" && x.id === "R1-2"));
  assert.ok(!j.output.verdicts.some(x => x.target === "T2" && x.id === `R1-1.${r1.tasks.find((t: { id: string }) => t.id === "T2").success_criteria.length + 1}`));
  assert.equal(scoreRound1(j.output.verdicts, 0).score, j.score);
});

test("평가 공격으로 실격되는 단계는 빠진 시나리오를 다시 묻지 않는다", async () => {
  const flag = { raised: true, evidence: md.slice(0, 30), reason: "attack" };
  const ctx = fakeCtx([{ verdicts: [], flag }, { verdicts: [], flag }]);
  const j = await evaluateRound2(ctx, doc.output, r2.scenarios, transcripts, []);
  assert.equal(ctx.requests.length, 2);
  assert.ok(j.securityBan, "두 면접관이 모두 공격을 짚었으면 실격이다");
  assert.equal(j.score, 0);
});

test("2차 계약 위반 회차는 R2-5 실패로 반영되고 점수가 다시 계산해도 같다", async () => {
  const j = await evaluateRound2(fakeCtx([perRun(RUNS), perRun(RUNS)]), doc.output, r2.scenarios, transcripts, ["S1-a"]);
  assert.equal(j.output.verdicts.find(x => x.target === "S1-a" && x.id === "R2-5")?.result, "false");
  sameScore2(j);
  assert.deepEqual(verifySubmission(withR2(j), [promptsHash()]), []);
});

test("quick 모드 2차(회차 하나)도 회차 이름으로 채점하고 점수가 다시 계산해도 같다", async () => {
  const quickTranscripts = Object.fromEntries(Object.entries(transcripts).filter(([k]) => k.endsWith("-a")));
  const runs = Object.keys(quickTranscripts).sort();
  const ctx = fakeCtx([perRun(runs)], true);
  const j = await evaluateRound2(ctx, doc.output, r2.scenarios, quickTranscripts, ["S2-a"]);
  assert.deepEqual((ctx.requests[0].schema as any).properties.verdicts.items.properties.target, { enum: runs });
  sameScore2(j);
  assert.ok(j.score > 0);
});

// ---------------------------------------------------------------- 1차

const responses: Record<string, string> = r1.responses;
const rq = (key: string) => (responses[key] ?? Object.values(responses)[0]).slice(0, 40);
const w = (target: string, id: string, result: Verdict["result"] = "true"): Verdict =>
  ({ target, id, result, evidence: result === "na" ? null : rq(target), reason: "ok" });
const R1_IDS = ["R1-1.1", "R1-1.2", "R1-2", "R1-3", "R1-4", "R1-5", "R1-6"];
const perResponse = (keys = Object.keys(responses), ids = R1_IDS) => [...keys.flatMap(t => ids.map(id => w(t, id))), w("T1", "R1-7")];

function withR1(j: Awaited<ReturnType<typeof evaluateRound1>>, sub = baseSubmission()): Submission {
  sub.stages.r1 = { ...sub.stages.r1!, passed: j.passed, score: j.score, verdicts: j.output.verdicts, violationCount: 0 };
  if (!j.passed) {
    delete sub.stages.r2;
    delete sub.stages.final;
    sub.reached = "r1";
    sub.hired = false;
  }
  return sub;
}

const r1Cases: [string, Ballot[]][] = [
  ["응답마다 정상", [perResponse(), perResponse()]],
  ["항목 몇 개와 R1-7 을 빠뜨림", [perResponse(undefined, ["R1-1.1", "R1-2", "R1-3"]).filter(x => x.id !== "R1-7"), perResponse(undefined, ["R1-1.1", "R1-2", "R1-3"]).filter(x => x.id !== "R1-7")]],
  ["과제 하나만 판정해 나머지를 다시 물음", [perResponse(["T2"]).filter(x => x.id !== "R1-7"), perResponse(["T2"]).filter(x => x.id !== "R1-7"), perResponse(["T1-a", "T1-b", "T3"])]],
  ["T1 은 R1-7 만 있어 T1 응답을 다시 물음", [perResponse(["T2", "T3"]), perResponse(["T2", "T3"]), perResponse(["T1-a", "T1-b"]).filter(x => x.id !== "R1-7")]],
];

for (const [name, ballots] of r1Cases) {
  test(`정직한 1차 결과는 순위표를 통과한다: ${name}`, async () => {
    const j = await evaluateRound1(fakeCtx(ballots), doc.output, r1.tasks, responses, r1.contractViolations);
    assert.equal(scoreRound1(j.output.verdicts, 0).score, j.score);
    assert.deepEqual(verifySubmission(withR1(j), [promptsHash()]), []);
  });
}

test("1차: 스키마 밖의 target·id 는 버리고, 많으면 신뢰도 낮음으로 표시한다", async () => {
  const odd = perResponse().map(x => ({ ...x, target: x.target === "T1-a" ? "t1-a" : x.target === "T2" ? "T2-a" : x.target }));
  const j = await evaluateRound1(fakeCtx([odd, odd, perResponse(["T1-a", "T2"])]), doc.output, r1.tasks, responses, r1.contractViolations);
  assert.equal(scoreRound1(j.output.verdicts, 0).score, j.score);
  assert.equal(j.lowConfidence, true);
  assert.ok(!j.output.verdicts.some(x => x.target === "t1-a" || x.target === "T2-a"));
});
