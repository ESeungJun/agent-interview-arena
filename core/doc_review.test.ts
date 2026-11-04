import { test } from "node:test";
import assert from "node:assert/strict";
import { absentFailures, applyRechecks, completeDocVerdicts, linkFeedback, parseChecklist, requiredDocIds } from "./doc_review.ts";
import { ASSETS } from "./assets.generated.ts";
import { readAsset } from "./prompts.ts";
import type { Verdict } from "./scoring.ts";

// 생성 모듈에 면접관 프롬프트가 없으면(prompts/ 를 지운 경우) 그 테스트만 건너뛴다.
const hasPrompts = "prompts/interviewer_doc_screening.md" in ASSETS;
const skipNoPrompts = hasPrompts ? undefined : "prompts/ 없음";
const checklist = hasPrompts ? parseChecklist(readAsset("prompts/interviewer_doc_screening.md")) : new Map();
const v = (id: string, result: Verdict["result"], evidence: string | null = null): Verdict => ({ id, result, evidence, reason: `${id} 사유` });

test("서류 프롬프트에서 체크리스트 전 항목과 원칙 태그를 읽는다", { skip: skipNoPrompts }, () => {
  assert.equal(checklist.get("D1-2")?.tag, "P-02");
  assert.equal(checklist.get("D5-4")?.tag, "P-11");
  assert.equal(checklist.get("M-A1")?.tag, "claude");
  assert.ok(checklist.size >= 34, `항목 ${checklist.size}개`);
});

test("피드백: 감점 판정이 없는 원칙을 지적한 피드백은 빼고 감점 원칙으로 채운다", { skip: skipNoPrompts }, () => {
  const verdicts = [v("D1-1", "false", "너는 도우미야"), v("D5-1", "false"), v("D5-2", "false"), v("D6-1", "true", "JSON")];
  const fb = [
    { principle: "P-01", problem: "역할 모호", fix_example: "역할을 적어라" },
    { principle: "P-12", problem: "형식 없음", fix_example: "형식을 적어라" }, // D6-1은 true라 근거 없음
  ];
  const r = linkFeedback(fb, verdicts, checklist);
  assert.ok(r.feedback.filter(f => !fb.includes(f)).every(f => /^Add a rule/.test(f.fix_example)), "채운 개선안은 출력 언어(기본 영어)로");
  assert.ok(linkFeedback(fb, verdicts, checklist, 3, "ko").feedback.filter(f => !fb.includes(f)).every(f => /^위 문제를/.test(f.fix_example)));
  assert.deepEqual(r.dropped.map(f => f.principle), ["P-12"]);
  assert.deepEqual(r.feedback.map(f => f.principle), ["P-01", "P-11"]);
  // 코드가 채운 피드백에는 비공개 체크리스트 원문을 쓰지 않는다
  assert.doesNotMatch(r.feedback[1].fix_example, /모르는 것/);
  assert.match(r.feedback[1].fix_example, /rule to the \.md/);
});

test("피드백: P-01/P-02처럼 묶인 원칙은 하나라도 감점이 있으면 유지", { skip: skipNoPrompts }, () => {
  const r = linkFeedback([{ principle: "P-01/P-02", problem: "", fix_example: "" }], [v("D1-3", "false")], checklist);
  assert.equal(r.dropped.length, 0);
});

test("재확인: 원문에 있는 인용이면 true로 정정, 원문에 없는 인용이면 유지", () => {
  const md = "필수 입력이 빠지면 한 번에 하나씩 되묻는다.";
  const verdicts = [v("D5-2", "false"), v("D5-3", "false"), v("D1-1", "false", "인용 있는 감점")];
  assert.deepEqual(absentFailures(verdicts).map(x => x.id), ["D5-2", "D5-3"]);
  const r = applyRechecks(verdicts, [
    { id: "D5-2", found: true, evidence: "필수 입력이 빠지면 한 번에 하나씩 되묻는다.", reason: "되묻기 규칙 있음" },
    { id: "D5-3", found: true, evidence: "모호하면 선택지를 준다", reason: "지어낸 인용" },
  ], md);
  assert.deepEqual(r.flipped, ["D5-2"]);
  assert.equal(r.verdicts.find(x => x.id === "D5-3")?.result, "false");
});

test("여러 줄인 항목 정의는 들여 쓴 다음 줄까지 읽는다 (D2-3 의 세는 규칙)", { skip: skipNoPrompts }, () => {
  const d23 = checklist.get("D2-3")?.text ?? "";
  assert.match(d23, /three or more/);
  assert.equal(checklist.get("D2-4")?.text.includes("\n"), false);
});

test("재확인: \"문제가 없는가\"를 묻는 항목의 false 는 재확인하지 않는다 (질문이 거꾸로 된다)", () => {
  const out = absentFailures([v("D2-3", "false"), v("D2-5", "false"), v("D5-1", "false")]);
  assert.deepEqual(out.map(x => x.id), ["D5-1"]);
});

test("서류 판정 정리: 영역 이름 붙은 id 고치기, 모르는 id·중복 버리기, 빠진 항목은 채점 제외로 채우기", { skip: skipNoPrompts }, () => {
  const required = requiredDocIds(checklist, "claude");
  const out = completeDocVerdicts([v("D8-M-A1", "true", "q"), v("D1-1", "true", "q"), v("D1-1", "false"), v("D9-9", "true")], checklist, required);
  assert.deepEqual(out.find(x => x.id === "M-A1")?.result, "true");
  assert.equal(out.filter(x => x.id === "D1-1").length, 1);
  assert.equal(out.find(x => x.id === "D1-1")?.result, "true");
  assert.equal(out.some(x => x.id === "D9-9" || x.id === "D8-M-A1"), false);
  assert.deepEqual(new Set(out.map(x => x.id)), new Set(required));
  assert.ok(out.filter(x => x.excluded).every(x => x.result === "na"));
});
