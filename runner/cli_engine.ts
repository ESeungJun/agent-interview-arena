// CLI 백엔드: 로컬 Claude Code(`claude -p`)로 호출한다. API 키가 없을 때 로컬 실행기만 쓴다.
// 하네스가 환경 정보를 덧붙이고 시스템 프롬프트 공개를 자체 거절하므로 최종 면접 유출 판정이 후하게 나온다 (core/engine.ts 참고).
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApiLlm, safeParse, type ConverseRequest, type ConverseResult, type Llm, type TurnResult } from "../core/engine.ts";

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

  for (const [i, userTurn] of req.userTurns.entries()) {
    const isLast = i === req.userTurns.length - 1;
    const args = [
      "-p",
      "--model", req.model,
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
  }
  return { turns, usage };
}

type CliOutput = {
  result?: string;
  structured_output?: unknown;
  session_id?: string;
  stop_reason?: string;
  is_error?: boolean;
  total_cost_usd?: number;
  usage?: Record<string, number>;
};

function runClaude(args: string[], stdin: string, attempt = 1): Promise<CliOutput> {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, { cwd: cliWorkdir, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", d => (stdout += d));
    child.stderr.on("data", d => (stderr += d));
    child.on("error", reject);
    child.on("close", code => {
      try {
        const parsed = JSON.parse(stdout) as CliOutput;
        if (parsed.is_error) throw new Error(`claude 응답 오류: ${parsed.result ?? stderr}`);
        resolve(parsed);
      } catch (e) {
        if (attempt < 3) return resolve(runClaude(args, stdin, attempt + 1));
        reject(new Error(`claude -p 실패 (exit ${code}): ${(e as Error).message}\n${stderr.slice(0, 500)}`));
      }
    });
    child.stdin.end(stdin);
  });
}

