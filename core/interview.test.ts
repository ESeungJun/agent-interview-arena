import { test } from "node:test";
import assert from "node:assert/strict";
import type { Llm } from "./engine.ts";
import { memoryExamStore } from "./exam.ts";
import { ChallengeLockedError, nextChallenge, runChallenge, type StageResults } from "./interview.ts";

const pass = { passed: true } as never;
const fail = { passed: false } as never;

test("서류부터 한 단계씩 열린다", () => {
  assert.equal(nextChallenge({}), "doc");
  assert.equal(nextChallenge({ security: pass, doc: pass }), "r1");
  assert.equal(nextChallenge({ security: pass, doc: pass, r1: pass }), "r2");
  assert.equal(nextChallenge({ security: pass, doc: pass, r1: pass, r2: pass }), "final");
  assert.equal(nextChallenge({ security: pass, doc: pass, r1: pass, r2: pass, final: pass }), null);
});

test("탈락하거나 보안 실격이면 다음 단계가 열리지 않는다", () => {
  assert.equal(nextChallenge({ security: pass, doc: fail }), null);
  assert.equal(nextChallenge({ security: pass, doc: pass, r1: fail }), null);
  assert.equal(nextChallenge({ security: fail }), null);
});

test("앞 단계를 통과하지 않은 단계는 LLM을 부르기 전에 거부한다", async () => {
  let calls = 0;
  const llm: Llm = { backend: "api", converse: async () => (calls++, { turns: [], usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 } }) };
  const opts = { md: "x", llm, examStore: memoryExamStore(), target: "claude", division: "light", interviewer: "sonnet" as const, screenAll: false };
  const cases: [Parameters<typeof runChallenge>[1], StageResults][] = [
    ["r1", {}],
    ["r2", { security: pass, doc: pass }],
    ["final", { security: pass, doc: pass, r1: pass, r2: fail }],
    ["doc", { security: pass, doc: pass }],
  ];
  for (const [challenge, prior] of cases) {
    await assert.rejects(runChallenge(opts, challenge, prior), ChallengeLockedError);
  }
  assert.equal(calls, 0);
});
