import { test } from "node:test";
import assert from "node:assert/strict";
import { divisionOfModel, pickDivision, specModel } from "./division.ts";

const fm = (body: string) => `---\nname: x\n${body}\n---\n\nYou are an agent.`;

test("명세의 model: 을 읽는다 (따옴표·주석·전체 모델 이름 포함)", () => {
  assert.equal(specModel(fm("model: opus")), "opus");
  assert.equal(specModel(fm('model: "Sonnet"  # fast')), "sonnet");
  assert.equal(specModel(fm("description: no model here")), null);
  assert.equal(specModel("model: opus\n본문에 있는 줄은 frontmatter 가 아니다"), null);
  // 스킬 안내문에 그대로 실리는 값이라 모델 이름에 쓰는 문자만 남긴다
  assert.equal(specModel(fm("model: <b>gpt-4o</b> `x`")), "bgpt-4obx");
  assert.equal(divisionOfModel("claude-opus-4-1"), "open");
  assert.equal(divisionOfModel("haiku"), "light");
  assert.equal(divisionOfModel("inherit"), null);
});

test("체급: 직접 지정 > 명세의 model: > 기본값(middle)", () => {
  assert.deepEqual(pickDivision(fm("model: opus"), undefined), { division: "open", source: "spec", specModel: "opus" });
  assert.deepEqual(pickDivision(fm("model: opus"), "light"), { division: "light", source: "flag", specModel: "opus" });
  assert.deepEqual(pickDivision(fm("model: inherit"), undefined), { division: "middle", source: "default", specModel: "inherit" });
  assert.deepEqual(pickDivision("# SKILL\nno frontmatter", undefined), { division: "middle", source: "default", specModel: null });
});
