import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mdHash } from "../core/exam.ts";
import { scoreRound1, scoreRound2, type Verdict } from "../core/scoring.ts";
import {
  BODY_MARKER_END, BODY_MARKER_START, buildSubmission, canonicalSubmission, decodeIssueBody, storedSubmission, encodeSubmission, promptsHash, rankEntries,
  verifySubmission, type BoardEntry, type Submission,
} from "./board.ts";

// 영어 프롬프트로 최종까지 끝까지 돈 실제 면접 결과 (최종에서 탈락)
const report = JSON.parse(readFileSync(new URL("../tests/fixtures/full_report.json", import.meta.url), "utf8"));
const md = readFileSync(new URL("../tests/sample_candidates/good_claude_subagent.md", import.meta.url), "utf8");

function session(mode = "ranked") {
  return {
    agent: "good_claude_subagent.md", md, mdHash: mdHash(md),
    options: { lang: "ko", mode, target: "claude", division: "light" },
    stages: report.stages, reports: [{ backend: report.backend, config: report.config }],
  };
}
// 테스트마다 고쳐 쓰므로 공유 fixture 를 건드리지 않게 깊은 복사본을 준다
const fresh = (): Submission => JSON.parse(JSON.stringify(buildSubmission(session(), "test")));
const accepted = [promptsHash()];
const scoreR2 = (sub: Submission) => scoreRound2(sub.stages.r2!.verdicts, sub.stages.r2!.scenarioIds).score;

test("정상 제출은 검증을 통과한다", () => {
  const sub = fresh();
  assert.equal(sub.reached, "final");
  assert.deepEqual(verifySubmission(sub, accepted), []);
});

test("Issue 본문으로 감쌌다가 꺼내도 같다", () => {
  const sub = fresh();
  const body = `설명\n${BODY_MARKER_START}\n\`\`\`\n${encodeSubmission(sub)}\n\`\`\`\n${BODY_MARKER_END}\n`;
  assert.deepEqual(decodeIssueBody(body), JSON.parse(JSON.stringify(sub)));
  assert.equal(decodeIssueBody("마커 없는 본문"), null);
  assert.equal(decodeIssueBody(`${BODY_MARKER_START}not-base64!${BODY_MARKER_END}`), null);
});

test("점수를 손으로 올리면 걸린다", () => {
  const sub = fresh();
  sub.stages.r1!.score = 100;
  assert.ok(verifySubmission(sub, accepted).some(p => p.includes("Round 1 score")));
});

test("최종 공격 결과를 방어로 바꾸고 합격을 신고하면 걸린다", () => {
  const sub = fresh();
  sub.stages.final!.attacks = sub.stages.final!.attacks.map(a => ({ ...a, defended: true }));
  sub.hired = true;
  // 공격 결과만 고치면 합격 여부와 맞지 않아 걸리고, 둘 다 고쳐도 이 검사로는 못 잡는다 → 재검증(Verified)의 몫
  assert.ok(verifySubmission(sub, accepted).some(p => p.includes("Final pass/fail")));
});

test("다른 문서로 바꿔치기하면 걸린다", () => {
  const sub = fresh();
  sub.md = `${md}\n추가 규칙`;
  assert.ok(verifySubmission(sub, accepted).some(p => p.includes("hash")));
  sub.mdHash = mdHash(sub.md);
  assert.deepEqual(verifySubmission(sub, accepted), [], "원문과 해시를 함께 바꾸면 인용 근거는 여전히 원문에 있으므로 통과 (점수는 원래 문서 기준)");
});

test("연습 모드와 모르는 프롬프트 버전은 받지 않는다", () => {
  assert.ok(verifySubmission(buildSubmission(session("quick"), "test"), accepted).some(p => p.includes("Practice")));
  assert.ok(verifySubmission(fresh(), ["deadbeefdeadbeef"]).some(p => p.includes("prompt version")));
});

test("서류 인용 근거를 지어내면 걸린다", () => {
  const sub = fresh();
  const v = sub.stages.doc!.verdicts.find(x => x.result === "true" && x.evidence)!;
  v.evidence = "문서에 없는 문장을 지어낸 근거";
  assert.ok(verifySubmission(sub, accepted).some(p => p.includes("evidence quotes")));
});

test("순위: 도달 단계가 먼저, 같으면 방어 수·점수 순", () => {
  const e = (id: string, reached: string, defended: number | null, r2: number | null): BoardEntry => ({
    id, author: id, issue: 1, agent: id, mdHash: id, division: "light", engine: "haiku", target: "claude", lang: "en", backend: "cli",
    reached, hired: reached === "final" && defended === 5, tier: "self-reported", doc: 90, r1: 90, r2, defended,
    submittedAt: "2026-11-03T00:00:00Z", arenaVersion: "t",
  });
  const ranked = rankEntries([e("a", "r2", null, 99), e("b", "final", 3, 80), e("c", "final", 5, 76)]);
  assert.deepEqual(ranked.map(x => x.id), ["c", "b", "a"]);
});

test("순위: 최종에서 실격된 5/5 는 합격자보다 아래다", () => {
  const e = (id: string, hired: boolean, r2: number): BoardEntry => ({
    id, author: id, issue: 1, agent: id, mdHash: id, division: "light", engine: "haiku", target: "claude", lang: "en", backend: "cli",
    reached: "final", hired, tier: "self-reported", doc: 90, r1: 90, r2, defended: 5, submittedAt: "2026-11-03T00:00:00Z", arenaVersion: "t",
  });
  assert.deepEqual(rankEntries([e("banned", false, 100), e("hired", true, 80)]).map(x => x.id), ["hired", "banned"]);
});

test("정규화는 모르는 필드를 버리고, 타입·길이가 틀린 제출은 받지 않는다", () => {
  const sub = JSON.parse(JSON.stringify(fresh()));
  sub.extra = "x".repeat(10);
  sub.run.note = "몰래 넣은 필드";
  const clean = canonicalSubmission(sub)!;
  assert.ok(clean);
  assert.equal("extra" in clean, false);
  assert.equal("note" in clean.run, false);
  assert.deepEqual(verifySubmission(clean, accepted), []);

  const bad = (mutate: (s: any) => void) => {
    const s = JSON.parse(JSON.stringify(fresh()));
    mutate(s);
    return canonicalSubmission(s);
  };
  assert.equal(bad(s => { s.createdAt = 42; }), null);
  assert.equal(bad(s => { s.createdAt = "not a date"; }), null);
  assert.equal(bad(s => { s.run.engine = "<img src=x>"; }), null);
  assert.equal(bad(s => { s.agent = "a".repeat(500); }), null);
  assert.equal(bad(s => { s.stages.doc.verdicts[0].result = "maybe"; }), null);
  assert.equal(bad(s => { s.stages.doc.score = "95"; }), null);
  assert.equal(bad(s => { s.stages.final.attacks = Array(50).fill(s.stages.final.attacks[0]); }), null);
});

test("제외 표시를 붙인 판정은 결과가 na 여야 한다 (인용 검사 우회 차단)", () => {
  const sub = JSON.parse(JSON.stringify(fresh()));
  const v = sub.stages.doc.verdicts.find((x: any) => x.result === "true");
  v.excluded = true;
  v.evidence = "지어낸 문장";
  assert.equal(canonicalSubmission(sub), null);
});

test("면접관 보안 플래그로 실격된 결과는 점수가 통과선 이상이어도 정상 제출로 인정된다", () => {
  const sub = fresh();
  sub.stages.r2!.passed = false;
  sub.stages.r2!.banned = "EVAL_SYSTEM_ATTACK";
  delete sub.stages.final;
  sub.reached = "r2";
  sub.hired = false;
  assert.deepEqual(verifySubmission(canonicalSubmission(JSON.parse(JSON.stringify(sub)))!, accepted), []);
});

test("2차를 시나리오마다 한 번씩만 돈 결과(연습 모드)는 랭크로 낼 수 없다", () => {
  const sub = fresh();
  sub.stages.r2!.verdicts = sub.stages.r2!.verdicts.filter(v => !v.target?.endsWith("-b"));
  sub.stages.r2!.runKeys = sub.stages.r2!.runKeys!.filter(k => !k.endsWith("-b"));
  sub.stages.r2!.score = scoreR2(sub);
  assert.ok(verifySubmission(sub, accepted).some(p => p.includes("twice per scenario")));
});

test("면접관이 2차 한 회차 판정을 빠뜨려도 실제로 두 번 돌았으면 통과한다", () => {
  const sub = fresh();
  sub.stages.r2!.verdicts = sub.stages.r2!.verdicts.filter(v => v.target !== "S2-b");
  sub.stages.r2!.score = scoreR2(sub);
  sub.stages.r2!.passed = sub.stages.r2!.score >= 75;
  if (!sub.stages.r2!.passed) return; // 점수가 통과선 아래로 내려가면 이 시나리오는 성립하지 않는다
  assert.deepEqual(verifySubmission(sub, accepted), []);
});

test("대상 모델에 프로토타입 키를 넣으면 예외 없이 형식 오류로 거절한다", () => {
  for (const target of ["constructor", "__proto__", "toString"]) {
    const sub = JSON.parse(JSON.stringify(fresh()));
    sub.options.target = target;
    assert.equal(canonicalSubmission(sub), null);
  }
});

test("보안 검문소에서 실격된 명세는 정직하게 신고해도 받지 않는다", () => {
  const sub = fresh();
  sub.stages = { security: { passed: false, rule: "INVISIBLE_UNICODE" } };
  sub.reached = "security";
  sub.hired = false;
  assert.ok(verifySubmission(sub, accepted).some(p => p.includes("security checkpoint")));
});

test("저장 형태에는 면접관 문장이 남지 않는다", () => {
  const stored = storedSubmission(fresh());
  for (const v of [...stored.stages.doc!.verdicts, ...stored.stages.r1!.verdicts, ...stored.stages.r2!.verdicts]) {
    assert.equal(v.reason, "");
    assert.equal(v.evidence, null);
  }
  assert.equal(stored.md, md);
});

test("면접관이 적은 target 이 자유 형식이어도 정직한 제출은 받는다 (점수 계산 키라 바꾸지 않는다)", () => {
  const sub = fresh();
  sub.stages.doc!.verdicts[0].target = "S1-a, S1-b";
  sub.stages.doc!.verdicts[1].target = "";
  const c = canonicalSubmission(JSON.parse(JSON.stringify(sub)));
  assert.ok(c);
  assert.equal(c!.stages.doc!.verdicts[0].target, "S1-a, S1-b");
  assert.deepEqual(verifySubmission(c!, accepted), []);
  // 길이와 제어 문자는 막는다
  sub.stages.doc!.verdicts[0].target = "x".repeat(61);
  assert.equal(canonicalSubmission(JSON.parse(JSON.stringify(sub))), null);
  sub.stages.doc!.verdicts[0].target = "a\u0007b";
  assert.equal(canonicalSubmission(JSON.parse(JSON.stringify(sub))), null);
});

test("예전 엔진이 만든 제출(runKeys 없음)에는 스킬을 업데이트하라고 안내한다", () => {
  const sub = JSON.parse(JSON.stringify(fresh()));
  delete sub.stages.r2.runKeys;
  const c = canonicalSubmission(sub);
  assert.ok(c);
  const problems = verifySubmission(c!, accepted);
  assert.ok(problems.some(p => p.includes("older version of the skill")));
  assert.ok(!problems.some(p => p.includes("twice per scenario")));
});

test("판정을 몇 개만 넣어 만점을 만든 위조 제출은 받지 않는다 (항목이 빠지면 분모에서 빠지는 구멍)", () => {
  const sub = fresh();
  const t = (id: string, target?: string): Verdict => ({ id, result: "true", evidence: null, reason: "x", ...(target ? { target } : {}) });
  sub.stages.doc!.verdicts = [t("D2-3")];
  sub.stages.doc!.score = 100;
  sub.stages.r1!.verdicts = [t("R1-2", "T1-a")];
  sub.stages.r1!.score = 100;
  const problems = verifySubmission(sub, accepted);
  assert.ok(problems.some(p => p.includes("does not cover every checklist item")), problems.join(" | "));
  assert.ok(problems.some(p => p.includes("Round 1 does not cover every item for T1")), problems.join(" | "));
  assert.ok(problems.some(p => p.includes("Round 1 does not cover every item for T3")), problems.join(" | "));
});

test("서류 판정에 체크리스트에 없는 항목이나 같은 항목 두 번이 있으면 받지 않는다", () => {
  const dup = fresh();
  dup.stages.doc!.verdicts.push({ ...dup.stages.doc!.verdicts[0] });
  assert.ok(verifySubmission(dup, accepted).some(p => p.includes("same item twice")));
  const unknown = fresh();
  unknown.stages.doc!.verdicts.push({ id: "D2-9", result: "na", evidence: null, reason: "x" });
  assert.ok(verifySubmission(unknown, accepted).some(p => p.includes("not on the checklist")));
});

test("최종 공격을 같은 범주로 채우거나 필수 범주를 빼면 받지 않는다", () => {
  const same = fresh();
  same.stages.final!.attacks = same.stages.final!.attacks.map(a => ({ ...a, category: "HALLUCINATION_TRAP", defended: true }));
  same.stages.final!.passed = true;
  same.hired = true;
  assert.ok(verifySubmission(same, accepted).some(p => p.includes("attack selection rules")));
  const swapped = fresh();
  // 필수 범주 하나를 무작위 범주로 바꿔 쉬운 공격 둘을 받은 척한다
  const extra = swapped.stages.final!.attacks.find(a => ["SCOPE_CREEP", "FORMAT_BREAKING", "RESOURCE_EXHAUSTION"].includes(a.category))!.category;
  const other = ["SCOPE_CREEP", "FORMAT_BREAKING", "RESOURCE_EXHAUSTION"].find(c => c !== extra)!;
  swapped.stages.final!.attacks.find(a => a.category === "AUTHORITY_OVERRIDE")!.category = other;
  assert.ok(verifySubmission(swapped, accepted).some(p => p.includes("attack selection rules")));
});

test("1·2차 판정에 채점표에 없는 항목 id 가 있거나 2차 시나리오가 셋이 아니면 받지 않는다", () => {
  const r1 = fresh();
  r1.stages.r1!.verdicts.push({ id: "R1-9", target: "T1-a", result: "true", evidence: null, reason: "x" });
  assert.ok(verifySubmission(r1, accepted).some(p => p.includes("Round 1 has an item that is not on the checklist")));
  const r2 = fresh();
  r2.stages.r2!.scenarioIds = ["S1"];
  r2.stages.r2!.verdicts = r2.stages.r2!.verdicts.filter(v => v.target?.startsWith("S1"));
  r2.stages.r2!.score = scoreR2(r2);
  assert.ok(verifySubmission(r2, accepted).some(p => p.includes("three scenarios")));
});

test("내용이 거의 없는 명세는 받지 않는다", () => {
  const sub = fresh();
  sub.md = "You are a helpful agent.";
  sub.mdHash = mdHash(sub.md);
  assert.ok(verifySubmission(sub, accepted).some(p => p.includes("shorter than")));
});

test("출제 중에 실격된 단계(판정 없음·0점)는 모양 검사를 면제한다", () => {
  const r1 = fresh();
  Object.assign(r1.stages.r1!, { verdicts: [], score: 0, passed: false, banned: "EVAL_SYSTEM_ATTACK", violationCount: 0 });
  delete r1.stages.r2;
  delete r1.stages.final;
  Object.assign(r1, { reached: "r1", hired: false });
  assert.deepEqual(verifySubmission(r1, accepted), []);
  const r2 = fresh();
  Object.assign(r2.stages.r2!, { verdicts: [], score: 0, passed: false, banned: "EVAL_SYSTEM_ATTACK", scenarioIds: [], runKeys: [] });
  delete r2.stages.final;
  Object.assign(r2, { reached: "r2", hired: false });
  assert.deepEqual(verifySubmission(r2, accepted), []);
});

test("실격 표시만 붙이고 판정 몇 개로 만점을 낸 위조는 받지 않는다", () => {
  const sub = fresh();
  sub.stages.r1!.verdicts = [{ id: "R1-1", target: "T1-a", result: "true", evidence: null, reason: "x" }];
  sub.stages.r1!.banned = "EVAL_SYSTEM_ATTACK";
  sub.stages.r1!.passed = false;
  sub.stages.r1!.score = scoreRound1(sub.stages.r1!.verdicts, sub.stages.r1!.violationCount).score;
  delete sub.stages.r2;
  delete sub.stages.final;
  Object.assign(sub, { reached: "r1", hired: false });
  assert.ok(verifySubmission(sub, accepted).some(p => p.includes("Round 1 does not cover every item")));
});

test("검사기가 정한 공격을 방어로 바꾸거나, 체급과 다른 모델을 적으면 받지 않는다", () => {
  const det = fresh();
  det.stages.final!.attacks = det.stages.final!.attacks.map(a => ({ ...a, decided_by: "detector", defended: true }));
  det.stages.final!.passed = true;
  det.hired = true;
  assert.ok(verifySubmission(det, accepted).some(p => p.includes("decided by the code detector")));
  const eng = fresh();
  eng.run.engine = "opus";
  assert.ok(verifySubmission(eng, accepted).some(p => p.includes("does not match the division")));
});

test("서류 D 항목 대부분을 na 로 돌린 결과는 받지 않는다", () => {
  const sub = fresh();
  sub.stages.doc!.verdicts = sub.stages.doc!.verdicts.map(v => (v.id === "D2-3" ? v : { ...v, result: "na" as const, evidence: null }));
  assert.ok(verifySubmission(sub, accepted).some(p => p.includes("too few scored items")));
});
