// 모델 별칭과 고정 모델 ID. SDK 에 기대지 않는 파일로 둔다: 순위표 검증(runner/board.ts)은 npm 의존성 없이 돈다.

export type ModelAlias = "haiku" | "sonnet" | "opus";

/** 체급의 별칭이 가리키는 모델 ID. API·CLI 백엔드 모두 이 ID 로 부른다 (별칭은 Claude Code 버전에 따라 다른 세대를 가리킨다) */
export const MODEL_IDS: Record<ModelAlias, string> = {
  haiku: "claude-haiku-5-5",
  sonnet: "claude-sonnet-5-5",
  opus: "claude-opus-5-5",
};

/** 기록에 남길 수 있는 모델 ID 모양. 순위표도 같은 모양만 받는다 */
export const MODEL_ID = /^claude-[a-z0-9-]{1,50}$/;
