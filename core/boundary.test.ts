// core/는 다른 Next.js 앱에 그대로 복사해 쓴다. 파일 시스템·프로세스·환경변수에 기대면 그쪽에서 깨지므로 코드로 막는다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL(".", import.meta.url));
const sources = readdirSync(dir).filter(f => f.endsWith(".ts") && !f.endsWith(".test.ts"));
const FORBIDDEN: [RegExp, string][] = [
  [/from\s+["']node:(fs|path|url|os|child_process|util)["']/, "파일·프로세스용 node 모듈"],
  [/process\.(env|argv|exit|cwd)/, "process 전역"],
  [/from\s+["']\.\.\//, "core 밖 모듈"],
  [/console\./, "콘솔 출력 (ctx.log를 쓴다)"],
];

test("core는 파일·프로세스·환경변수에 의존하지 않는다", () => {
  const problems = sources.flatMap(f => {
    const text = readFileSync(`${dir}/${f}`, "utf8");
    return FORBIDDEN.filter(([re]) => re.test(text)).map(([, why]) => `${f}: ${why}`);
  });
  assert.deepEqual(problems, []);
});
