// 대기실 패널(plugins/arena-room)의 순수 부분. 패널 전체 테스트(tests/room.test.tsx)는 mods 지원 Claude Code 가 있어야 돌므로
// (npm run test:room), 기록 파일을 방 상태로 바꾸는 부분만 여기서 node --test 로 돌린다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { reduceRoom } from "../plugins/arena-room/hooks/room.ts";

const line = (e: Record<string, unknown>) => JSON.stringify({ ts: "2026-11-03T08:50:00.000Z", session: "2026-11-03-aaaa1111", agent: "reviewer.md", ...e });

test("대기실: 마지막 세션의 기록이 방 상태가 된다", () => {
  const room = reduceRoom([
    line({ event: "stage_start", stage: "doc", mode: "quick" }),
    line({ event: "log", stage: "doc", message: "anything" }),
    line({ event: "stage_end", stage: "doc", passed: true, score: 95, banned: false }),
    line({ event: "stage_start", stage: "r1", mode: "quick" }),
    '{"broken json',
  ].join("\n"), "en");
  assert.equal(room?.agent, "reviewer.md");
  assert.equal(room?.mode, "quick");
  assert.equal(room?.current, "r1");
  assert.equal(room?.results.doc?.score, 95);
  assert.equal(room?.results.security?.passed, true);
  assert.equal(room?.finished, false);
});

test("대기실: 가장 새 세션만 보고 종료를 읽는다", () => {
  const older = line({ event: "stage_end", stage: "doc", passed: false, score: 10, banned: false });
  const newer = [
    JSON.stringify({ ts: "2026-11-03T09:00:00.000Z", event: "stage_end", session: "2026-11-03-bbbb2222", agent: "b.md", stage: "final", passed: true, score: null, banned: false }),
    JSON.stringify({ ts: "2026-11-03T09:00:00.000Z", event: "session_end", session: "2026-11-03-bbbb2222", agent: "b.md", hired: true }),
  ].join("\n");
  const room = reduceRoom(`${older}\n${newer}`, "ko");
  assert.equal(room?.session, "2026-11-03-bbbb2222");
  assert.equal(room?.results.doc, undefined);
  assert.equal(room?.finished, true);
  assert.equal(room?.hired, true);
  assert.equal(room?.lang, "ko");
});

test("대기실: 빈 기록에는 방이 없다", () => {
  assert.equal(reduceRoom("", "en"), null);
});

test("대기실: 기록의 제어 문자는 화면에 나가지 않고, 세션 ID 형식이 아니면 받지 않는다", () => {
  const room = reduceRoom(line({ event: "error", agent: "x\u001b]52;c;Zm9v\u0007.md", message: "bad\u001b[2J" }), "en");
  assert.equal(room?.agent, "x]52;c;Zm9v.md");
  assert.equal(room?.error, "bad[2J");
  assert.equal(reduceRoom(JSON.stringify({ event: "stage_start", session: "../../etc", stage: "doc" }), "en"), null);
});
