import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { OUT, renderAssets } from "./bundle_assets.ts";

test("core/assets.generated.ts가 prompts/·schemas/와 같다 (다르면 node runner/bundle_assets.ts)", () => {
  assert.equal(readFileSync(OUT, "utf8"), renderAssets());
});
