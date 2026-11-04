import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { groundContracts } from "./contracts.ts";

// 실제 실행에서 서류 면접관이 뽑았던 약속들 (회귀 샘플 기준, D-38)
const good = readFileSync(new URL("../tests/sample_candidates/good_claude_subagent.md", import.meta.url), "utf8");
const noFallback = readFileSync(new URL("../tests/sample_candidates/no_fallback.md", import.meta.url), "utf8");
const fence = "코드펜스나 앞뒤 설명 없이 JSON 객체 하나다.";

test("good_claude_subagent: 명시된 JSON·코드펜스 약속만 남고, 추측한 언어·중복 괄호 약속은 빠진다", () => {
  const { kept, dropped } = groundContracts([
    { type: "json_output", value: "summary,issues", evidence: "항상 아래 JSON만 출력한다. " + fence },
    { type: "forbidden_phrases", value: "```", evidence: fence },
    { type: "must_start_with", value: "{", evidence: fence },
    { type: "must_end_with", value: "}", evidence: fence },
    { type: "language", value: "ko", evidence: '"summary": "리뷰할 diff 또는 파일 경로를 주세요."' },
  ], good);
  assert.deepEqual(kept.map(c => c.type), ["json_output", "forbidden_phrases"]);
  assert.deepEqual(dropped.map(d => d.contract.type), ["must_start_with", "must_end_with", "language"]);
});

test("no_fallback: 명시된 금지 표현·필수 섹션은 남고, 존댓말에서 추측한 언어와 시작 지시 없는 시작 문구는 빠진다", () => {
  const { kept, dropped } = groundContracts([
    { type: "forbidden_phrases", value: "최고,1위,완벽한", evidence: '과장 광고 표현("최고", "1위", "완벽한")은 쓰지 않는다.' },
    { type: "language", value: "ko", evidence: "밝고 친근한 존댓말을 쓴다." },
    { type: "must_start_with", value: "## 한 줄 요약", evidence: "## 한 줄 요약\n(한 문장)" },
    { type: "required_sections", value: "한 줄 요약,주요 특징,추천 대상", evidence: '설명문은 "한 줄 요약 / 주요 특징 / 추천 대상" 세 섹션으로 구성한다.' },
  ], noFallback);
  assert.deepEqual(kept.map(c => c.type), ["forbidden_phrases", "required_sections"]);
  assert.deepEqual(dropped.map(d => d.contract.type), ["language", "must_start_with"]);
});

test("명시된 언어·길이·시작 문구 약속은 남는다", () => {
  const md = "답변은 반드시 한국어로 쓴다.\n요약은 200자 이내로 쓴다.\n모든 답변은 '결론:'으로 시작한다.";
  const { kept } = groundContracts([
    { type: "language", value: "ko", evidence: "답변은 반드시 한국어로 쓴다." },
    { type: "max_chars", value: "200", evidence: "요약은 200자 이내로 쓴다." },
    { type: "must_start_with", value: "결론:", evidence: "모든 답변은 '결론:'으로 시작한다." },
  ], md);
  assert.equal(kept.length, 3);
});

test("근거가 문서에 없거나 문서에 없는 키·숫자는 빠진다", () => {
  const md = "출력은 JSON 으로 한다. 키는 answer 하나.";
  const { kept, dropped } = groundContracts([
    { type: "json_output", value: "answer,score", evidence: "출력은 JSON 으로 한다." },
    { type: "max_lines", value: "5", evidence: "다섯 줄 이내" },
  ], md);
  assert.equal(kept.length, 0);
  assert.equal(dropped.length, 2);
});
