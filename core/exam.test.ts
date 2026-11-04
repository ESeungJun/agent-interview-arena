import { test } from "node:test";
import assert from "node:assert/strict";
import { attackSeedOf, mdHash, memoryExamStore, openExam, quarterOf } from "./exam.ts";

const oct = new Date(2026, 9, 15);

test("분기 계산", () => {
  assert.equal(quarterOf(new Date(2026, 0, 1)), "2026-Q1");
  assert.equal(quarterOf(new Date(2026, 2, 31)), "2026-Q1");
  assert.equal(quarterOf(oct), "2026-Q4");
  // 한국 시간으로 4월 1일 0시 = UTC 3월 31일 15시. 서버가 UTC 여도 2분기다
  assert.equal(quarterOf(new Date("2026-03-31T15:00:00Z")), "2026-Q2");
  assert.equal(quarterOf(new Date("2026-03-31T14:59:59Z")), "2026-Q1");
});

test("같은 분기·같은 .md는 저장된 과제와 같은 공격 시드를 받는다", async () => {
  const store = memoryExamStore();
  const first = await openExam("agent", { date: oct, store });
  await first.set("tasks", [{ id: "T1" }]);
  const again = await openExam("agent", { date: new Date(2026, 11, 31), store });
  assert.deepEqual(again.get("tasks"), [{ id: "T1" }]);
  assert.equal(again.attackSeed, first.attackSeed);
});

test("분기가 바뀌거나 .md가 바뀌면 새 시험이다", async () => {
  const store = memoryExamStore();
  const first = await openExam("agent", { date: oct, store });
  await first.set("tasks", [{ id: "T1" }]);
  const nextQuarter = await openExam("agent", { date: new Date(2027, 0, 1), store });
  assert.equal(nextQuarter.get("tasks"), undefined);
  assert.notEqual(nextQuarter.attackSeed, first.attackSeed);
  assert.equal((await openExam("agent v2", { date: oct, store })).get("tasks"), undefined);
});

test("fresh는 저장된 시험을 읽지도 쓰지도 않는다", async () => {
  const store = memoryExamStore();
  await (await openExam("agent", { date: oct, store })).set("tasks", [{ id: "T1" }]);
  const fresh = await openExam("agent", { date: oct, store, fresh: true });
  assert.equal(fresh.get("tasks"), undefined);
  await fresh.set("tasks", [{ id: "X" }]);
  assert.deepEqual((await openExam("agent", { date: oct, store })).get("tasks"), [{ id: "T1" }]);
});

test("공백만 다른 .md는 같은 문서로 본다 (공백 수정으로 시험 다시 뽑기 차단)", () => {
  const base = "# 리뷰어\n규칙: 근거를 인용한다.\n\n## 출력\nJSON";
  assert.equal(mdHash(base), mdHash("# 리뷰어  \r\n규칙:   근거를 인용한다.\n\n\n\n## 출력\nJSON\n\n"));
  assert.notEqual(mdHash(base), mdHash(base.replace("인용한다", "인용 한다")));
});

test("공격 시드는 서버 비밀값에 따라 달라진다", () => {
  assert.notEqual(attackSeedOf("2026-Q4", "abc", "secret-a"), attackSeedOf("2026-Q4", "abc", "secret-b"));
  assert.equal(attackSeedOf("2026-Q4", "abc", "secret-a"), attackSeedOf("2026-Q4", "abc", "secret-a"));
});
