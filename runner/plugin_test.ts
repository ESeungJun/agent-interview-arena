// 대기실 패널(plugins/arena-room) 테스트 실행기: `claude plugin test` 를 부른다.
// 패널 테스트는 'claude-code/testing' 을 쓰므로 mods 를 지원하는 Claude Code 가 있어야 돈다.
// 없으면 건너뛰고 그 사실을 적는다 (CI 에는 Claude Code 가 없다). ARENA_REQUIRE_ROOM_TEST=1 이면 건너뛰는 대신 실패한다.
// 패널의 순수 부분(reduceRoom)은 runner/room.test.ts 가 node --test 로 항상 돌린다.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("../plugins/arena-room", import.meta.url));
const required = process.env.ARENA_REQUIRE_ROOM_TEST === "1";
const skip = (why: string): never => {
  console.log(`arena-room 패널 테스트 건너뜀: ${why}`);
  process.exit(required ? 1 : 0);
};

const help = spawnSync("claude", ["plugin", "test", "--help"], { encoding: "utf8", timeout: 30_000 });
if (help.error || help.status !== 0) skip("claude 명령이 없거나 plugin test 를 지원하지 않는 버전");
if (!/Run a mod's tests/i.test(help.stdout ?? "")) skip("이 Claude Code 는 mods 테스트를 지원하지 않음");

const run = spawnSync("claude", ["plugin", "test", dir], { stdio: "inherit", timeout: 120_000 });
process.exit(run.status ?? 1);
