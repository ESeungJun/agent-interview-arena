// CLI 백엔드: 시간 제한·재시도·모델 ID. 진짜 claude 대신 가짜 실행 파일을 쓴다 (모델을 부르지 않는다).
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MODEL_IDS } from "../core/engine.ts";
import { answeringModel, CLI_TIMEOUT_MS, runClaude, timeoutMs } from "./cli_engine.ts";

/** 실행할 때마다 자기 pid 와 인자를 남기는 가짜 claude (sh 스크립트). body 는 그 뒤에 할 일이고, $calls 는 지금까지의 호출 수다 */
function fakeClaude(body: string): { command: string; calls: () => number; pids: () => number[]; argsFile: string } {
  const dir = mkdtempSync(join(tmpdir(), "arena-fake-"));
  const log = join(dir, "calls.log");
  const argsFile = join(dir, "args.txt");
  const command = join(dir, "claude");
  writeFileSync(command, `#!/bin/sh
echo $$ >> '${log}'
printf '%s\\n' "$@" > '${argsFile}'
calls=$(wc -l < '${log}' | tr -d ' ')
${body}
`);
  chmodSync(command, 0o755);
  const pids = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map(Number) : []);
  return { command, calls: () => pids().length, pids, argsFile };
}
/** exec 로 바꿔 끼워, 기록한 pid 가 곧 멈춰 있는 프로세스가 되게 한다 */
const HANG = "exec sleep 600";
const say = (json: unknown) => `printf '%s' '${JSON.stringify(json)}'`;

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test("멈춘 claude 호출은 시간 제한에 끊고 다시 부르며, 프로세스를 남기지 않는다", async () => {
  const fake = fakeClaude(HANG);
  const logs: string[] = [];
  const started = Date.now();
  await assert.rejects(runClaude(["-p"], "hi", { command: fake.command, timeoutMs: 1000, log: m => logs.push(m) }), /끝나지 않아 중단함/);
  // 세 번 부른다: 다시 시도 로그 두 번 뒤 실패. (스크립트가 pid 를 적기 전에 끊길 수 있어 호출 수는 로그로 센다)
  assert.equal(logs.filter(l => l.includes("다시 시도")).length, 2);
  assert.ok(fake.calls() >= 1 && fake.calls() <= 3);
  assert.ok(Date.now() - started < 20_000);
  assert.deepEqual(fake.pids().filter(alive), [], "끊은 프로세스가 남아 있으면 안 된다");
});

test("종료 신호를 무시하는 호출도 강제로 끝낸다", async () => {
  const fake = fakeClaude("trap '' TERM\nwhile :; do sleep 1; done");
  await assert.rejects(runClaude(["-p"], "hi", { command: fake.command, timeoutMs: 1000, killGraceMs: 200, log: () => {} }), /끝나지 않아 중단함/);
  assert.deepEqual(fake.pids().filter(alive), []);
});

test("한 번 멈춘 뒤 다음 시도가 답하면 그 답을 쓴다", async () => {
  const fake = fakeClaude(`if [ "$calls" = 1 ]; then ${HANG}; fi\n${say({ result: "ok", session_id: "s" })}`);
  const out = await runClaude(["-p"], "hi", { command: fake.command, timeoutMs: 1500, log: () => {} });
  assert.equal(out.result, "ok");
  assert.ok(fake.calls() >= 2);
});

test("깨진 출력과 오류 응답은 다시 부른 뒤 실패한다", async () => {
  const broken = fakeClaude("printf 'not json'\nexit 1");
  await assert.rejects(runClaude(["-p"], "hi", { command: broken.command, timeoutMs: 5000, log: () => {} }), /claude -p 실패: exit 1/);
  assert.equal(broken.calls(), 3);
  const isError = fakeClaude(say({ is_error: true, result: "rate limited" }));
  await assert.rejects(runClaude(["-p"], "hi", { command: isError.command, timeoutMs: 5000, log: () => {} }), /rate limited/);
});

test("실행 파일이 없으면 다시 부르지 않고 바로 실패한다", async () => {
  await assert.rejects(runClaude(["-p"], "hi", { command: join(tmpdir(), "arena-no-such-claude"), timeoutMs: 5000, log: () => {} }), /ENOENT/);
});

test("기본 시간 제한은 스킬의 단계 제한(600초)보다 짧다", () => {
  assert.ok(CLI_TIMEOUT_MS < 600_000 / 2);
});

test("CLI 호출은 별칭이 아니라 고정 모델 ID 를 넘긴다", async () => {
  const fake = fakeClaude(say({ result: "hello", session_id: "s", modelUsage: { "claude-sonnet-5-5": { outputTokens: 12 }, "claude-haiku-5-5": { outputTokens: 3 } } }));
  const dir = join(fake.command, "..");
  const before = process.env.PATH;
  process.env.PATH = `${dir}:${before}`;
  try {
    const { cliLlm } = await import("./cli_engine.ts");
    const r = await cliLlm.converse({ role: "candidate", model: "sonnet", system: "sys", userTurns: ["hi"] });
    const args = readFileSync(fake.argsFile, "utf8").split("\n");
    assert.equal(args[args.indexOf("--model") + 1], MODEL_IDS.sonnet);
    assert.deepEqual(r.modelIds, ["claude-sonnet-5-5"]);
    assert.equal(r.turns[0].text, "hello");
  } finally {
    process.env.PATH = before;
  }
});

test("답한 모델은 출력 토큰이 가장 많은 모델 ID 이고, 모양이 다르면 기록하지 않는다", () => {
  assert.equal(answeringModel({ modelUsage: { "claude-haiku-5-5": { outputTokens: 5 }, "claude-opus-5-5": { outputTokens: 900 } } }), "claude-opus-5-5");
  assert.equal(answeringModel({ modelUsage: { "us.anthropic.claude-sonnet-5-5-v1:0": { outputTokens: 5 } } }), undefined);
  assert.equal(answeringModel({ modelUsage: { "claude-sonnet-5-5[1m]": { outputTokens: 5 } } }), undefined);
  assert.equal(answeringModel({}), undefined);
  assert.equal(answeringModel({ modelUsage: "x" as never }), undefined);
});

test("환경변수로 준 시간 제한은 상한으로 자르고, 이상한 값은 기본값을 쓴다", () => {
  assert.equal(timeoutMs("60000"), 60_000);
  assert.equal(timeoutMs("3000000000"), 30 * 60_000, "타이머 한도를 넘는 값이 1ms 로 바뀌지 않게");
  for (const bad of [undefined, "", "abc", "10", "-5"]) assert.equal(timeoutMs(bad), CLI_TIMEOUT_MS);
});
