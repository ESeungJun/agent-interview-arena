// 순위표 제출과 검증.
//  - buildSubmission: 끝난 랭크전 세션에서 제출물을 만든다 (arena submit 이 쓴다)
//  - verifySubmission: LLM 없이 무료로 할 수 있는 검사만 한다 (GitHub Actions 가 쓴다)
//  - CLI 는 runner/board_cli.ts 에 있다 (이 파일은 엔진 번들에도 들어가므로 실행 진입점을 두지 않는다)
// 제출물은 직접 측정(self-reported) 기록이다. 검증은 "점수를 손으로 고친 제출"과 "다른 문서로 받은 결과"를 막을 뿐,
// 면접 자체를 다시 보지는 않는다. 다시 보는 재검증(Verified)은 비공개 공격 풀로 따로 돈다 (README 참고).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { ASSETS } from "../core/assets.generated.ts";
import { parseChecklist, requiredDocIds } from "../core/doc_review.ts";
import { mdHash } from "../core/exam.ts";
import { runSecurityGate } from "../core/gate.ts";
import { DIVISION_ENGINE } from "../core/division.ts";
import {
  excludeUnverified, PASS_LINE, R1_ITEM_ID, R1_PER_RESPONSE, R2_ITEM_ID, R2_PER_RUN, scoreDoc, scoreRound1, scoreRound2, TARGETS, type Verdict,
} from "../core/scoring.ts";
import { countViolations } from "../core/stages.ts";
import type { StageResults } from "../core/interview.ts";

export const SUBMISSION_SCHEMA = 1;
export const BODY_MARKER_START = "<!-- arena-submission:start -->";
export const BODY_MARKER_END = "<!-- arena-submission:end -->";
/** GitHub Issue 본문 한도는 65,536자다. 앞뒤 안내문 자리를 남긴다 */
export const MAX_PAYLOAD_CHARS = 60_000;
/** 면접할 내용이 있는 최소 분량 (공백 제외 글자 수). 엔진은 시작할 때, 검증은 제출물에서 같은 값으로 본다 */
export const MIN_MD_CHARS = 40;

/** 면접관 프롬프트·스키마 묶음의 지문. 프롬프트를 고쳐 돌린 결과를 구분한다. */
export function promptsHash(): string {
  const h = createHash("sha256");
  for (const key of Object.keys(ASSETS).sort()) {
    if (!key.startsWith("prompts/") && !key.startsWith("schemas/")) continue;
    h.update(key).update("\0").update(ASSETS[key]).update("\0");
  }
  return h.digest("hex").slice(0, 16);
}

export type Submission = {
  schema: number; arenaVersion: string; promptsHash: string; createdAt: string;
  agent: string; md: string; mdHash: string;
  options: { lang: string; mode: string; target: string; division: string };
  run: { engine: string; interviewer: string; generator: string; backend: string };
  reached: "security" | "doc" | "r1" | "r2" | "final"; hired: boolean;
  stages: {
    security: { passed: boolean; rule?: string };
    // banned: 면접관이 평가 시스템 공격을 잡아 실격시킨 규칙 이름. 있으면 점수와 상관없이 불합격이다
    doc?: { passed: boolean; score: number; verdicts: Verdict[]; banned?: string };
    r1?: { passed: boolean; score: number; verdicts: Verdict[]; violationCount: number; banned?: string };
    // runKeys: 실제로 돌린 회차 (S1-a, S1-b …). 랭크전은 시나리오마다 두 번 돈다
    // 예전 엔진(0.1.0 이전 개발판)의 제출에는 없다. 없으면 "스킬을 업데이트하라"고 안내한다
    r2?: { passed: boolean; score: number; verdicts: Verdict[]; scenarioIds: string[]; runKeys?: string[]; banned?: string };
    final?: { passed: boolean; attacks: { category: string; defended: boolean; decided_by: string }[]; banned?: string };
  };
};

type SessionLike = {
  agent: string; md: string; mdHash: string; options: Submission["options"]; promptsHash?: string;
  stages: StageResults; reports: { backend: string; config: { engine: string; interviewer: string; generator: string } }[];
};

/**
 * 파일 이름을 에이전트 이름으로 쓴다. 이 이름은 Issue 제목·셸 명령·패널에 들어가므로
 * 영문·숫자·점·밑줄·하이픈만 남긴다 (따옴표·$()·제어 문자가 섞인 파일 이름 대비).
 */
export function agentName(path: string): string {
  return basename(path).replace(/[^A-Za-z0-9._-]/g, "_").replace(/_+/g, "_").slice(0, 100) || "agent.md";
}

export function buildSubmission(s: SessionLike, arenaVersion: string): Submission {
  const st = s.stages;
  const reached = st.final ? "final" : st.r2 ? "r2" : st.r1 ? "r1" : st.doc ? "doc" : "security";
  const last = s.reports[s.reports.length - 1];
  return {
    // 면접을 시작할 때 기록한 프롬프트 지문을 쓴다. 그 사이 스킬을 업데이트했어도 실제로 채점한 프롬프트 버전이 남는다
    schema: SUBMISSION_SCHEMA, arenaVersion, promptsHash: s.promptsHash ?? promptsHash(), createdAt: new Date().toISOString(),
    // 이전 버전에서 시작한 세션은 이름이 정리되지 않았을 수 있다
    agent: agentName(s.agent), md: s.md, mdHash: s.mdHash, options: s.options,
    run: { engine: last.config.engine, interviewer: last.config.interviewer, generator: last.config.generator, backend: last.backend },
    reached, hired: !!st.final?.passed,
    stages: {
      security: { passed: !!st.security?.passed, rule: st.security?.securityBan?.rule },
      doc: st.doc && { passed: st.doc.passed, score: st.doc.score, verdicts: st.doc.output.verdicts, banned: st.doc.securityBan?.rule },
      r1: st.r1 && { passed: st.r1.passed, score: st.r1.score, verdicts: st.r1.output.verdicts, violationCount: countViolations(st.r1.contractViolations), banned: st.r1.securityBan?.rule },
      r2: st.r2 && { passed: st.r2.passed, score: st.r2.score, verdicts: st.r2.output.verdicts, scenarioIds: st.r2.scenarios.map(x => x.id), runKeys: Object.keys(st.r2.transcripts).sort(), banned: st.r2.securityBan?.rule },
      final: st.final && {
        passed: st.final.passed, banned: st.final.securityBan?.rule,
        attacks: st.final.attacks.map(a => ({ category: a.category, defended: a.defended, decided_by: a.decided_by })),
      },
    },
  };
}

export function encodeSubmission(sub: Submission): string {
  return gzipSync(Buffer.from(JSON.stringify(sub))).toString("base64");
}

/** Issue 본문에서 제출물을 꺼낸다. 형식이 틀리면 null. 본문은 신뢰할 수 없는 입력이다. */
export function decodeIssueBody(body: string): Submission | null {
  const start = body.indexOf(BODY_MARKER_START);
  const end = body.indexOf(BODY_MARKER_END);
  if (start < 0 || end < start) return null;
  const b64 = body.slice(start + BODY_MARKER_START.length, end).replace(/```[a-z]*|\s/g, "");
  if (!/^[A-Za-z0-9+/=]+$/.test(b64) || b64.length > MAX_PAYLOAD_CHARS) return null;
  try {
    // 압축 폭탄을 막으려고 풀린 크기를 제한한다
    const json = gunzipSync(Buffer.from(b64, "base64"), { maxOutputLength: 1024 * 1024 }).toString("utf8");
    return canonicalSubmission(JSON.parse(json));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- 제출물 정규화
// 풀어낸 값은 아무 모양이나 될 수 있다. 정해 둔 필드만 형식·길이를 확인해 새 객체로 옮기고,
// 저장하는 것도 이 새 객체다 (모르는 필드·거대한 문자열·엉뚱한 타입은 순위표 파일에 들어가지 않는다).

class Invalid extends Error {}
const obj = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Invalid();
  return v as Record<string, unknown>;
};
const str = (v: unknown, max: number, pattern?: RegExp): string => {
  if (typeof v !== "string" || v.length > max || (pattern && !pattern.test(v))) throw new Invalid();
  return v;
};
const bool = (v: unknown): boolean => {
  if (typeof v !== "boolean") throw new Invalid();
  return v;
};
const int = (v: unknown, min: number, max: number): number => {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) throw new Invalid();
  return v;
};
const list = <T>(v: unknown, max: number, item: (x: unknown) => T): T[] => {
  if (!Array.isArray(v) || v.length > max) throw new Invalid();
  return v.map(item);
};
const TOKEN = /^[A-Za-z0-9._:-]+$/;
/** 파일 이름에서 온 에이전트 이름. 엔진이 시작할 때 이 문자들로 정리한다 (agentName) */
const AGENT_NAME = /^[A-Za-z0-9._-]+$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const LANGS = ["ko", "en"];
const MODES = ["ranked", "quick"];
const DIVISIONS = ["light", "middle", "open"];
const BACKENDS = ["cli", "api"];
const MODELS = ["haiku", "sonnet", "opus"];
const DECIDERS = ["detector", "interviewer"];
/** 정해 둔 값 중 하나만 받는다. 엔진이 이 값으로 표를 찾으므로 프로토타입 키 같은 값이 들어오면 안 된다 */
const oneOf = (v: unknown, allowed: readonly string[]): string => {
  if (typeof v !== "string" || !allowed.includes(v)) throw new Invalid();
  return v;
};
const optToken = (v: unknown, max: number): string | undefined => (v === undefined || v === null ? undefined : str(v, max, TOKEN));
/**
 * 판정의 target 은 면접관 모델이 적는 자유 문자열이다 ("S1-a", "T1", 가끔 "S1-a, S1-b" 나 빈 값).
 * 점수 계산이 이 값을 그대로 키로 쓰므로 바꾸거나 버리면 정직한 제출의 점수가 안 맞는다.
 * 그래서 모양은 묻지 않고 길이와 제어 문자만 막는다 (저장본은 JSON 으로 이스케이프되고 화면에 나오지 않는다).
 */
const PRINTABLE = /^[^\u0000-\u001f\u007f]*$/;
const verdict = (v: unknown): Verdict => {
  const o = obj(v);
  const result = str(o.result, 5);
  if (result !== "true" && result !== "false" && result !== "na") throw new Invalid();
  const out: Verdict = {
    id: str(o.id, 40, TOKEN), result,
    evidence: o.evidence === null || o.evidence === undefined ? null : str(o.evidence, 4000), reason: str(o.reason, 4000),
  };
  if (o.target !== undefined && o.target !== null) out.target = str(o.target, 60, PRINTABLE);
  if (o.excluded !== undefined) out.excluded = bool(o.excluded);
  // 제외된 판정은 인용 검사를 건너뛰므로, 점수에 들어가는 결과(true/false)를 달 수 없다
  if (out.excluded && out.result !== "na") throw new Invalid();
  return out;
};
const verdicts = (v: unknown) => list(v, 200, verdict);

function withBan(stage: { banned?: string }, raw: Record<string, unknown>): void {
  const banned = optToken(raw.banned, 40);
  if (banned !== undefined) stage.banned = banned;
}

/** 형식이 맞으면 정해 둔 필드만 담은 새 제출물, 아니면 null */
export function canonicalSubmission(raw: unknown): Submission | null {
  try {
    const o = obj(raw);
    const options = obj(o.options);
    const run = obj(o.run);
    const st = obj(o.stages);
    const security = obj(st.security);
    const reached = str(o.reached, 10);
    if (!(STAGE_ORDER as readonly string[]).includes(reached)) throw new Invalid();
    const createdAt = str(o.createdAt, 40, ISO_TIME);
    if (Number.isNaN(Date.parse(createdAt))) throw new Invalid();
    const sub: Submission = {
      schema: int(o.schema, 0, 1000), arenaVersion: str(o.arenaVersion, 20, TOKEN), promptsHash: str(o.promptsHash, 64), createdAt,
      agent: str(o.agent, 100, AGENT_NAME), md: str(o.md, 64 * 1024), mdHash: str(o.mdHash, 128),
      options: {
        lang: oneOf(options.lang, LANGS), mode: oneOf(options.mode, MODES),
        target: oneOf(options.target, TARGETS), division: oneOf(options.division, DIVISIONS),
      },
      run: {
        engine: oneOf(run.engine, MODELS), interviewer: oneOf(run.interviewer, MODELS),
        generator: oneOf(run.generator, MODELS), backend: oneOf(run.backend, BACKENDS),
      },
      reached: reached as Submission["reached"], hired: bool(o.hired),
      stages: { security: { passed: bool(security.passed) } },
    };
    const rule = optToken(security.rule, 40);
    if (rule !== undefined) sub.stages.security.rule = rule;
    if (st.doc !== undefined) {
      const d = obj(st.doc);
      sub.stages.doc = { passed: bool(d.passed), score: int(d.score, -1000, 1000), verdicts: verdicts(d.verdicts) };
      withBan(sub.stages.doc, d);
    }
    if (st.r1 !== undefined) {
      const d = obj(st.r1);
      sub.stages.r1 = { passed: bool(d.passed), score: int(d.score, -1000, 1000), verdicts: verdicts(d.verdicts), violationCount: int(d.violationCount, 0, 1000) };
      withBan(sub.stages.r1, d);
    }
    if (st.r2 !== undefined) {
      const d = obj(st.r2);
      sub.stages.r2 = { passed: bool(d.passed), score: int(d.score, -1000, 1000), verdicts: verdicts(d.verdicts), scenarioIds: list(d.scenarioIds, 20, x => str(x, 40, TOKEN)) };
      if (d.runKeys !== undefined) sub.stages.r2.runKeys = list(d.runKeys, 40, x => str(x, 40, TOKEN));
      withBan(sub.stages.r2, d);
    }
    if (st.final !== undefined) {
      const d = obj(st.final);
      sub.stages.final = {
        passed: bool(d.passed),
        attacks: list(d.attacks, 10, a => {
          const x = obj(a);
          return { category: str(x.category, 40, TOKEN), defended: bool(x.defended), decided_by: oneOf(x.decided_by, DECIDERS) };
        }),
      };
      withBan(sub.stages.final, d);
    }
    return sub;
  } catch {
    return null;
  }
}

const STAGE_ORDER = ["security", "doc", "r1", "r2", "final"] as const;

/** 1차 과제. 판정의 target 은 응답 이름(T1-a, T1-b, T2, T3)이거나 과제 이름(R1-7 의 "T1")이다 */
const R1_TASKS = ["T1", "T2", "T3"];
/** 2차 시나리오. 엔진은 세 개가 모두 있어야 2차를 연다 */
const R2_SCENARIOS = ["S1", "S2", "S3"];

/**
 * 단계마다 꼭 있어야 하는 모양: 그 단위(과제·시나리오)의 판정에 빠짐없이 있어야 하는 항목.
 * 엔진이 빠진 항목을 채점 제외로 채우므로 정직한 결과는 다 있다.
 * 이 검사들은 "엔진이 만든 결과와 모양이 다른 제출"을 거르는 일관성 검사다. 지원자 응답이 제출물에 없으므로
 * 모든 판정을 true 로 적은 위조는 막지 못한다 (README). 그래서 정직한 결과를 거절할 위험이 있는 조건은 두지 않는다.
 */
type Shape = { units: string[]; itemId: RegExp; each: (unit: string) => string[] };
const R1_SHAPE: Shape = { units: R1_TASKS, itemId: R1_ITEM_ID, each: u => (u === "T1" ? [...R1_PER_RESPONSE, "R1-7"] : R1_PER_RESPONSE) };
const r2Shape = (scenarioIds: string[]): Shape => ({ units: scenarioIds, itemId: R2_ITEM_ID, each: () => R2_PER_RUN });
/**
 * 과제·시나리오 하나에 점수로 셈하는(true/false) 서로 다른 항목이 이만큼은 있어야 한다. 1·2차 항목은 응답마다 6개 안팎이다.
 * 항목 하나만 true 로 넣으면 나머지가 분모에서 빠져 만점이 되는 위조를 막는다. 면접관이 몇 개나 한 회차를 통째로
 * 빠뜨린 정직한 결과는 걸리지 않게, 회차가 아니라 과제·시나리오 단위로 세고 수도 낮게 둔다.
 */
const MIN_COUNTED_PER_UNIT = 3;

/**
 * 판정 묶음의 모양 검사. 같은 (target, 항목)이 두 번 있으면 비율이 부풀므로 받지 않는다.
 * 1·2차 판정의 근거는 지원자 응답을 인용하는데 응답은 제출물에 없어 대조할 수 없다. 그래서 단위마다 셈하는 항목이 충분한지만 본다.
 */
function verdictShape(stage: string, vs: Verdict[], shape: Shape): string[] {
  const keys = vs.map(v => `${v.target ?? ""}\0${v.id}`);
  if (new Set(keys).size !== keys.length) return [`${stage} has the same verdict twice`];
  // 모르는 항목 id 는 점수 계산에서 어느 영역에도 안 들어가거나(무시) 엉뚱한 영역에 섞인다
  if (vs.some(v => !shape.itemId.test(v.id))) return [`${stage} has an item that is not on the checklist`];
  const inUnit = (v: Verdict, u: string) => v.target === u || !!v.target?.startsWith(`${u}-`);
  const p: string[] = [];
  for (const u of shape.units) {
    const mine = vs.filter(v => inUnit(v, u));
    const scored = mine.filter(v => v.result !== "na");
    if (shape.each(u).some(id => !mine.some(v => v.id === id))) p.push(`${stage} does not cover every item for ${u} (the interviewers left it out; re-run the interview)`);
    else if (new Set(scored.map(v => v.id)).size < MIN_COUNTED_PER_UNIT) p.push(`${stage} has too few verdicts for ${u} (the interviewers left it out; re-run the interview)`);
  }
  return p;
}

/**
 * 1·2차에서 면접관이 평가 공격을 잡아 실격시켰고, 셈한 판정이 하나도 없는 단계 (출제 중 실격, 또는 면접관이 판정 없이 실격만 낸 경우).
 * 0점 탈락이라 모양을 물을 판정이 없다. 판정이 있는 실격은 평소처럼 검사한다 (실격 표시만 붙여 모양 검사를 건너뛰는 위조를 막는다).
 * 서류는 실격돼도 판정이 다 있으므로 면제하지 않는다.
 */
const stoppedEarly = (st: { banned?: string; verdicts: Verdict[]; score: number }) => !!st.banned && st.score === 0 && st.verdicts.every(v => v.excluded);

/**
 * 서류 판정이 체크리스트를 빠짐없이 덮는가. 엔진은 면접관이 빠뜨린 항목도 "채점 제외"로 채워 내므로 정직한 결과는 항상 다 있다.
 * 모르는 항목 id(D2-9 같은)는 그 영역 점수에 섞이므로 받지 않는다. 셈하는 D 항목이 절반은 되어야 한다.
 */
let docChecklist: ReturnType<typeof parseChecklist> | undefined;
let attackSelection: { mandatory: string[]; random_one_of: string[] } | undefined;
function docShape(vs: Verdict[], target: string): string[] {
  // 엔진 번들에도 이 파일이 들어가므로 시작할 때가 아니라 검증할 때 한 번 읽는다
  const DOC_CHECKLIST = (docChecklist ??= parseChecklist(ASSETS["prompts/interviewer_doc_screening.md"]));
  const ids = vs.map(v => v.id);
  if (new Set(ids).size !== ids.length) return ["Document screening has the same item twice"];
  if (ids.some(id => !DOC_CHECKLIST.has(id))) return ["Document screening has an item that is not on the checklist"];
  const required = requiredDocIds(DOC_CHECKLIST, target);
  if (required.some(id => !ids.includes(id))) return ["Document screening does not cover every checklist item"];
  const dIds = required.filter(id => id.startsWith("D"));
  const counted = vs.filter(v => v.id.startsWith("D") && v.result !== "na").length;
  return counted * 2 < dIds.length ? ["Document screening has too few scored items"] : [];
}

/** LLM 없이 하는 검사. 문제 목록이 비면 통과다. */
export function verifySubmission(sub: Submission, acceptedPromptHashes: string[]): string[] {
  const p: string[] = [];
  if (sub?.schema !== SUBMISSION_SCHEMA) return ["Unknown submission format"];
  if (typeof sub.md !== "string" || sub.md.length === 0) return ["The agent spec is missing"];
  if (sub.md.replace(/\s/g, "").length < MIN_MD_CHARS) p.push(`The agent spec is shorter than ${MIN_MD_CHARS} characters`);
  if (Buffer.byteLength(sub.md) > 64 * 1024) p.push("The agent spec is larger than 64 KB");
  if (mdHash(sub.md) !== sub.mdHash) p.push("The document hash does not match the spec");
  if (!acceptedPromptHashes.includes(sub.promptsHash)) p.push(`Interviewer prompt version is not accepted (${/^[0-9a-f]{16}$/.test(String(sub.promptsHash)) ? sub.promptsHash : "invalid"}). Update the skill and re-run.`);
  if (sub.options?.mode !== "ranked") p.push("Practice (quick) mode results cannot be submitted");
  if (!["light", "middle", "open"].includes(sub.options?.division)) p.push("Unknown division");
  else if (sub.run?.engine !== DIVISION_ENGINE[sub.options.division as keyof typeof DIVISION_ENGINE]) p.push("The candidate model does not match the division");
  if (!STAGE_ORDER.includes(sub.reached)) p.push("Unknown reached stage");

  // 보안 검문소의 코드 규칙은 공짜로 다시 돌릴 수 있다
  const gate = runSecurityGate(sub.md);
  // 검문소에서 실격된 명세는 순위표에 올릴 이유가 없고, 받으면 아무 텍스트나 저장소에 남기는 통로가 된다
  if (gate.verdict === "BANNED" || !sub.stages.security.passed) p.push(`The spec does not pass the security checkpoint${gate.verdict === "BANNED" ? ` (rule ${gate.rule})` : ""}; such results are not listed`);

  const { doc, r1, r2, final } = sub.stages;
  // 앞 단계를 통과해야 뒤 단계 결과가 있을 수 있다
  const chain: [string, { passed: boolean } | undefined, { passed: boolean } | undefined][] = [
    ["doc", sub.stages.security, doc], ["r1", doc, r1], ["r2", r1, r2], ["final", r2, final],
  ];
  for (const [name, prev, cur] of chain) if (cur && !prev?.passed) p.push(`There is a ${name} result although the previous stage was not passed`);
  const reachedIdx = STAGE_ORDER.indexOf(sub.reached);
  for (const [i, name] of STAGE_ORDER.entries()) {
    const present = name === "security" ? true : !!sub.stages[name];
    if (present !== i <= reachedIdx) p.push(`The reached stage does not match whether a ${name} result exists`);
  }

  // 면접관이 평가 공격을 잡아 실격시킨 단계는 판정이 도중에 끊긴다. 불합격으로 끝나므로 판정 모양은 묻지 않는다
  if (doc) {
    p.push(...docShape(doc.verdicts, sub.options.target));
    const kept = doc.verdicts.filter(v => !v.excluded);
    if (excludeUnverified(kept, [sub.md]).excluded > 0) p.push("Document screening evidence quotes are not in the spec");
    if (scoreDoc(doc.verdicts, sub.options.target).score !== doc.score) p.push("Document screening score does not match its verdicts");
    if (doc.passed !== (!doc.banned && doc.score >= PASS_LINE.doc)) p.push("Document screening pass/fail does not match its score");
  }
  if (r1) {
    if (!stoppedEarly(r1)) p.push(...verdictShape("Round 1", r1.verdicts, R1_SHAPE));
    if (scoreRound1(r1.verdicts, r1.violationCount).score !== r1.score) p.push("Round 1 score does not match its verdicts");
    if (r1.passed !== (!r1.banned && r1.score >= PASS_LINE.r1)) p.push("Round 1 pass/fail does not match its score");
  }
  if (r2) {
    const early = stoppedEarly(r2);
    // 출제 중 실격이면 시나리오가 없다. 시나리오가 있으면 셋이 다 있어야 한다
    const noScenarios = early && r2.scenarioIds.length === 0 && (r2.runKeys?.length ?? 0) === 0;
    if (!noScenarios && (r2.scenarioIds.length !== R2_SCENARIOS.length || R2_SCENARIOS.some(id => !r2.scenarioIds.includes(id)))) p.push("Round 2 does not have the three scenarios S1 ~ S3");
    if (scoreRound2(r2.verdicts, r2.scenarioIds).score !== r2.score) p.push("Round 2 score does not match its verdicts");
    if (r2.passed !== (!r2.banned && r2.score >= PASS_LINE.r2)) p.push("Round 2 pass/fail does not match its score");
    // 랭크전은 시나리오마다 두 번(-a, -b) 돌린다. 한 번씩만 돈 연습 결과를 랭크로 바꿔 낸 제출을 거른다.
    // 면접관이 한 회차 판정을 빠뜨려도 정직한 제출이 걸리지 않게, 판정이 아니라 실행 기록(runKeys)을 본다
    if (!r2.runKeys) p.push("This result was made by an older version of the skill. Update the skill and re-run the interview.");
    else {
      const runs = new Set(r2.runKeys);
      if (r2.scenarioIds.some(id => !runs.has(`${id}-a`) || !runs.has(`${id}-b`))) p.push("Round 2 was not run twice per scenario, as ranked mode requires");
      if (!early) p.push(...verdictShape("Round 2", r2.verdicts, r2Shape(r2.scenarioIds)));
    }
  }
  if (final) {
    // 공격 편성: 필수 네 범주 + 나머지 범주 중 하나. 같은 범주를 여러 번 넣어 쉬운 공격만 받은 척하는 제출을 거른다
    const sel = (attackSelection ??= (JSON.parse(ASSETS["prompts/red_team_attack_pool.json"]) as { selection: { mandatory: string[]; random_one_of: string[] } }).selection);
    const cats = final.attacks.map(a => a.category);
    // 다섯 범주가 서로 다르고 필수 넷이 다 있으면 남는 하나가 무작위 범주다
    const extra = cats.find(c => !sel.mandatory.includes(c));
    if (final.attacks.length !== 5) p.push("The final does not have 5 attacks");
    else if (new Set(cats).size !== 5 || sel.mandatory.some(c => !cats.includes(c)) || !sel.random_one_of.includes(extra ?? "")) {
      p.push("The final attacks do not match the attack selection rules");
    }
    // 검사기(코드)가 정한 공격은 공격 표식이 응답에 나왔다는 뜻이라 항상 뚫린 것이다
    if (final.attacks.some(a => a.decided_by === "detector" && a.defended)) p.push("A final attack decided by the code detector cannot be defended");
    if (final.passed !== (!final.banned && final.attacks.every(a => a.defended))) p.push("Final pass/fail does not match the attack results");
  }
  if (sub.hired !== !!final?.passed) p.push("The hired flag does not match the final result");
  return p;
}

// ---------------------------------------------------------------- 순위표 파일

const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const DOCS = join(ROOT, "docs");
export const SUBS = join(DOCS, "submissions");

export type BoardEntry = {
  id: string; author: string; issue: number; agent: string; mdHash: string; division: string; engine: string; target: string; lang: string;
  backend: string; reached: string; hired: boolean; tier: "self-reported" | "verified";
  doc: number | null; r1: number | null; r2: number | null; defended: number | null;
  /** Issue 가 열린 시각 (GitHub 값). 동점일 때 먼저 낸 순서를 이 값으로 정한다 */
  submittedAt: string; arenaVersion: string;
};

/** 순위: 검증 등급(verified 먼저) → 도달 단계 → 합격 → 최종 방어 수 → 2차 → 1차 → 서류 → 먼저 낸 순 */
export function rankEntries(entries: BoardEntry[]): BoardEntry[] {
  const idx = (s: string) => STAGE_ORDER.indexOf(s as (typeof STAGE_ORDER)[number]);
  const tier = (e: BoardEntry) => (e.tier === "verified" ? 1 : 0);
  return [...entries].sort((a, b) =>
    tier(b) - tier(a) || idx(b.reached) - idx(a.reached) || Number(b.hired) - Number(a.hired) || (b.defended ?? -1) - (a.defended ?? -1) || (b.r2 ?? -1) - (a.r2 ?? -1) ||
    (b.r1 ?? -1) - (a.r1 ?? -1) || (b.doc ?? -1) - (a.doc ?? -1) || a.submittedAt.localeCompare(b.submittedAt));
}

/** submittedAt 은 제출물의 createdAt(제출자가 적는 값)이 아니라 Issue 생성 시각을 쓴다 */
export function toEntry(id: string, author: string, issue: number, issueCreatedAt: string, sub: Submission): BoardEntry {
  return {
    id, author, issue, agent: sub.agent.slice(0, 80), mdHash: sub.mdHash, division: sub.options.division, engine: sub.run.engine,
    target: sub.options.target, lang: sub.options.lang, backend: sub.run.backend, reached: sub.reached, hired: sub.hired, tier: "self-reported",
    doc: sub.stages.doc?.score ?? null, r1: sub.stages.r1?.score ?? null, r2: sub.stages.r2?.score ?? null,
    defended: sub.stages.final ? sub.stages.final.attacks.filter(a => a.defended).length : null,
    submittedAt: issueCreatedAt, arenaVersion: sub.arenaVersion,
  };
}

/**
 * 저장소에 남길 형태. 검증용이 아니다: 근거 문장을 비웠으므로 이 저장본으로 verifySubmission 을 다시 돌리면 실패한다.
 * 검증이 끝난 뒤에는 면접관 문장(근거·이유)이 필요 없으므로 판정은 id·결과만 남긴다.
 * 누구나 다시 돌려 볼 수 있게 명세 원문과 설정은 그대로 둔다. 제출자가 적은 긴 문장이 저장소에 쌓이지 않게 하려는 것이다.
 */
export function storedSubmission(sub: Submission): Submission {
  const slim = (vs: Verdict[]): Verdict[] => vs.map(v => ({ id: v.id, result: v.result, evidence: null, reason: "", ...(v.target ? { target: v.target } : {}) }));
  const { doc, r1, r2 } = sub.stages;
  return {
    ...sub,
    stages: {
      ...sub.stages,
      ...(doc && { doc: { ...doc, verdicts: slim(doc.verdicts) } }),
      ...(r1 && { r1: { ...r1, verdicts: slim(r1.verdicts) } }),
      ...(r2 && { r2: { ...r2, verdicts: slim(r2.verdicts) } }),
    },
  };
}

/**
 * 순위표 한 칸의 주인: 작성자 × 체급. 문서를 조금씩 바꿔 같은 사람이 여러 칸을 차지하지 못하게,
 * 한 사람은 체급마다 가장 좋은 기록 하나만 올라간다.
 */
export const slotOf = (e: Pick<BoardEntry, "author" | "division">) => `${e.author.toLowerCase()}\0${e.division}`;

/** a 가 b 보다 순위가 높은가 (같으면 false) */
export const ranksAbove = (a: BoardEntry, b: BoardEntry) => rankEntries([b, a])[0] === a && rankEntries([a, b])[0] === a;

export function readEntries(): BoardEntry[] {
  return existsSync(SUBS)
    ? readdirSync(SUBS).filter(f => f.endsWith(".json")).map(f => JSON.parse(readFileSync(join(SUBS, f), "utf8")).entry as BoardEntry)
    : [];
}

export function rebuildBoard(): BoardEntry[] {
  const best = new Map<string, BoardEntry>();
  for (const e of rankEntries(readEntries())) if (!best.has(slotOf(e))) best.set(slotOf(e), e);
  const ranked = rankEntries([...best.values()]);
  mkdirSync(DOCS, { recursive: true });
  writeFileSync(join(DOCS, "leaderboard.json"), `${JSON.stringify({ updatedAt: new Date().toISOString(), entries: ranked }, null, 2)}\n`);
  return ranked;
}

export function acceptedHashes(): string[] {
  const f = join(ROOT, "leaderboard", "accepted_prompts.json");
  const listed = existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as { hashes: string[] }).hashes : [];
  return [...new Set([promptsHash(), ...listed])];
}
