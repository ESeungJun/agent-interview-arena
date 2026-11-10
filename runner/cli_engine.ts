// CLI 백엔드: 로컬 Claude Code(`claude -p`)로 호출한다. API 키가 없을 때 로컬 실행기만 쓴다.
// 하네스가 환경 정보를 덧붙이고 시스템 프롬프트 공개를 자체 거절하므로 최종 면접 유출 판정이 후하게 나온다 (core/engine.ts 참고).
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApiLlm, MODEL_ID, MODEL_IDS, safeParse, type ConverseRequest, type ConverseResult, type Llm, type TurnResult } from "../core/engine.ts";

export const cliLlm: Llm = { backend: "cli", converse: req => converseCli(req) };

/** 로컬 실행기의 기본 호출기: ANTHROPIC_API_KEY가 있으면 API, 없으면 claude -p. */
export function localLlm(): Llm {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  return apiKey ? createApiLlm({ apiKey }) : cliLlm;
}

const cliWorkdir = mkdtempSync(join(tmpdir(), "arena-"));

async function converseCli(req: ConverseRequest): Promise<ConverseResult> {
  const turns: TurnResult[] = [];
  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 as number | null };
  let sessionId: string | undefined;
  const modelIds = new Set<string>();

  for (const [i, userTurn] of req.userTurns.entries()) {
    const isLast = i === req.userTurns.length - 1;
    const args = [
      "-p",
      // 별칭(haiku·sonnet·opus)은 Claude Code 버전에 따라 다른 세대를 가리킨다. API 백엔드와 같은 모델 ID 로 고정한다
      "--model", MODEL_IDS[req.model],
      "--system-prompt", req.system,
      "--tools", "",
      "--strict-mcp-config",
      "--setting-sources", "",
      "--disable-slash-commands",
      "--output-format", "json",
    ];
    if (req.effort) args.push("--effort", req.effort);
    if (isLast && req.schema) args.push("--json-schema", JSON.stringify(req.schema));
    if (sessionId) args.push("--resume", sessionId);
    if (req.userTurns.length === 1) args.push("--no-session-persistence");

    const out = await runClaude(args, userTurn);
    sessionId = out.session_id;
    const text = typeof out.result === "string" ? out.result : "";
    turns.push({
      text,
      refused: out.stop_reason === "refusal",
      json: isLast && req.schema ? (out.structured_output ?? safeParse(text)) : undefined,
    });
    const u = out.usage ?? {};
    usage.inputTokens += (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
    usage.cacheReadTokens += u.cache_read_input_tokens ?? 0;
    usage.outputTokens += u.output_tokens ?? 0;
    usage.costUsd = (usage.costUsd ?? 0) + (out.total_cost_usd ?? 0);
    const answered = answeringModel(out);
    if (answered) modelIds.add(answered);
  }
  return { turns, usage, modelIds: [...modelIds] };
}

/**
 * claude -p 의 JSON 출력에서 실제로 답한 모델 ID. modelUsage 는 모델 ID 별 사용량 표이고, 하네스가 보조 작업에 쓴
 * 작은 모델이 함께 실릴 수 있어 출력 토큰이 가장 많은 것을 답한 모델로 본다. 모양이 다르거나 없으면 undefined (기록하지 않는다).
 */
export function answeringModel(out: CliOutput): string | undefined {
  const table = out.modelUsage;
  if (!table || typeof table !== "object") return undefined;
  const rows = Object.entries(table)
    .filter(([id]) => MODEL_ID.test(id))
    .map(([id, u]) => [id, Number((u as Record<string, unknown> | null)?.outputTokens ?? 0) || 0] as const)
    .sort((a, b) => b[1] - a[1]);
  return rows[0]?.[0];
}

export type CliOutput = {
  result?: string;
  structured_output?: unknown;
  session_id?: string;
  stop_reason?: string;
  is_error?: boolean;
  total_cost_usd?: number;
  usage?: Record<string, number>;
  modelUsage?: Record<string, unknown>;
};

/** 호출 한 번의 시간 제한. 스킬은 단계 하나를 600초 Bash 제한 안에 돌리므로, 멈춘 호출 하나가 단계를 통째로 날리지 않게 그보다 짧게 둔다 */
export const CLI_TIMEOUT_MS = 240_000;
const CLI_ATTEMPTS = 3;
/** 종료 신호를 무시하는 프로세스를 강제로 끝내기까지 기다리는 시간 */
const KILL_GRACE_MS = 3_000;

function timeoutMs(): number {
  const v = Number(process.env.ARENA_CLI_TIMEOUT_MS);
  return Number.isFinite(v) && v >= 1_000 ? v : CLI_TIMEOUT_MS;
}

export type RunOptions = { command?: string; timeoutMs?: number; killGraceMs?: number; log?: (msg: string) => void };

/**
 * claude -p 를 한 번 부른다. 실패(종료 코드·깨진 출력·시간 초과)하면 CLI_ATTEMPTS 번까지 다시 부른다.
 * 시간 제한을 넘으면 프로세스를 끝내고 다시 부른다. 끝나지 않는 프로세스를 남기지 않는다.
 */
export function runClaude(args: string[], stdin: string, opts: RunOptions = {}, attempt = 1): Promise<CliOutput> {
  const limit = opts.timeoutMs ?? timeoutMs();
  const log = opts.log ?? (msg => process.stderr.write(`${msg}\n`));
  return new Promise((resolve, reject) => {
    const child = spawn(opts.command ?? "claude", args, { cwd: cliWorkdir, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let killer: NodeJS.Timeout | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      killer = setTimeout(() => child.kill("SIGKILL"), opts.killGraceMs ?? KILL_GRACE_MS);
    }, limit);
    const retryOrFail = (why: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (attempt < CLI_ATTEMPTS) {
        log(`  ↻ claude -p 다시 시도 (${attempt}/${CLI_ATTEMPTS} 실패: ${why.split("\n")[0].slice(0, 200)})`);
        return resolve(runClaude(args, stdin, opts, attempt + 1));
      }
      reject(new Error(`claude -p 실패: ${why}\n${stderr.slice(0, 500)}`));
    };
    child.stdout.on("data", d => (stdout += d));
    child.stderr.on("data", d => (stderr += d));
    // 시작하지 못한 경우(claude 가 없음 등)는 다시 불러도 같으므로 바로 실패한다
    child.on("error", e => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(e);
    });
    // 입력을 다 쓰기 전에 프로세스가 끝나면 EPIPE 가 난다. close 처리에 맡긴다
    child.stdin.on("error", () => {});
    child.on("close", code => {
      clearTimeout(killer);
      if (timedOut) return retryOrFail(`${Math.round(limit / 1000)}초 안에 끝나지 않아 중단함`);
      try {
        const parsed = JSON.parse(stdout) as CliOutput;
        if (parsed.is_error) throw new Error(`claude 응답 오류: ${parsed.result ?? stderr}`);
        settled = true;
        clearTimeout(timer);
        resolve(parsed);
      } catch (e) {
        retryOrFail(`exit ${code}: ${(e as Error).message}`);
      }
    });
    child.stdin.end(stdin);
  });
}
