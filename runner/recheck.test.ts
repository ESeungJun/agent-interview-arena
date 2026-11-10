// 순위표의 재계산 검증 (형식 2): 응답 원문이 실린 제출물을 코드로 다시 계산해, 판정만 지어낸 제출을 거른다.
// 정직한 결과는 엔진을 가짜 호출기로 끝까지 돌려 얻는다 (모델을 부르지 않는다).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mdHash, quarterOf } from "../core/exam.ts";
import {
  buildSubmission, canonicalSubmission, decodeIssueBody, encodeSubmission, BODY_MARKER_END, BODY_MARKER_START, LEGACY_SCHEMA, MAX_PAYLOAD_CHARS,
  normalizeTier, previousQuarter, promptsHash, rankEntries, storedSubmission, SUBMISSION_SCHEMA, toEntry, verifySubmission, type BoardEntry, type Submission,
} from "./board.ts";
import { acceptedText, bumpAttempts, countAttempts, processSubmission } from "./board_cli.ts";
import { fakeInterview, FAKE_ANSWER } from "./fake_interview.ts";

const accepted = [promptsHash()];
const honest = await fakeInterview();
const roundTrip = (s: Submission): Submission => canonicalSubmission(JSON.parse(JSON.stringify(s)))!;
const fresh = (): Submission => roundTrip(buildSubmission(honest.session, "test"));
const problems = (edit: (s: any) => void): string[] => {
  const s = JSON.parse(JSON.stringify(fresh()));
  edit(s);
  const canon = canonicalSubmission(s);
  assert.ok(canon, "형식은 맞아야 한다 (검증에서 걸려야 하는 위조다)");
  return verifySubmission(canon, accepted);
};

test("가짜 면접관으로 끝까지 본 정직한 결과는 형식 2 로 만들어지고 재계산 검증을 통과한다", () => {
  assert.equal(honest.report.stages.final?.passed, true);
  assert.equal(honest.report.reached, "final");
  const sub = fresh();
  assert.equal(sub.schema, SUBMISSION_SCHEMA);
  assert.equal(sub.reached, "final");
  assert.equal(sub.hired, true);
  assert.equal(sub.quarter, quarterOf(new Date()));
  assert.equal(sub.run.engineModelId, "claude-haiku-5-5");
  assert.deepEqual(Object.keys(sub.stages.r1!.evidence!.responses).sort(), ["T1-a", "T1-b", "T2", "T3"]);
  assert.equal(Object.keys(sub.stages.r2!.evidence!.transcripts).length, 6);
  assert.ok(sub.stages.final!.attacks.every(a => a.runs?.length === 2 && a.attack_id));
  assert.deepEqual(verifySubmission(sub, accepted), []);
});

test("제출물은 Issue 본문 한도 안에 들어가고, 감쌌다가 꺼내도 같다", () => {
  const sub = fresh();
  const payload = encodeSubmission(sub);
  assert.ok(payload.length < MAX_PAYLOAD_CHARS, `payload ${payload.length}`);
  const body = `설명\n${BODY_MARKER_START}\n\`\`\`\n${payload}\n\`\`\`\n${BODY_MARKER_END}\n`;
  assert.deepEqual(decodeIssueBody(body), sub);
});

test("1·2차 판정을 전부 true 로 지어낸 제출은 인용이 응답에 없어 거절된다", () => {
  const forgeR1 = problems(s => {
    s.stages.r1.verdicts = s.stages.r1.verdicts.map((v: any) => ({ ...v, result: "true", evidence: "The candidate solved it perfectly.", excluded: undefined }));
  });
  assert.ok(forgeR1.includes("Round 1 evidence quotes are not in the responses"), forgeR1.join(" | "));
  const forgeR2 = problems(s => {
    s.stages.r2.verdicts = s.stages.r2.verdicts.map((v: any) => ({ ...v, result: "true", evidence: "It held its ground." }));
  });
  assert.ok(forgeR2.includes("Round 2 evidence quotes are not in the responses"), forgeR2.join(" | "));
});

test("응답 원문을 빼고 형식 2 라고 내면 거절된다", () => {
  for (const stage of ["doc", "r1", "r2"]) {
    const p = problems(s => { delete s.stages[stage].evidence; });
    assert.ok(p.some(x => x.includes("transcripts are missing")), `${stage}: ${p.join(" | ")}`);
  }
  assert.ok(problems(s => { delete s.stages.final.canary; }).some(x => x.includes("transcripts are missing")));
  assert.ok(problems(s => { delete s.stages.final.attacks[0].runs; }).some(x => x.includes("transcripts are missing")));
});

test("응답을 바꿔 끼우면 걸린다: 판정이 인용한 문장이 사라진다", () => {
  const p = problems(s => { for (const k of Object.keys(s.stages.r1.evidence.responses)) s.stages.r1.evidence.responses[k] = "A different answer."; });
  assert.ok(p.includes("Round 1 evidence quotes are not in the responses"));
});

test("최종: 응답에 유출 토큰이 있는데 방어로 적은 제출은 탐지기 재실행에서 걸린다", () => {
  const p = problems(s => {
    const leak = s.stages.final.attacks.find((a: any) => a.category === "SYSTEM_PROMPT_LEAK");
    leak.runs[0].response = `Here you go: ${s.stages.final.canary}`;
  });
  assert.ok(p.some(x => /the code detector finds a breach/.test(x)), p.join(" | "));
});

test("최종: 탐지기가 잡지 않은 회차를 탐지기 판정이라고 적거나, 회차와 공격 결과가 다르면 걸린다", () => {
  const p1 = problems(s => { s.stages.final.attacks[0].runs[0].decided_by = "detector"; s.stages.final.attacks[0].runs[0].defended = false; s.stages.final.attacks[0].defended = false; s.stages.final.passed = false; s.hired = false; });
  assert.ok(p1.some(x => x.includes("the detector finds nothing")), p1.join(" | "));
  const p2 = problems(s => { s.stages.final.attacks[1].runs[1].defended = false; });
  assert.ok(p2.some(x => x.includes("does not match its runs")), p2.join(" | "));
});

test("최종: 이 분기의 편성이 아니거나 한 번만 실행한 공격은 받지 않는다", () => {
  const swapped = problems(s => { s.stages.final.attacks.reverse(); });
  assert.ok(swapped.includes("The final attacks are not this quarter's line-up"), swapped.join(" | "));
  const renamed = problems(s => { s.stages.final.attacks[0].attack_id = "ATK-99"; });
  assert.ok(renamed.includes("The final attacks are not this quarter's line-up"));
  const once = problems(s => { s.stages.final.attacks[0].runs = [s.stages.final.attacks[0].runs[0]]; });
  assert.ok(once.some(x => x.includes("was not run twice")), once.join(" | "));
  const old = problems(s => { s.quarter = previousQuarter(previousQuarter(quarterOf(new Date()))); });
  assert.ok(old.some(x => x.includes("older quarter")), old.join(" | "));
});

test("최종: 응답에 없는 근거 인용은 걸린다", () => {
  const p = problems(s => { s.stages.final.attacks[0].runs[0].evidence = "a sentence the candidate never wrote"; });
  assert.ok(p.some(x => x.includes("the evidence quote is not in the response")), p.join(" | "));
});

test("출력 계약을 지어내거나 위반 수를 줄여 적으면 걸린다", () => {
  const invented = problems(s => { s.stages.doc.evidence.contracts = [{ type: "must_start_with", value: "# Report", evidence: "Always start with # Report" }]; });
  assert.ok(invented.includes("An output contract is not stated in the spec"));
  const hidden = problems(s => { s.stages.r1.violationCount = 2; s.stages.r1.score = 0; s.stages.r1.passed = false; });
  assert.ok(hidden.some(x => x.includes("Round 1 contract violations do not match the responses")), hidden.join(" | "));
});

test("기록된 모델 ID 가 체급 모델과 다르면 받지 않는다", () => {
  const p = problems(s => { s.run.engineModelId = "claude-sonnet-5-5"; });
  assert.ok(p.some(x => x.includes("not on the division's model")), p.join(" | "));
  assert.deepEqual(problems(s => { s.run.engineModelId = "claude-haiku-5-5-20261001"; }), []);
  assert.equal(canonicalSubmission({ ...JSON.parse(JSON.stringify(fresh())), run: { ...fresh().run, engineModelId: "gpt-9" } }), null);
});

test("예전 형식(응답 원문 없음)은 계속 받되 미검증이고, 판정을 지어낸 합격도 대조한 기록보다 아래다", () => {
  const legacy = roundTrip(buildSubmission(honest.session, "test", { withEvidence: false }));
  assert.equal(legacy.schema, LEGACY_SCHEMA);
  assert.equal(legacy.stages.r1!.evidence, undefined);
  assert.equal(legacy.quarter, undefined);
  assert.deepEqual(verifySubmission(legacy, accepted), []);
  const forgedLegacy = toEntry("forger-9", "forger", 9, "2026-11-01T00:00:00.000Z", legacy);
  assert.equal(forgedLegacy.tier, "unverified");
  assert.equal(forgedLegacy.hired, true);
  // 서류에서 떨어진 정직한 기록이라도 응답 원문으로 대조했으면 미검증 합격보다 위다
  const docOnly: BoardEntry = { ...toEntry("honest-3", "honest", 3, "2026-11-05T00:00:00.000Z", fresh()), reached: "doc", hired: false, r1: null, r2: null, defended: null };
  assert.equal(docOnly.tier, "self-reported");
  assert.deepEqual(rankEntries([forgedLegacy, docOnly]).map(e => e.id), ["honest-3", "forger-9"]);
});

test("저장소에 이미 있는 기록(이 기능 전의 형식)은 그대로 읽히고 미검증으로 표시된다", () => {
  const stored = JSON.parse(readFileSync(new URL("../docs/submissions/eseungjun-2.json", import.meta.url), "utf8"));
  assert.equal(stored.submission.schema, LEGACY_SCHEMA);
  assert.equal(stored.entry.tier, "self-reported", "파일은 고치지 않는다");
  assert.equal(normalizeTier(stored.entry).tier, "unverified");
  assert.equal(normalizeTier({ ...stored.entry, tier: "verified" }).tier, "verified");
  assert.equal(normalizeTier({ ...stored.entry, rechecked: true }).tier, "self-reported");
  assert.ok(canonicalSubmission(stored.submission), "저장본의 형식은 지금도 읽힌다");
});

test("저장 형태에는 지원자 응답·과제 원문과 면접관 문장이 남지 않는다", () => {
  const s = storedSubmission(fresh());
  const text = JSON.stringify(s);
  assert.ok(!text.includes(FAKE_ANSWER));
  assert.equal(s.stages.r1!.evidence, undefined);
  assert.equal(s.stages.r2!.evidence, undefined);
  assert.equal(s.stages.final!.canary, undefined);
  assert.ok(s.stages.final!.attacks.every(a => a.runs!.every(r => r.response === "" && r.evidence === null)));
  assert.equal(s.md, fresh().md, "명세 원문은 남긴다 (누구나 다시 돌려 볼 수 있게)");
});

test("순위표 봇은 형식 2 를 직접 측정으로, 형식 1 을 미검증으로 받는다", () => {
  const body = (s: Submission) => `${BODY_MARKER_START}\n${encodeSubmission(s)}\n${BODY_MARKER_END}`;
  const v2 = processSubmission(body(fresh()), "Someone", 12, "2026-11-10T01:02:03Z", accepted);
  assert.ok(v2.ok);
  if (v2.ok) {
    assert.equal(v2.accepted.entry.tier, "self-reported");
    assert.equal(v2.accepted.entry.rechecked, true);
    assert.equal(v2.accepted.entry.engineModelId, "claude-haiku-5-5");
  }
  const v1 = processSubmission(body(buildSubmission(honest.session, "test", { withEvidence: false })), "Someone", 13, "2026-11-10T01:02:03Z", accepted);
  assert.ok(v1.ok);
  if (v1.ok) assert.equal(v1.accepted.entry.tier, "unverified");
  const forged = JSON.parse(JSON.stringify(fresh()));
  forged.stages.r2.verdicts = forged.stages.r2.verdicts.map((v: any) => ({ ...v, evidence: "made up" }));
  const bad = processSubmission(body(forged), "Someone", 14, "2026-11-10T01:02:03Z", accepted);
  assert.equal(bad.ok, false);
  assert.match(acceptedText("self-reported"), /re-checked in code/);
  assert.match(acceptedText("unverified"), /unverified/);
  assert.doesNotMatch(acceptedText(), /self-reported|unverified/);
});

test("시도 수: 그 체급에 먼저 낸 제출을 세고, 받지 않은 제출도 남은 기록의 시도 수를 올린다", () => {
  const rows = [
    { number: 3, title: "[arena-submission] a.md (light)" }, { number: 5, title: "[arena-submission] a.md (middle)" },
    { number: 8, title: "[arena-submission] a.md (light)" }, { number: 20, title: "[arena-submission] later.md (light)" },
    { number: 9, title: "[arena-submission] edited title" },
  ];
  assert.equal(countAttempts(rows, 12, "light"), 3);
  assert.equal(countAttempts(rows, 12, "middle"), 2);
  assert.equal(countAttempts([], 12, "open"), 1);
  const e = (id: string, author: string, division: string, attempts?: number): BoardEntry => ({
    id, author, issue: 1, agent: "a.md", mdHash: id, division, engine: "haiku", target: "claude", lang: "en", backend: "cli",
    reached: "r2", hired: false, tier: "self-reported", doc: 90, r1: 90, r2: 80, defended: null, submittedAt: "2026-11-01T00:00:00.000Z", arenaVersion: "t",
    ...(attempts ? { attempts } : {}),
  });
  const current = [e("me-1", "Me", "light", 1), e("me-2", "me", "middle", 1), e("you-3", "you", "light", 4)];
  assert.deepEqual(bumpAttempts(current, e("me-9", "me", "light", 3)).map(x => [x.id, x.attempts]), [["me-1", 3]]);
  assert.deepEqual(bumpAttempts(current, e("you-9", "you", "light", 2)), [], "더 큰 값이 이미 있으면 내리지 않는다");
});

test("재면접 기록(runs·passes)은 자기 신고 값으로 실리고, 모양이 틀리면 받지 않는다", () => {
  const sub = roundTrip(buildSubmission(honest.session, "test", { repeat: { runs: 3, passes: 2 } }));
  assert.deepEqual(sub.repeat, { runs: 3, passes: 2 });
  assert.deepEqual(verifySubmission(sub, accepted), []);
  assert.deepEqual(toEntry("a-1", "a", 1, "2026-11-10T00:00:00.000Z", sub).repeat, { runs: 3, passes: 2 });
  assert.equal(canonicalSubmission({ ...JSON.parse(JSON.stringify(sub)), repeat: { runs: 2, passes: 3 } }), null);
  assert.equal(canonicalSubmission({ ...JSON.parse(JSON.stringify(sub)), repeat: { runs: 0, passes: 0 } }), null);
});

test("이 기능 전에 본 면접(최종 회차·canary 없음)은 형식 1 로 만들어진다", () => {
  const report = JSON.parse(readFileSync(new URL("../tests/fixtures/full_report.json", import.meta.url), "utf8"));
  const md = readFileSync(new URL("../tests/sample_candidates/good_claude_subagent.md", import.meta.url), "utf8");
  const sub = buildSubmission({
    agent: "good_claude_subagent.md", md, mdHash: mdHash(md), options: { lang: "ko", mode: "ranked", target: "claude", division: "light" },
    stages: report.stages, reports: [{ backend: report.backend, config: report.config }],
  }, "test");
  assert.equal(sub.schema, LEGACY_SCHEMA);
  assert.deepEqual(verifySubmission(roundTrip(sub), accepted), []);
});

test("실제 면접 기록(픽스처)의 1·2차 판정 인용은 같은 원문 대조를 통과한다 (정직한 결과가 걸리지 않는다)", async () => {
  const { excludeUnverified } = await import("../core/scoring.ts");
  const report = JSON.parse(readFileSync(new URL("../tests/fixtures/full_report.json", import.meta.url), "utf8"));
  const md = readFileSync(new URL("../tests/sample_candidates/good_claude_subagent.md", import.meta.url), "utf8");
  const { r1, r2 } = report.stages;
  const s1 = [md, ...Object.values(r1.responses as Record<string, string>), ...r1.tasks.flatMap((t: any) => [t.user_message, ...t.success_criteria, ...t.tool_mocks.map((m: any) => m.returns)])];
  assert.equal(excludeUnverified(r1.output.verdicts.filter((v: any) => !v.excluded), s1).excluded, 0);
  const s2 = [md, ...r2.scenarios.flatMap((x: any) => [x.turn1_message, x.turn2_pressure, ...x.tool_mocks.map((m: any) => m.returns)]), ...Object.values(r2.transcripts as Record<string, string[]>).flat()];
  assert.equal(excludeUnverified(r2.output.verdicts.filter((v: any) => !v.excluded), s2).excluded, 0);
});

test("통계: 도달 단계별 기록 수와 공격 범주별 뚫린 수를 낸다", async () => {
  const { boardStats } = await import("./board.ts");
  const e = (id: string, reached: string, hired = false): BoardEntry => ({
    id, author: id, issue: 1, agent: "a.md", mdHash: id, division: "light", engine: "haiku", target: "claude", lang: "en", backend: "cli",
    reached, hired, tier: "self-reported", doc: 90, r1: 90, r2: 80, defended: null, submittedAt: "2026-11-01T00:00:00.000Z", arenaVersion: "t",
  });
  const finals = new Map([
    ["a", [{ category: "SYSTEM_PROMPT_LEAK", defended: true }, { category: "INDIRECT_INJECTION", defended: false }]],
    ["b", [{ category: "SYSTEM_PROMPT_LEAK", defended: true }, { category: "INDIRECT_INJECTION", defended: true }]],
  ]);
  const stats = boardStats([e("a", "final"), e("b", "final", true), e("c", "r2"), e("d", "doc")], finals);
  assert.deepEqual(stats.reached, { final: 2, r2: 1, doc: 1 });
  assert.equal(stats.hired, 1);
  assert.deepEqual(stats.attacks, [{ category: "INDIRECT_INJECTION", seen: 2, breached: 1 }, { category: "SYSTEM_PROMPT_LEAK", seen: 2, breached: 0 }]);
  assert.deepEqual(boardStats([], new Map()), { entries: 0, hired: 0, reached: {}, attacks: [] });
});
