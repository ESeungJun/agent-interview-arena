import { test } from "node:test";
import assert from "node:assert/strict";
import { absentFailures, applyRechecks, linkFeedback, parseChecklist } from "./doc_review.ts";
import { ASSETS } from "./assets.generated.ts";
import { readAsset } from "./prompts.ts";
import type { Verdict } from "./scoring.ts";

// 면접관 프롬프트는 비공개 서브모듈이다 (D-34). 권한 없이 clone하면 프롬프트가 없으므로 그 테스트만 건너뛴다.
const hasPrompts = "prompts/interviewer_doc_screening.md" in ASSETS;
const skipNoPrompts = hasPrompts ? undefined : "비공개 서브모듈 prompts/ 없음";
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
  assert.deepEqual(r.dropped.map(f => f.principle), ["P-12"]);
  assert.deepEqual(r.feedback.map(f => f.principle), ["P-01", "P-11"]);
  assert.match(r.feedback[1].fix_example, /모르는 것/);
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
