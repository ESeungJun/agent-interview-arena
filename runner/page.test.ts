import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

// 순위표 페이지는 CSP 로 인라인 스크립트를 해시 하나만 허용한다. 스크립트를 고치면 해시도 바꿔야 페이지가 돈다
test("순위표 페이지의 CSP 해시가 인라인 스크립트와 같다", () => {
  const html = readFileSync(new URL("../docs/index.html", import.meta.url), "utf8");
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script !== undefined);
  const hash = createHash("sha256").update(script).digest("base64");
  assert.ok(html.includes(`script-src 'sha256-${hash}'`), `CSP 의 script-src 를 'sha256-${hash}' 로 바꾸세요`);
});
