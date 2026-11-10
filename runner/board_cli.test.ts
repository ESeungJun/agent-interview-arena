import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mdHash } from "../core/exam.ts";
import { BODY_MARKER_END, BODY_MARKER_START, buildSubmission, encodeSubmission, promptsHash } from "./board.ts";
import { ACCEPTED_LABEL, countEarlier, GIVE_UP_MS, LABEL, planWrite, processSubmission, REJECTED_LABEL, replaces, triage } from "./board_cli.ts";
import type { BoardEntry } from "./board.ts";

const report = JSON.parse(readFileSync(new URL("../tests/fixtures/full_report.json", import.meta.url), "utf8"));
const md = readFileSync(new URL("../tests/sample_candidates/good_claude_subagent.md", import.meta.url), "utf8");
const sub = buildSubmission({
  agent: "good_claude_subagent.md", md, mdHash: mdHash(md),
  options: { lang: "en", mode: "ranked", target: "claude", division: "light" },
  stages: report.stages, reports: [{ backend: report.backend, config: report.config }],
}, "test");
const body = (s = sub) => `${BODY_MARKER_START}\n${encodeSubmission(s)}\n${BODY_MARKER_END}`;

test("통과한 제출의 순위 시각은 제출자가 적은 값이 아니라 Issue 생성 시각이다", () => {
  const forged = { ...sub, createdAt: "1970-01-01T00:00:00.000Z" };
  const r = processSubmission(body(forged), "Someone", 12, "2026-11-04T01:02:03Z", [promptsHash()]);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.accepted.entry.submittedAt, "2026-11-04T01:02:03.000Z");
  assert.equal(r.accepted.id, "someone-12");
  assert.equal(r.accepted.entry.mdHash, sub.mdHash);
  assert.ok(r.accepted.stored.stages.doc!.verdicts.every(v => v.reason === ""));
});

test("작성자·Issue 번호·시각 형식이 틀리면 거절한다", () => {
  for (const [author, issue, at] of [["../x", 1, "2026-11-04T00:00:00Z"], ["ok", 0, "2026-11-04T00:00:00Z"], ["ok", 3, "어제"]] as const) {
    assert.equal(processSubmission(body(), author, issue, at, [promptsHash()]).ok, false);
  }
});

test("검증 중 예상 못 한 예외가 나도 일시 오류가 아니라 거절로 끝난다", () => {
  const broken = JSON.parse(JSON.stringify(sub));
  broken.stages.doc.verdicts = [{ id: "D1-1", result: "true", evidence: null, reason: "x" }];
  const r = processSubmission(body(broken), "someone", 3, "2026-11-04T00:00:00Z", [promptsHash()]);
  assert.equal(r.ok, false);
});

test("이미 저장된 제출은 답글만, 거절 뒤 다시 연 것은 말없이 닫고, 오래 남은 오류 건은 정리한다", () => {
  const now = Date.parse("2026-11-04T12:00:00Z");
  const base = { number: 7, title: "[arena-submission] a.md (light)", author: "Someone", createdAt: "2026-11-04T11:00:00Z", labels: [] as string[] };
  assert.equal(triage(base, now, new Set(["someone-7"])), "finish");
  assert.equal(triage({ ...base, labels: [LABEL, REJECTED_LABEL] }, now, new Set()), "reclose");
  assert.equal(triage({ ...base, labels: [LABEL], createdAt: new Date(now - GIVE_UP_MS - 1).toISOString() }, now, new Set()), "expire");
  // 아직 처리를 시작하지 않은(라벨 없는) 대기 건은 오래돼도 정리하지 않는다
  assert.equal(triage({ ...base, createdAt: new Date(now - GIVE_UP_MS - 1).toISOString() }, now, new Set()), null);
  assert.equal(triage(base, now, new Set()), null);
});

test("한 사람은 체급마다 최고 기록 하나만: 더 나은 기록만 받고, 예전 파일은 밀어낸다", () => {
  const e = (id: string, author: string, division: string, r2: number, at: string): BoardEntry => ({
    id, author, issue: 1, agent: "a.md", mdHash: id, division, engine: "haiku", target: "claude", lang: "en", backend: "cli",
    reached: "r2", hired: false, tier: "self-reported", doc: 90, r1: 90, r2, defended: null, submittedAt: at, arenaVersion: "t",
  });
  const old = e("me-1", "Me", "light", 80, "2026-11-01T00:00:00.000Z");
  const others = [old, e("you-2", "you", "light", 99, "2026-11-01T00:00:00.000Z"), e("me-3", "me", "middle", 50, "2026-11-01T00:00:00.000Z")];
  assert.deepEqual(replaces(e("me-9", "me", "light", 81, "2026-11-04T00:00:00.000Z"), others), ["me-1"]);
  assert.equal(replaces(e("me-9", "me", "light", 80, "2026-11-04T00:00:00.000Z"), others), null, "같은 점수면 먼저 낸 쪽이 남는다");
  assert.equal(replaces(e("me-9", "me", "light", 70, "2026-11-04T00:00:00.000Z"), others), null);
  assert.deepEqual(replaces(e("me-9", "me", "open", 10, "2026-11-04T00:00:00.000Z"), others), []);
});

const entry = (id: string, author: string, r2: number, at: string, tier: BoardEntry["tier"] = "self-reported", division = "light"): BoardEntry => ({
  id, author, issue: 1, agent: "a.md", mdHash: id, division, engine: "haiku", target: "claude", lang: "en", backend: "cli",
  reached: "r2", hired: false, tier, doc: 90, r1: 90, r2, defended: null, submittedAt: at, arenaVersion: "t",
});

test("접수 표시가 붙은 제출은 파일이 없어도(밀려난 제출) 다시 검증하지 않고 답글만 마저 단다", () => {
  const now = Date.parse("2026-11-04T12:00:00Z");
  const i = { number: 8, title: "[arena-submission] a.md (light)", author: "me", createdAt: "2026-11-04T11:00:00Z", labels: [LABEL, ACCEPTED_LABEL] };
  assert.equal(triage(i, now, new Set()), "finish");
});

test("재검증 기록이 있어도 같은 체급에 새 직접 측정 기록을 낼 수 있다 (등급마다 따로 비교)", () => {
  const verified = entry("me-1", "me", 99, "2026-11-01T00:00:00.000Z", "verified");
  const oldSelf = entry("me-2", "me", 50, "2026-11-01T00:00:00.000Z");
  assert.deepEqual(replaces(entry("me-9", "me", 60, "2026-11-04T00:00:00.000Z"), [verified, oldSelf]), ["me-2"]);
  assert.deepEqual(replaces(entry("me-9", "me", 10, "2026-11-04T00:00:00.000Z"), [verified]), []);
});

test("push 직전 최신 main 기준으로 다시 맞춘다: 밀어낼 파일, 같은 실행에서 밀려난 것, 받지 않을 것", () => {
  const a = (id: string, author: string, r2: number) => ({ a: { id, entry: entry(id, author, r2, "2026-11-04T00:00:00.000Z"), stored: {} as never } });
  const current = [entry("me-1", "me", 70, "2026-11-01T00:00:00.000Z"), entry("you-1", "you", 90, "2026-11-01T00:00:00.000Z")];
  const first = a("me-5", "me", 80);
  const second = a("me-6", "me", 85);
  const loser = a("you-7", "you", 80);
  const p = planWrite([first, second, loser], current);
  assert.deepEqual(p.write.map(x => x.a.id), ["me-6"]);
  assert.deepEqual(p.remove, ["me-1"], "같은 실행에서 받은 me-5 는 파일이 없으므로 지울 목록에 없다");
  assert.deepEqual(p.superseded.map(x => x.a.id), ["me-5"]);
  assert.deepEqual(p.dropped.map(x => x.a.id), ["you-7"]);
  // 그 사이 main 에 더 좋은 기록이 생겼으면 받지 않는다
  const later = planWrite([second], [...current, entry("me-4", "me", 95, "2026-11-03T00:00:00.000Z")]);
  assert.deepEqual(later.write, []);
  assert.deepEqual(later.dropped.map(x => x.a.id), ["me-6"]);
});

test("지난 시도의 push 가 실제로는 올라갔으면, 같은 제출을 자기 기록과 비교해 거절하지 않고 접수로 끝낸다", () => {
  const a = { a: { id: "me-6", entry: entry("me-6", "me", 85, "2026-11-04T00:00:00.000Z"), stored: {} as never } };
  const p = planWrite([a], [entry("me-6", "me", 85, "2026-11-04T00:00:00.000Z")]);
  assert.deepEqual(p.saved.map(x => x.a.id), ["me-6"]);
  assert.deepEqual([p.write, p.dropped, p.remove], [[], [], []]);
});

test("하루 한도는 이 Issue 보다 먼저 낸, 이 Issue 를 열기 전 24시간 안의 처리된 제출만 센다", () => {
  const now = Date.parse("2026-11-04T12:00:00Z");
  const h = 3600 * 1000;
  const labeled = new Map([[1, now - 30 * h], [2, now - 2 * h], [3, now - h], [9, now]]);
  assert.equal(countEarlier(labeled, 9, now), 2);
  assert.equal(countEarlier(labeled, 3, now - h), 1);
  // 처리가 하루 넘게 밀려도 Issue 를 연 시각으로 세므로, 몰아 연 제출이 한도를 빠져나가지 못한다
  const burst = new Map([[10, now - 40 * h], [11, now - 40 * h], [12, now - 40 * h]]);
  assert.equal(countEarlier(burst, 12, now - 40 * h), 2);
});

// 순위표 워크플로는 npm ci 없이 돈다. 검증 경로가 설치된 패키지를 import 하면 Actions 에서 바로 죽는다
test("순위표 검증 경로(board_cli → board → core)는 node 내장 모듈과 저장소 파일만 import 한다", async () => {
  const { readFileSync } = await import("node:fs");
  const { dirname, resolve } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const seen = new Set<string>();
  const external: string[] = [];
  const walk = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = readFileSync(file, "utf8");
    // 타입만 가져오는 import 는 실행 때 지워진다
    for (const m of src.matchAll(/^\s*(?:import|export)\s+(?!type\s)[^;]*?from\s+["']([^"']+)["']/gm)) {
      const spec = m[1];
      if (spec.startsWith("node:")) continue;
      if (spec.startsWith(".")) walk(resolve(dirname(file), spec));
      else external.push(`${file}: ${spec}`);
    }
  };
  walk(fileURLToPath(new URL("./board_cli.ts", import.meta.url)));
  assert.deepEqual(external, []);
  assert.ok([...seen].some(f => f.endsWith("core/stages.ts")), "재계산 검증이 엔진 코드를 쓴다");
  assert.ok(![...seen].some(f => f.endsWith("core/engine.ts")), "SDK 를 쓰는 engine.ts 는 검증 경로에 없어야 한다");
});
