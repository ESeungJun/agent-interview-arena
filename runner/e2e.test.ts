// 끝에서 끝까지: 엔진 CLI(runner/arena.ts)를 가짜 claude 로 돌려 면접 → 제출물 → 순위표 검증까지 확인한다.
// 모델은 부르지 않는다 (PATH 앞에 가짜 claude 를 둔다). 프로세스를 수십 번 띄우므로 테스트 하나에 여러 확인을 묶는다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { LEGACY_SCHEMA, promptsHash, SUBMISSION_SCHEMA } from "./board.ts";
import { processSubmission } from "./board_cli.ts";
import { FAKE_MD } from "./fake_interview.ts";

const ARENA = fileURLToPath(new URL("./arena.ts", import.meta.url));
const FAKE = fileURLToPath(new URL("./fake_claude.ts", import.meta.url));

test("가짜 claude 로 랭크전을 끝까지 보고, 제출물이 순위표 재계산 검증을 통과하며, 재면접이 합격률로 묶인다", { timeout: 300_000 }, () => {
  const home = mkdtempSync(join(tmpdir(), "arena-e2e-"));
  const bin = join(home, "bin");
  execFileSync("mkdir", ["-p", bin]);
  const spec = join(home, "reviewer.md");
  writeFileSync(spec, FAKE_MD);
  writeFileSync(join(bin, "claude"), `#!/bin/sh\nexec '${process.execPath}' '${FAKE}' "$@"\n`);
  chmodSync(join(bin, "claude"), 0o755);
  // ANTHROPIC_API_KEY 가 있으면 엔진이 API 백엔드를 고르므로 지운다 (가짜 claude 만 쓰게)
  const { ANTHROPIC_API_KEY: _, ...rest } = process.env;
  const env = { ...rest, ARENA_HOME: join(home, "arena"), PATH: `${bin}:${process.env.PATH}`, FAKE_MD: spec };
  const arena = (...args: string[]) => {
    try {
      return JSON.parse(execFileSync(process.execPath, [ARENA, ...args], { env, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 120_000 }));
    } catch (e) {
      return JSON.parse((e as { stdout: string }).stdout);
    }
  };

  // 잘못된 --repeat 는 모델을 부르기 전에 거절한다
  assert.equal(arena("start", "--repeat", "99", "--", spec).error, "bad_repeat");

  // 첫 판: 서류 → 1차 → 2차 → 최종
  let s = arena("start", "--lang", "en", "--mode", "ranked", "--repeat", "2", "--", spec);
  assert.equal(s.error, undefined, JSON.stringify(s));
  assert.equal(s.stage.stage, "doc");
  assert.equal(s.repeat.target, 2);
  const first = s.session;
  while (s.next) s = arena("next", first);
  assert.equal(s.finished, true);
  assert.equal(s.hired, true);
  assert.equal(s.stage.sample.runs, 10);
  assert.equal(s.stage.sample.held, 10);
  assert.ok(s.stage.attacks.every((a: { held: number; runs: number }) => a.held === 2 && a.runs === 2));
  assert.equal(s.submittable, true, JSON.stringify(s.submitProblems));
  assert.deepEqual([s.repeat.runs, s.repeat.passes, s.repeat.remaining], [1, 1, 1]);

  // 기록에 실제로 답한 모델 ID 와 버린 신고 목록이 남는다
  const state = JSON.parse(readFileSync(s.resultFile, "utf8"));
  assert.deepEqual(state.reports.at(-1).models.candidate, ["claude-sonnet-5-5"]);
  assert.deepEqual(state.reports.at(-1).droppedFlags, []);
  assert.equal(state.reports[0].stages.security.screener.classification, "CLEAN", "랭크전은 정규식에 안 걸려도 분류 모델이 본다");

  // 제출물: 형식 2, 순위표 봇의 검증을 통과해 직접 측정으로 오른다
  const submit = arena("submit", first);
  assert.equal(submit.error, undefined, JSON.stringify(submit));
  assert.equal(submit.tier, "self-reported");
  assert.equal(submit.public.responses, true);
  const accepted = processSubmission(readFileSync(submit.bodyFile, "utf8"), "someone", 7, new Date().toISOString(), [promptsHash()]);
  assert.ok(accepted.ok, JSON.stringify(accepted));
  if (accepted.ok) {
    assert.equal(accepted.sub.schema, SUBMISSION_SCHEMA);
    assert.equal(accepted.accepted.entry.tier, "self-reported");
    assert.equal(accepted.accepted.entry.engineModelId, "claude-sonnet-5-5");
    assert.equal(accepted.accepted.entry.defended, 5);
  }
  // --unverified: 응답 원문 없이. 받기는 하되 미검증이다
  const bare = arena("submit", first, "--unverified");
  assert.equal(bare.tier, "unverified");
  assert.equal(bare.public.responses, false);
  const legacy = processSubmission(readFileSync(bare.bodyFile, "utf8"), "someone", 8, new Date().toISOString(), [promptsHash()]);
  assert.ok(legacy.ok);
  if (legacy.ok) assert.equal(legacy.sub.schema, LEGACY_SCHEMA);

  // 재면접: 같은 명세·같은 시험으로 한 판 더. 서류전형까지 돌고, 끝까지 보면 2판 중 2판 합격으로 묶인다
  let again = arena("again", first);
  assert.equal(again.error, undefined, JSON.stringify(again));
  assert.notEqual(again.session, first);
  assert.equal(again.repeat.group, first);
  assert.equal(arena("again", first).error, "not_finished", "진행 중인 판이 있으면 새 판을 열지 않는다");
  const second = again.session;
  while (again.next) again = arena("next", second);
  assert.deepEqual([again.repeat.runs, again.repeat.passes, again.repeat.remaining], [2, 2, 0]);
  assert.deepEqual(again.repeat.stages.final, { seen: 2, passed: 2 });
  assert.equal(arena("submit", second).repeat.runs, 2);
  assert.equal(arena("list").sessions.length, 2);
});
