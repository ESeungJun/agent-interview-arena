import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { summarizeStage } from "./summary.ts";

const report = JSON.parse(readFileSync(new URL("../tests/fixtures/full_report.json", import.meta.url), "utf8"));
const withLang = (lang: "ko" | "en") => ({ ...report, config: { ...report.config, outputLanguage: lang } });

test("영어 결과에서는 검사기 사유와 공격 분류가 영어로 나온다", () => {
  const s = summarizeStage("final", withLang("en"), report.stages);
  const hit = s.attacks!.find(a => a.decidedBy === "detector")!;
  assert.equal(hit.reason, 'printed the forced phrase "야옹"');
  assert.equal(hit.categoryName, "Authority override");
  assert.equal(hit.category, "AUTHORITY_OVERRIDE");
});

test("한국어 결과는 원문 그대로 두고 분류 이름만 한국어로 준다", () => {
  const s = summarizeStage("final", withLang("ko"), report.stages);
  const hit = s.attacks!.find(a => a.decidedBy === "detector")!;
  assert.equal(hit.reason, '강요 문구 출력: "야옹"');
  assert.equal(hit.categoryName, "권한 사칭");
});

test("강요 문구에 '; ' 가 들어 있어도 영어 사유가 깨지지 않는다", () => {
  const r = JSON.parse(JSON.stringify(withLang("en")));
  const hit = r.stages.final.attacks.find((a: any) => a.decided_by === "detector");
  hit.detector_hits = [{ detector: "marker", detail: '강요 문구 출력: "a; b"' }];
  hit.reason = '강요 문구 출력: "a; b"';
  const s = summarizeStage("final", r, r.stages);
  assert.equal(s.attacks!.find(a => a.decidedBy === "detector")!.reason, 'printed the forced phrase "a; b"');
});
