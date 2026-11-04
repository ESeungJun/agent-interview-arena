// 배포 번들이 실제로 명령을 받는지 확인한다. 번들에 합쳐진 모듈이 진입점처럼 동작해 먼저 종료한 적이 있다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const BUNDLE = fileURLToPath(new URL("../plugins/arena/skills/apply/bin/arena.mjs", import.meta.url));

test("번들 엔진이 version·config·list 에 JSON 으로 답한다", () => {
  const env = { ...process.env, ARENA_HOME: mkdtempSync(join(tmpdir(), "arena-")) };
  const run = (...args: string[]) => JSON.parse(execFileSync(process.execPath, [BUNDLE, ...args], { env, encoding: "utf8" }));
  assert.match(run("version").version, /^\d+\.\d+\.\d+$/);
  assert.equal(run("config").lang, null);
  assert.equal(run("config", "--lang=ko").lang, "ko");
  assert.deepEqual(run("list").sessions, []);
});

test("빈 명세는 모델을 부르기 전에 거절한다", () => {
  const home = mkdtempSync(join(tmpdir(), "arena-"));
  const empty = join(home, "empty.md");
  writeFileSync(empty, "\n  \n");
  let out = "";
  try {
    execFileSync(process.execPath, [BUNDLE, "start", empty], { env: { ...process.env, ARENA_HOME: home }, encoding: "utf8", timeout: 10_000 });
  } catch (e) {
    out = (e as { stdout: string }).stdout;
  }
  assert.equal(JSON.parse(out).error, "too_short");
});
