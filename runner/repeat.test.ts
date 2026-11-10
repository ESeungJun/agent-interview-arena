// 재면접 묶음의 합격률. 엔진을 가짜 호출기로 여러 판 돌려 얻은 결과로 계산한다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { memoryExamStore } from "../core/exam.ts";
import { fakeInterview, type FakeOptions } from "./fake_interview.ts";
import { repeatStats, type RepeatSession } from "./repeat.ts";

const store = memoryExamStore();
async function run(id: string, group: string | undefined, opts: FakeOptions = {}, target?: number): Promise<RepeatSession & { lineup: string }> {
  const f = await fakeInterview({ ...opts, examStore: store });
  return {
    session: id, mdHash: f.session.mdHash, promptsHash: "p", group, repeatTarget: target, options: f.session.options, stages: f.report.stages,
    lineup: JSON.stringify([f.report.stages.r1?.tasks, f.report.stages.r2?.scenarios, f.report.stages.final?.attacks.map(a => [a.attack_id, a.message])]),
  };
}

test("한 판만 봤고 --repeat 도 없으면 합격률을 내지 않는다", async () => {
  const one = await run("s1", undefined);
  assert.equal(repeatStats(one, [one]), null);
});

test("세 판 중 몇 판 합격했는지와 공격 범주별 방어 횟수를 낸다", async () => {
  const a = await run("s1", "s1", {}, 3);
  // 둘째 판: 최종에서 한 회차가 뚫린다
  let target = "";
  const b = await run("s2", "s1", { defended: r => { target ||= r; return r !== target; } }, 3);
  // 셋째 판: 2차에서 한 회차가 압박에 무너져 탈락한다 (최종을 보지 않는다)
  const c = await run("s3", "s1", { roundResult: (t, id) => (t === "S1-a" && id === "R2-3" ? "false" : "true") }, 3);
  assert.equal(c.stages.final, undefined);
  const stats = repeatStats(c, [a, b, c])!;
  assert.equal(stats.runs, 3);
  assert.equal(stats.passes, 1);
  assert.equal(stats.remaining, 0);
  assert.deepEqual(stats.stages.doc, { seen: 3, passed: 3 });
  assert.deepEqual(stats.stages.r2, { seen: 3, passed: 2 });
  assert.deepEqual(stats.stages.final, { seen: 2, passed: 1 });
  assert.equal(stats.attacks.length, 5);
  assert.equal(stats.attacks.reduce((n, x) => n + x.runs, 0), 20, "두 판 × 공격 5개 × 2회");
  assert.equal(stats.attacks.reduce((n, x) => n + x.held, 0), 19);
  // 같은 명세는 판마다 같은 시험(과제·시나리오·공격 문구)을 받는다
  assert.equal(a.lineup, b.lineup);
});

test("진행 중인 판은 본 판으로 치지 않고, 남은 판 수에서는 뺀다", async () => {
  const a = await run("s1", "s1", {}, 3);
  const b = { ...(await run("s2", "s1", {}, 3)), stages: { security: a.stages.security, doc: a.stages.doc } };
  const stats = repeatStats(b, [a, b])!;
  assert.equal(stats.runs, 1);
  assert.equal(stats.remaining, 1);
});

test("묶음 ID 가 같아도 명세·설정·프롬프트가 다른 세션은 세지 않는다", async () => {
  const a = await run("s1", "s1", {}, 2);
  const other = { ...(await run("s2", "s1", {}, 2)), mdHash: "another" };
  const quick = { ...(await run("s3", "s1", {}, 2)), options: { ...a.options, mode: "quick" } };
  const stats = repeatStats(a, [a, other, quick])!;
  assert.equal(stats.runs, 1);
  assert.equal(stats.remaining, 1);
});
