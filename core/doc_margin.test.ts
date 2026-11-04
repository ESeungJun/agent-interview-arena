import { test } from "node:test";
import assert from "node:assert/strict";
import type { Llm } from "./engine.ts";
import { scoreDoc, type Verdict } from "./scoring.ts";
import { docScreening, DOC_MARGIN, type Context } from "./stages.ts";
import { PASS_LINE } from "./scoring.ts";

const MD = "You review pull requests. QUOTE marks the rule we cite.";
const IDS = ["D1-1", "D1-2", "D1-3", "D1-4", "D2-1", "D2-2", "D2-3", "D2-4", "D2-5", "D3-1", "D3-2", "D5-1", "D5-2", "D6-1", "D7-1"];
const ballot = (trueOnes: (id: string) => boolean): Verdict[] =>
  IDS.map(id => (trueOnes(id) ? { id, result: "true", evidence: "QUOTE", reason: "r" } : { id, result: "false", evidence: null, reason: "r" }));

/** 서류 전체 채점은 차례대로 full[0], full[1] … 을, 항목만 묻는 표는 요청한 항목을 모두 true 로 답한다 */
type Flag = { raised: boolean; evidence: string | null; reason: string | null };
const NO_FLAG: Flag = { raised: false, evidence: null, reason: null };

function fakeCtx(full: Verdict[][], quick = false, flags: Flag[] = []): { ctx: Context; calls: string[] } {
  const calls: string[] = [];
  let n = 0;
  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 };
  const llm: Llm = {
    backend: "api",
    converse: async req => {
      const user = req.userTurns[0];
      let json: unknown;
      const only = /judge only checklist items ([A-Z0-9-, ]+)\./.exec(user);
      if (only) {
        calls.push(`items:${only[1]}`);
        json = { verdicts: only[1].split(", ").map(id => ({ id, result: "true", evidence: "QUOTE", reason: "item" })) };
      } else if (user.includes("Search the source")) {
        calls.push("recheck");
        json = { rechecks: [] };
      } else {
        calls.push("full");
        const k = n++;
        json = {
          security_flag: flags[k] ?? NO_FLAG, verdicts: full[k], verifiable_contracts: [],
          job_profile: { job_title: "reviewer", core_tasks: [], typical_failure_modes: [], has_tools: false },
          persona: { personality_keywords: [], speech_style: "", waiting_room_monologue: "" }, feedback: [],
        };
      }
      return { turns: [{ text: "", json }], usage } as never;
    },
  };
  const ctx = {
    md: MD, llm, target: "generic", engine: "haiku", interviewer: "haiku", rng: () => 0.5, exam: {} as never, screenSampleRate: 0,
    log: () => {}, usage: { interviewer: { ...usage, calls: 0 }, candidate: { ...usage, calls: 0 } }, outputLanguage: "en", taskLanguage: "en", quick,
  } as unknown as Context;
  return { ctx, calls };
}

// D1 과 D2-3·D2-4 만 true 면 통과선 근처, 두 번째 면접관은 D2·D3 까지 true 로 본다
// D1-4·D2-3·D2-4 는 흔들리는 항목이라 첫 채점 직후 3표로 다시 정해진다. 가짜 면접관이 true 로 답하므로 처음부터 true 로 둔다
const near = ballot(id => id.startsWith("D1-") || id === "D2-3" || id === "D2-4");
const other = ballot(id => id.startsWith("D1-") || id.startsWith("D2-") || id.startsWith("D3-"));

test("서류 점수가 통과선 근처면 한 번 더 채점하고, 갈린 항목만 세 번째 면접관이 정한다", async () => {
  const before = scoreDoc(near, "generic").score;
  assert.ok(scoreDoc(other, "generic").score !== before);
  assert.ok(Math.abs(before - PASS_LINE.doc) <= DOC_MARGIN, `시험 전제: 첫 점수 ${before}점이 통과선 근처여야 한다`);
  const { ctx, calls } = fakeCtx([near, other]);
  const r = await docScreening(ctx);
  // 두 번째 면접관은 D2·D3 를 true 로, 세 번째도 true 로 봤으므로 2:1 로 true 가 된다
  // (흔들리는 항목 D1-4·D2-3·D2-4 는 첫 채점 뒤 이미 3표로 정해졌으므로 재채점 표결에서 빠진다)
  assert.equal(r.score, scoreDoc(other, "generic").score);
  assert.equal(r.marginCheck?.scoreBefore, before);
  assert.ok(calls.includes("items:D2-1, D2-2, D2-5, D3-1, D3-2"), calls.join(" | "));
  assert.equal(calls.filter(c => c === "full").length, 2);
  // 순위표는 판정으로 점수를 다시 계산하므로, 결과 점수는 남긴 판정에서 나와야 한다
  assert.equal(scoreDoc(r.output.verdicts, "generic").score, r.score);
});

test("통과선에서 먼 점수와 연습 모드는 다시 채점하지 않는다", async () => {
  const all = ballot(() => true);
  const far = fakeCtx([all]);
  const r = await docScreening(far.ctx);
  assert.equal(r.marginCheck, undefined);
  assert.equal(far.calls.filter(c => c === "full").length, 1);

  const quick = fakeCtx([near], true);
  const q = await docScreening(quick.ctx);
  assert.equal(q.marginCheck, undefined);
  assert.equal(quick.calls.filter(c => c === "full").length, 1);
});

test("재채점에서 두 번째 면접관이 근거와 함께 공격을 찾으면 실격이다 (1·2차와 같은 기준)", async () => {
  const flag: Flag = { raised: true, evidence: "QUOTE marks the rule", reason: "grading instruction" };
  const { ctx } = fakeCtx([near, other], false, [NO_FLAG, flag]);
  const r = await docScreening(ctx);
  assert.equal(r.passed, false);
  assert.equal(r.securityBan?.evidence, flag.evidence);
});

test("흔들리는 항목은 재채점 표결에 다시 들지 않는다 (이미 정한 3표가 한 표로 줄지 않게)", async () => {
  // 두 번째 면접관은 D1-4 를 false 로 본다. 이미 3표로 true 가 됐으므로 그대로 true 여야 한다
  const second = other.map(v => (v.id === "D1-4" ? { ...v, result: "false" as const, evidence: null } : v));
  const { ctx, calls } = fakeCtx([near, second]);
  const r = await docScreening(ctx);
  assert.equal(r.output.verdicts.find(v => v.id === "D1-4")?.result, "true");
  assert.ok(!calls.some(c => c.startsWith("items:") && c.includes("D1-4") && !c.startsWith("items:D1-4, D2-3, D2-4")), calls.join(" | "));
});
