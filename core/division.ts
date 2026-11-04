// 지원자 모델(체급) 정하기.
// 명세가 frontmatter 의 model: 로 모델을 정해 두었으면 작성자가 그 모델을 전제로 썼다는 뜻이므로 그 모델로 면접한다.
// 정하지 않았거나 inherit 이면, 사용자의 세션 모델로 돌게 되므로 가장 흔한 Sonnet(middle)을 기본으로 한다.
// --division 을 직접 주면 그 값이 우선한다.

export type Division = "light" | "middle" | "open";
export const DIVISIONS: readonly Division[] = ["light", "middle", "open"];
export const DEFAULT_DIVISION: Division = "middle";
/** 체급마다 지원자 모델. 순위표도 제출물의 engine 이 체급과 맞는지 이 표로 본다 */
export const DIVISION_ENGINE: Record<Division, "haiku" | "sonnet" | "opus"> = { light: "haiku", middle: "sonnet", open: "opus" };
/** 체급을 어디서 정했는가: 직접 지정 / 명세의 model: / 기본값 */
export type DivisionSource = "flag" | "spec" | "default";

/** 문서 맨 앞 frontmatter 의 model: 값. 없으면 null */
export function specModel(md: string): string | null {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---\s*(\r?\n|$)/.exec(md);
  if (!m) return null;
  const line = /^model:[ \t]*(.*)$/m.exec(m[1]);
  if (!line) return null;
  // 사용자 파일에서 온 값이 결과 JSON 을 거쳐 스킬 안내문에 그대로 실린다. 모델 이름에 쓰는 문자만 남긴다
  const v = line[1].replace(/#.*$/, "").trim().replace(/^["']|["']$/g, "").trim().toLowerCase().replace(/[^a-z0-9._:-]/g, "").slice(0, 60);
  return v || null;
}

/** model: 값을 체급으로. "opus", "claude-opus-4-1" 같은 전체 이름도 받는다. inherit·모르는 값은 null */
export function divisionOfModel(model: string | null): Division | null {
  if (!model) return null;
  if (model.includes("haiku")) return "light";
  if (model.includes("sonnet")) return "middle";
  if (model.includes("opus")) return "open";
  return null;
}

export function pickDivision(md: string, flag: string | undefined): { division: Division; source: DivisionSource; specModel: string | null } {
  const declared = specModel(md);
  if (flag !== undefined) return { division: flag as Division, source: "flag", specModel: declared };
  const fromSpec = divisionOfModel(declared);
  return fromSpec ? { division: fromSpec, source: "spec", specModel: declared } : { division: DEFAULT_DIVISION, source: "default", specModel: declared };
}
