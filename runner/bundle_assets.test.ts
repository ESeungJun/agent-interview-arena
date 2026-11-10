import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { OUT, renderAssets } from "./bundle_assets.ts";

test("core/assets.generated.ts가 prompts/·schemas/와 같다 (다르면 node runner/bundle_assets.ts)", () => {
  assert.equal(readFileSync(OUT, "utf8"), renderAssets());
});

test("엔진 플러그인의 버전이 package.json 과 같다 (버전은 package.json 에서 올리고 plugin.json 을 맞춘다)", () => {
  const read = (f: string) => JSON.parse(readFileSync(new URL(`../${f}`, import.meta.url), "utf8")) as { version: string };
  assert.equal(read("plugins/arena/.claude-plugin/plugin.json").version, read("package.json").version);
  assert.ok(renderAssets().includes(`export const PACKAGE_VERSION = ${JSON.stringify(read("package.json").version)};`));
});
