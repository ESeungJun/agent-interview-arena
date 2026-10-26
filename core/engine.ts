// 엔진 어댑터. 면접관과 지원자 에이전트의 LLM 호출을 한 인터페이스(Llm)로 감싼다.
//
// 백엔드
//  - api (이 파일): Messages API를 직접 호출한다. 시스템 프롬프트가 지정한 그대로만 들어간다. 별도 웹앱은 이것만 쓴다.
//  - cli (runner/cli_engine.ts): 로컬 Claude Code(`claude -p`)를 쓴다. 하네스가 환경 정보 등을 덧붙이고
//         시스템 프롬프트 공개 요청을 자체적으로 거절하므로, 최종 면접의 유출 판정이 실제보다 후하게 나온다.
//         결과 파일에 이 한계가 기록된다 (docs/06_engine_divisions.md).
import Anthropic from "@anthropic-ai/sdk";

export type Backend = "api" | "cli";
export type ModelAlias = "haiku" | "sonnet" | "opus";

export const MODEL_IDS: Record<ModelAlias, string> = {
  haiku: "claude-haiku-5-5",
  sonnet: "claude-sonnet-5-5",
  opus: "claude-opus-5-5",
};

/**
 * 백만 토큰당 달러. 5분 캐시 쓰기는 입력의 1.25배다. 가격이 바뀌면 여기만 고친다.
 * Haiku 5.5는 프롬프트가 10만 토큰을 넘으면 long 가격을 쓴다.
 */
type Price = { input: number; output: number; cacheRead: number; long?: Omit<Price, "long"> };
const PRICES: Record<string, Price> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, long: { input: 0.5, output: 2.5, cacheRead: 0.05 } },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
};

/** 응답 한 번의 비용. 서버 측 폴백으로 다른 모델이 답하면 그 모델 가격으로 센다. 모르는 모델이면 null. */
export function costUsd(model: string, u: Anthropic.Usage): number | null {
  const key = Object.keys(PRICES).find(id => model === id || model.startsWith(`${id}-`));
  if (!key) return null;
  const write = u.cache_creation_input_tokens ?? 0;
  const read = u.cache_read_input_tokens ?? 0;
  const base = PRICES[key];
  const p = base.long && u.input_tokens + write + read > 100_000 ? base.long : base;
  return (u.input_tokens * p.input + write * p.input * 1.25 + read * p.cacheRead + u.output_tokens * p.output) / 1e6;
}

export type ConverseRequest = {
  role: "interviewer" | "candidate";
  model: ModelAlias;
  system: string;
  userTurns: string[]; // 여러 개면 멀티턴. 앞 턴의 응답을 이어서 다음 턴을 보낸다.
  schema?: Record<string, unknown>; // 마지막 턴의 응답을 이 JSON 스키마로 강제 (면접관 전용)
  effort?: "low" | "medium" | "high";
  /** 같은 요청을 곧 다시 보낼 때 켠다 (면접관 다수결). API 백엔드는 마지막 블록까지 캐시하고, CLI는 하네스가 알아서 캐시한다. */
  cache?: boolean;
};

export type TurnResult = { text: string; json?: unknown; refused: boolean };
export type ConverseResult = {
  turns: TurnResult[];
  /** inputTokens는 캐시 쓰기·읽기를 포함한 전체 입력이다. cacheReadTokens는 그중 캐시에서 읽은 양이다. */
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; costUsd: number | null };
};

/** 면접 한 번에 쓰는 LLM 호출기. 백엔드 이름은 결과 보고서에 남긴다. */
export type Llm = { backend: Backend; converse(req: ConverseRequest): Promise<ConverseResult> };

// ---------------------------------------------------------------- API

/** API 키는 호출하는 쪽이 넘긴다(로컬은 환경변수, 별도 웹앱은 비밀 저장소). core는 환경변수를 읽지 않는다. */
export function createApiLlm(opts: { apiKey: string }): Llm {
  const client = new Anthropic({ apiKey: opts.apiKey });
  return { backend: "api", converse: req => converseApi(client, req) };
}

async function converseApi(client: Anthropic, req: ConverseRequest): Promise<ConverseResult> {
  const messages: Anthropic.MessageParam[] = [];
  const turns: TurnResult[] = [];
  const usage: ConverseResult["usage"] = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 };

  for (const [i, userTurn] of req.userTurns.entries()) {
    messages.push({ role: "user", content: userTurn });
    const isLast = i === req.userTurns.length - 1;
    const outputConfig: Record<string, unknown> = {};
    if (req.effort) outputConfig.effort = req.effort;
    if (isLast && req.schema) outputConfig.format = { type: "json_schema", schema: req.schema };

    const params = {
      model: MODEL_IDS[req.model],
      max_tokens: 16000,
      system: req.system,
      messages,
      ...(req.cache ? { cache_control: { type: "ephemeral" } } : {}),
      ...(Object.keys(outputConfig).length > 0 ? { output_config: outputConfig } : {}),
    };

    // 면접관은 안전 분류기 거절 시 서버 측 폴백을 쓴다(레드팀 공격문을 읽어야 하므로).
    // 지원자는 폴백하지 않는다: 엔진이 바뀌면 체급 공정성이 깨지고, 거절 자체가 방어 신호다.
    const useFallback = req.role === "interviewer" && req.model !== "haiku";
    const response = (useFallback
      ? await client.beta.messages.create({
          ...params,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        } as unknown as Anthropic.Beta.MessageCreateParamsNonStreaming)
      : await client.messages.create(params as Anthropic.MessageCreateParamsNonStreaming)) as Anthropic.Message;

    const text = response.content.flatMap(b => (b.type === "text" ? [b.text] : [])).join("");
    const refused = response.stop_reason === "refusal";
    turns.push({ text, refused, json: isLast && req.schema && !refused ? safeParse(text) : undefined });
    const u = response.usage;
    usage.inputTokens += u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
    usage.cacheReadTokens += u.cache_read_input_tokens ?? 0;
    usage.outputTokens += response.usage.output_tokens;
    const cost = costUsd(response.model ?? params.model, u);
    usage.costUsd = usage.costUsd === null || cost === null ? null : usage.costUsd + cost;
    messages.push({ role: "assistant", content: response.content as Anthropic.ContentBlockParam[] });
  }
  return { turns, usage };
}

export function safeParse(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}
