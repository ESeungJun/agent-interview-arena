// 면접 흐름: 보안 검문소 → 서류전형 → 1차 → 2차 → 최종. 단계 구현은 stages.ts.
// 파일·콘솔·환경변수를 쓰지 않는다. .md 원문, LLM 호출기, 출제분 저장소를 받아 결과를 돌려줄 뿐이다.
//
// 두 가지 방식으로 돌린다.
//  - interview(): 한 번에 원하는 단계까지 (로컬 실행기·측정용)
//  - runChallenge(): 한 단계씩 (서비스). 앞 단계를 통과해야 다음 단계에 도전할 수 있다 (D-28)
import type { Llm, ModelAlias } from "./engine.ts";
import { mulberry32, openExam, type ExamStore } from "./exam.ts";
import { PASS_LINE } from "./scoring.ts";
import {
  docScreening, finalRound, round1, round2, securityCheckpoint,
  type Context, type DocResult, type FinalResult, type Round1Result, type Round2Result, type SecurityResult, type StageOutcome,
} from "./stages.ts";

export const STAGES = ["security", "doc", "r1", "r2", "final"] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_NAMES: Record<Stage, string> = { security: "🛡️ 보안 검문소", doc: "📄 서류전형", r1: "💼 1차 면접", r2: "🔥 2차 면접", final: "🕶️ 최종 면접" };
export const DIVISION_ENGINE: Record<string, ModelAlias> = { light: "haiku", middle: "sonnet", open: "opus" };

/** 단계별 결과. 다음 단계가 앞 단계의 출력(서류의 직무 프로필, 1차 과제 등)을 쓰므로 통째로 보관해 넘긴다. */
export type StageResults = {
  security?: SecurityResult; doc?: DocResult; r1?: Round1Result; r2?: Round2Result; final?: FinalResult;
};

type Usage = Context["usage"];

export type EngineOptions = {
  md: string; llm: Llm; examStore: ExamStore;
  target: string; division: string; engine?: ModelAlias; interviewer: ModelAlias;
  seed?: number; screenAll: boolean; freshExam?: boolean;
  /** 공격 편성 시드용 서버 비밀값. 없으면 로컬용 고정값 (core/exam.ts attackSeedOf). */
  examSecret?: string;
  /** 진행 로그. 로컬은 콘솔, 웹앱은 진행 상황 저장에 쓴다. */
  log?: (msg: string) => void;
};

async function createContext(opts: EngineOptions) {
  const engine = opts.engine ?? DIVISION_ENGINE[opts.division];
  const seed = opts.seed ?? Math.floor(Math.random() * 2 ** 31);
  const caveats: string[] = [];
  if (opts.llm.backend === "cli") {
    caveats.push("CLI 백엔드: Claude Code 하네스가 환경 정보를 덧붙이고 시스템 프롬프트 공개를 자체 거절하므로, 최종 면접의 유출 방어가 실제보다 후하게 나올 수 있음. 정확한 측정은 ANTHROPIC_API_KEY로 API 백엔드 사용.");
  }
  if (!["claude", "generic"].includes(opts.target)) {
    caveats.push(`타겟 모델 ${opts.target}용 엔진 어댑터가 없어 Claude ${engine}에서 실행함. 체급 제도 취지(타겟 엔진에서 면접)와 다르므로 1차 이후 결과는 참고용.`);
  }
  const ctx: Context = {
    md: opts.md, llm: opts.llm, target: opts.target, engine, interviewer: opts.interviewer, rng: mulberry32(seed),
    exam: await openExam(opts.md, { store: opts.examStore, fresh: opts.freshExam, secret: opts.examSecret }),
    screenSampleRate: opts.screenAll ? 1 : 0.1,
    log: opts.log ?? (() => {}),
    usage: {
      interviewer: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0, calls: 0 },
      candidate: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0, calls: 0 },
    },
  };
  for (const c of caveats) ctx.log(`ℹ️ ${c}`);
  return { ctx, engine, seed, caveats };
}

// ---------------------------------------------------------------- 단계 실행 (로그 포함)

async function runSecurity(ctx: Context): Promise<SecurityResult> {
  ctx.log(STAGE_NAMES.security);
  return securityCheckpoint(ctx);
}

async function runDoc(ctx: Context): Promise<DocResult> {
  ctx.log(STAGE_NAMES.doc);
  const doc = await docScreening(ctx);
  ctx.log(`  ${doc.score}점 (통과선 ${PASS_LINE.doc})${doc.lowConfidence ? " ⚠️ 채점 신뢰도 낮음" : ""}`);
  return doc;
}

async function runR1(ctx: Context, doc: DocResult): Promise<Round1Result> {
  ctx.log(STAGE_NAMES.r1);
  const r1 = await round1(ctx, doc.output);
  ctx.log(`  ${r1.score}점 (통과선 ${PASS_LINE.r1}) (면접관별 ${r1.runs.join("/")}, 항목 다수결)${r1.lowConfidence ? " ⚠️ 채점 신뢰도 낮음" : ""}`);
  return r1;
}

async function runR2(ctx: Context, doc: DocResult): Promise<Round2Result> {
  ctx.log(STAGE_NAMES.r2);
  const r2 = await round2(ctx, doc.output, doc.output.verdicts);
  ctx.log(`  ${r2.score}점 (통과선 ${PASS_LINE.r2}) (면접관별 ${r2.runs.join("/")}, 항목 다수결)${r2.lowConfidence ? " ⚠️ 채점 신뢰도 낮음" : ""}`);
  return r2;
}

async function runFinal(ctx: Context, doc: DocResult, r1: Round1Result): Promise<FinalResult> {
  ctx.log(STAGE_NAMES.final);
  const fin = await finalRound(ctx, doc.output, r1.tasks.find(t => t.id === "T2")?.user_message);
  for (const a of fin.attacks) ctx.log(`  ${a.defended ? "🛡️ 방어" : "💥 뚫림"} ${a.attack_id} ${a.name} — ${a.reason}`);
  return fin;
}

// ---------------------------------------------------------------- 한 단계씩 (서비스)

/** 지원자가 도전하는 단계. 보안 검문소는 서류전형에 묶여 함께 돈다. */
export const CHALLENGES = ["doc", "r1", "r2", "final"] as const;
export type Challenge = (typeof CHALLENGES)[number];

/**
 * 지금 도전할 수 있는 단계. 앞 단계를 모두 통과했고 아직 보지 않은 첫 단계다.
 * 탈락·보안 실격이 있거나 최종까지 끝났으면 null.
 */
export function nextChallenge(results: StageResults): Challenge | null {
  if (results.security && !results.security.passed) return null;
  for (const c of CHALLENGES) {
    const r = results[c];
    if (!r) return c;
    if (!r.passed) return null;
  }
  return null;
}

export type ChallengeReport = {
  challenge: Challenge; startedAt: string; backend: string; caveats: string[];
  config: { target: string; division: string; engine: ModelAlias; interviewer: ModelAlias; seed: number; exam: string };
  passed: boolean; securityBan?: StageOutcome["securityBan"]; result: string;
  /** 이번에 돈 단계만 담는다 (서류 도전이면 security + doc) */
  stages: StageResults;
  usage: Usage;
};

export class ChallengeLockedError extends Error {}

/** 한 단계에 도전한다. 앞 단계를 통과하지 않았거나 이미 본 단계면 ChallengeLockedError. */
export async function runChallenge(opts: EngineOptions, challenge: Challenge, prior: StageResults): Promise<ChallengeReport> {
  const allowed = nextChallenge(prior);
  if (allowed !== challenge) {
    const why = allowed === null ? "더 도전할 단계가 없습니다" : `지금 도전할 수 있는 단계는 ${STAGE_NAMES[allowed]}입니다`;
    throw new ChallengeLockedError(`${STAGE_NAMES[challenge]}에 도전할 수 없습니다: ${why}`);
  }
  const startedAt = new Date().toISOString();
  const { ctx, engine, seed, caveats } = await createContext(opts);
  const stages: StageResults = {};
  let outcome: StageOutcome;
  if (challenge === "doc") {
    stages.security = await runSecurity(ctx);
    outcome = stages.security;
    if (!outcome.securityBan) outcome = stages.doc = await runDoc(ctx);
  } else if (challenge === "r1") {
    outcome = stages.r1 = await runR1(ctx, prior.doc!);
  } else if (challenge === "r2") {
    outcome = stages.r2 = await runR2(ctx, prior.doc!);
  } else {
    outcome = stages.final = await runFinal(ctx, prior.doc!, prior.r1!);
  }
  const name = STAGE_NAMES[challenge];
  const result = outcome.securityBan
    ? `🚨 보안 실격 (${outcome.securityBan.rule})`
    : !outcome.passed ? `❌ ${name} 탈락`
    : challenge === "final" ? "🏆 최종 합격"
    : `✅ ${name} 합격`;
  return {
    challenge, startedAt, backend: opts.llm.backend, caveats,
    config: { target: opts.target, division: opts.division, engine, interviewer: opts.interviewer, seed, exam: opts.freshExam ? "fresh" : ctx.exam.quarter },
    passed: outcome.passed && !outcome.securityBan, securityBan: outcome.securityBan, result, stages, usage: ctx.usage,
  };
}

// ---------------------------------------------------------------- 한 번에 (로컬 실행기·측정용)

export type InterviewOptions = EngineOptions & {
  agentName: string; until: Stage;
  /** 1·2차에서 탈락해도 다음 단계까지 진행 (채점 편차 측정용) */
  noStop?: boolean;
};

export type InterviewReport = {
  agent: string; startedAt: string; backend: string; caveats: string[];
  config: { target: string; division: string; engine: ModelAlias; interviewer: ModelAlias; seed: number; exam: string };
  reached: Stage; result: string; stages: StageResults;
  usage: Usage;
};

export async function interview(opts: InterviewOptions): Promise<InterviewReport> {
  const { ctx, engine, seed, caveats } = await createContext(opts);
  const report: InterviewReport = {
    agent: opts.agentName, startedAt: new Date().toISOString(), backend: opts.llm.backend, caveats,
    config: { target: opts.target, division: opts.division, engine, interviewer: opts.interviewer, seed, exam: opts.freshExam ? "fresh" : ctx.exam.quarter },
    reached: "security", result: "", stages: {}, usage: ctx.usage,
  };

  const stop = (stage: Stage, outcome: StageOutcome): boolean => {
    report.reached = stage;
    if (outcome.securityBan) {
      report.result = `🚨 보안 실격 (${STAGE_NAMES[stage]}, ${outcome.securityBan.rule})`;
      return true;
    }
    const failedEarlier = report.result.startsWith("❌");
    if (!outcome.passed) {
      if (!failedEarlier) report.result = `❌ ${STAGE_NAMES[stage]} 탈락`;
      return !(opts.noStop && (stage === "r1" || stage === "r2") && stage !== opts.until);
    }
    if (!failedEarlier) report.result = `✅ ${STAGE_NAMES[stage]} 합격`;
    return stage === opts.until;
  };

  const sec = (report.stages.security = await runSecurity(ctx));
  if (stop("security", sec)) return report;
  const doc = (report.stages.doc = await runDoc(ctx));
  if (stop("doc", doc)) return report;
  const r1 = (report.stages.r1 = await runR1(ctx, doc));
  if (stop("r1", r1)) return report;
  const r2 = (report.stages.r2 = await runR2(ctx, doc));
  if (stop("r2", r2)) return report;
  const fin = (report.stages.final = await runFinal(ctx, doc, r1));
  if (stop("final", fin) || report.result.startsWith("❌")) return report;
  report.result = "🏆 최종 합격";
  return report;
}
