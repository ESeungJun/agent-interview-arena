// 스킬이 부르는 면접 CLI. 한 번에 한 단계씩 돌려 스킬이 단계 사이에 장면을 보여 줄 수 있게 한다.
//   arena start <agent.md> [--lang ko|en] [--mode ranked|quick] [--target claude|gpt|gpt-reasoning|gemini|generic] [--division light|middle|open]
//                            체급을 주지 않으면 명세 frontmatter 의 model: 로 정하고, 없으면 middle(Sonnet)
//                            --repeat N: 같은 시험을 N 판 볼 계획임을 기록한다 (판마다 arena again 으로 이어 본다)
//   arena next <session>      다음 단계 하나를 본다
//   arena again <session>     같은 명세·같은 시험으로 한 판 더 본다 (합격률을 재는 재면접). 서류전형까지 돌린다
//   arena submit <session> [--unverified]   순위표 제출물을 만든다. --unverified: 응답 원문 없이 (미검증으로 오른다)
//   arena status <session>    지금까지의 결과
//   arena list                최근 면접 목록
//   arena doctor              실행 환경 점검 (Node 버전, claude 로그인 수단, API 키 유무, gh). 모델은 부르지 않는다
// 표준 출력에는 JSON 한 덩어리만 낸다(스킬이 읽는다). 진행 로그는 표준 오류와 live.jsonl(대기실 패널이 읽는다)로 보낸다.
// 저장 위치: $ARENA_HOME 또는 ~/.agent-interview-arena
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { PACKAGE_VERSION } from "../core/assets.generated.ts";
import { DIVISIONS, pickDivision, type DivisionSource } from "../core/division.ts";
import { mdHash } from "../core/exam.ts";
import { nextChallenge, runChallenge, type Challenge, type ChallengeReport, type StageResults } from "../core/interview.ts";
import type { Lang } from "../core/prompts.ts";
import { PASS_LINE, TARGETS } from "../core/scoring.ts";
import { localLlm } from "./cli_engine.ts";
import { fsExamStore } from "./fs_exam_store.ts";
import {
  agentName, BODY_MARKER_END, BODY_MARKER_START, buildSubmission, canonicalSubmission, encodeSubmission, MAX_PAYLOAD_CHARS, MIN_MD_CHARS,
  promptsHash, SUBMISSION_SCHEMA, verifySubmission,
} from "./board.ts";
import { MAX_REPEAT, repeatStats } from "./repeat.ts";
import { summarizeStage, type StageSummary } from "./summary.ts";

const BOARD_REPO = "ESeungJun/agent-interview-arena";

/** 면접 기록과 순위표 제출물에 남는 엔진 버전. package.json 의 version 에서 생성된다 (runner/bundle_assets.ts) */
export const ARENA_VERSION = PACKAGE_VERSION;
const HOME = process.env.ARENA_HOME ?? join(homedir(), ".agent-interview-arena");
const SESSIONS = join(HOME, "sessions");
const LIVE = join(HOME, "live.jsonl");
const MAX_MD_BYTES = 64 * 1024;

type Mode = "ranked" | "quick";
export type SessionState = {
  version: string; session: string; agent: string; mdPath: string; mdHash: string; md: string;
  createdAt: string; options: { lang: Lang; mode: Mode; target: string; division: string };
  stages: StageResults; reports: ChallengeReport[];
  /** 체급을 정한 근거와 명세에 적힌 model: 값. 이 기능 전에 시작한 세션에는 없다 */
  divisionSource?: DivisionSource; specModel?: string | null;
  /** 면접을 시작할 때의 면접관 프롬프트 지문. 이 기능 전에 시작한 세션에는 없다 */
  promptsHash?: string;
  /** 재면접 묶음: 같은 명세로 같은 시험을 여러 판 본 세션들이 공유하는 ID (첫 판의 세션 ID). 한 판만 봤으면 없다 */
  group?: string;
  /** 이 묶음에서 보려는 판 수 (--repeat N). 없으면 정해 두지 않은 것 */
  repeatTarget?: number;
};

function loadAllStates(): SessionState[] {
  if (!existsSync(SESSIONS)) return [];
  return readdirSync(SESSIONS).filter(d => existsSync(statePath(d))).flatMap(d => {
    try {
      const s = JSON.parse(readFileSync(statePath(d), "utf8")) as SessionState;
      // 모양이 틀린 기록(다른 프로그램이 쓴 파일, 쓰다 만 파일)은 건너뛴다
      const ok = !!s && typeof s === "object" && typeof s.session === "string" && typeof s.createdAt === "string"
        && !!s.options && typeof s.options === "object" && !!s.stages && typeof s.stages === "object" && Array.isArray(s.reports);
      return ok ? [s] : [];
    } catch {
      return []; // 손상된 기록 하나 때문에 전체가 멈추지 않게 한다
    }
  });
}

function out(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function fail(code: string, message: string, extra: Record<string, unknown> = {}): never {
  out({ error: code, message, ...extra });
  process.exit(1);
}

/** 대기실 패널이 읽는 이벤트. 패널이 없어도 파일만 쌓이고, 쓰기에 실패해도 면접은 계속한다. */
function emit(event: Record<string, unknown>): void {
  try {
    mkdirSync(HOME, { recursive: true });
    appendFileSync(LIVE, `${JSON.stringify({ ts: new Date().toISOString(), ...event })}\n`);
  } catch {
    // 패널 연출용 기록이라 실패해도 무시한다
  }
}

const statePath = (session: string) => join(SESSIONS, session, "state.json");

function loadState(session: string): SessionState {
  if (!/^[a-z0-9-]{6,40}$/.test(session)) fail("bad_session", `세션 ID 형식이 아닙니다: ${session}`);
  const f = statePath(session);
  if (!existsSync(f)) fail("no_session", `세션이 없습니다: ${session}`);
  return JSON.parse(readFileSync(f, "utf8")) as SessionState;
}

function saveState(s: SessionState): void {
  mkdirSync(join(SESSIONS, s.session), { recursive: true });
  writeFileSync(statePath(s.session), JSON.stringify(s, null, 2));
}

/** 면접을 본 뒤 파일이 바뀌었는가 (파일이 지워졌으면 저장해 둔 원문으로 계속한다) */
function mdChanged(s: SessionState): boolean {
  return existsSync(s.mdPath) && mdHash(readFileSync(s.mdPath, "utf8")) !== s.mdHash;
}

function readAgent(path: string): string {
  const p = resolve(path);
  if (!existsSync(p)) fail("no_file", `파일이 없습니다: ${p}`);
  if (statSync(p).size > MAX_MD_BYTES) fail("too_large", `파일이 ${MAX_MD_BYTES / 1024}KB를 넘습니다.`);
  const md = readFileSync(p, "utf8");
  // 빈 파일이나 몇 글자뿐인 파일은 면접할 내용이 없다. 모델을 부르기 전에 거절한다
  if (md.replace(/\s/g, "").length < MIN_MD_CHARS) fail("too_short", `에이전트 명세가 비어 있거나 너무 짧습니다 (공백 제외 ${MIN_MD_CHARS}자 이상).`);
  return md;
}

async function runStage(s: SessionState, challenge: Challenge): Promise<StageSummary> {
  emit({ event: "stage_start", session: s.session, agent: s.agent, stage: challenge, mode: s.options.mode });
  const report = await runChallenge({
    md: s.md, llm: localLlm(), examStore: fsExamStore(join(HOME, "exams")),
    target: s.options.target, division: s.options.division, interviewer: "haiku", generator: "sonnet",
    // 랭크전은 순위표에 오를 수 있으므로 정규식에 안 걸린 명세도 분류 모델이 전수로 본다 (연습은 10% 표본)
    screenAll: s.options.mode === "ranked", outputLanguage: s.options.lang, quick: s.options.mode === "quick",
    log: msg => {
      process.stderr.write(`${msg}\n`);
      emit({ event: "log", session: s.session, stage: challenge, message: msg });
    },
  }, challenge, s.stages);
  Object.assign(s.stages, report.stages);
  s.reports.push(report);
  saveState(s);
  const summary = summarizeStage(challenge, report, s.stages);
  emit({
    event: "stage_end", session: s.session, agent: s.agent, stage: challenge, passed: summary.passed,
    score: summary.score ?? null, banned: !!summary.securityBan, persona: summary.persona ?? null, next: nextChallenge(s.stages),
  });
  if (!nextChallenge(s.stages)) emit({ event: "session_end", session: s.session, agent: s.agent, result: report.result, hired: challenge === "final" && summary.passed });
  return summary;
}

/**
 * 순위표 봇과 같은 검사를 로컬에서 돌린 결과. 걸릴 결과면 submittable 을 끄고 submit 도 Issue 를 만들기 전에 멈춘다.
 * 프롬프트 버전은 봇이 받는 목록을 여기서 알 수 없으므로 봇에 맡긴다 (그래서 이 세션의 지문을 그대로 넘긴다).
 */
function localProblems(s: SessionState, withEvidence = true): string[] {
  // 지문이 없는 세션은 어느 프롬프트 버전으로 채점했는지 알 수 없다 (이 기능 전에 시작한 세션)
  if (!s.promptsHash) return ["This interview was started by an older version of the skill. Re-run the interview to submit."];
  try {
    const canon = canonicalSubmission(JSON.parse(JSON.stringify(buildSubmission(s, ARENA_VERSION, { withEvidence }))));
    return canon ? verifySubmission(canon, [canon.promptsHash]) : ["The submission is not in the expected format"];
  } catch {
    // 옛 형식이거나 손상된 기록 하나 때문에 list 전체가 멈추지 않게 한다
    return ["This session's record cannot be checked (old or damaged format). Re-run the interview to submit."];
  }
}

/** 면접을 시작한 뒤 스킬이 업데이트되어 면접관 프롬프트가 바뀌었는가 (이 기능 전에 시작한 세션은 알 수 없어 false) */
const promptsChanged = (s: SessionState) => !!s.promptsHash && s.promptsHash !== promptsHash();

function sessionOverview(s: SessionState, all: SessionState[] = loadAllStates()) {
  const next = nextChallenge(s.stages);
  // 방금 저장한 이 세션의 상태가 목록의 것보다 새롭다
  const repeat = repeatStats(s, [...all.filter(o => o.session !== s.session), s]);
  const submitProblems = next !== null || s.options.mode !== "ranked" ? null
    : promptsChanged(s) ? ["The skill was updated after this interview started; re-run the interview"] : localProblems(s);
  return {
    session: s.session, agent: s.agent, createdAt: s.createdAt, mode: s.options.mode, lang: s.options.lang, target: s.options.target, division: s.options.division,
    divisionSource: s.divisionSource ?? null, specModel: s.specModel ?? null,
    passLines: PASS_LINE, next, finished: next === null,
    hired: !!s.stages.final?.passed,
    // 끝난 랭크전 중 순위표 검사를 통과할 결과만 (검문소 실격 등은 봇이 받지 않는다). 못 내는 이유는 submitProblems 에
    submittable: submitProblems !== null && submitProblems.length === 0,
    submitProblems,
    // 재면접 묶음의 합격률 (한 판만 봤고 --repeat 도 없으면 null)
    repeat,
    resultFile: statePath(s.session),
  };
}

/** 번들은 Node 20 문법으로 빌드한다. 더 낮은 버전에서는 알아보기 어려운 오류 대신 한 줄 JSON 으로 알린다 */
const MIN_NODE_MAJOR = 20;

async function main(): Promise<void> {
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (nodeMajor < MIN_NODE_MAJOR) fail("old_node", `Node ${MIN_NODE_MAJOR} 이상이 필요합니다 (지금 ${process.versions.node}).`);
  const [command, ...rest] = process.argv.slice(2);
  const { values, positionals } = parseArgs({
    args: rest, allowPositionals: true,
    options: {
      lang: { type: "string", default: "en" },
      mode: { type: "string", default: "ranked" },
      target: { type: "string", default: "claude" },
      division: { type: "string" },
      repeat: { type: "string" },
      unverified: { type: "boolean", default: false },
    },
  });

  if (command === "start") {
    const [path] = positionals;
    if (!path) fail("usage", "사용법: arena start <agent.md> [--lang ko|en] [--mode ranked|quick]");
    const md = readAgent(path);
    const lang: Lang = values.lang === "ko" ? "ko" : "en";
    const mode: Mode = values.mode === "quick" ? "quick" : "ranked";
    if (!TARGETS.includes(values.target!)) fail("bad_target", `알 수 없는 target: ${values.target}`);
    if (values.division !== undefined && !(DIVISIONS as readonly string[]).includes(values.division)) fail("bad_division", `알 수 없는 division: ${values.division}`);
    const picked = pickDivision(md, values.division);
    let repeatTarget: number | undefined;
    if (values.repeat !== undefined) {
      repeatTarget = Number(values.repeat);
      if (!Number.isInteger(repeatTarget) || repeatTarget < 2 || repeatTarget > MAX_REPEAT) fail("bad_repeat", `--repeat 는 2 ~ ${MAX_REPEAT} 사이의 정수입니다: ${values.repeat}`);
    }
    const s: SessionState = {
      version: ARENA_VERSION, session: `${new Date().toISOString().slice(0, 10)}-${randomBytes(4).toString("hex")}`,
      agent: agentName(path), mdPath: resolve(path), mdHash: mdHash(md), md, createdAt: new Date().toISOString(),
      options: { lang, mode, target: values.target!, division: picked.division }, stages: {}, reports: [],
      divisionSource: picked.source, specModel: picked.specModel, promptsHash: promptsHash(),
      ...(repeatTarget ? { repeatTarget } : {}),
    };
    saveState(s);
    // 패널은 마지막 세션만 보므로 새 면접마다 기록을 새로 시작한다 (파일이 끝없이 커지지 않게)
    try {
      mkdirSync(HOME, { recursive: true });
      writeFileSync(LIVE, "");
    } catch {
      // 패널 연출용 기록이라 실패해도 면접은 계속한다
    }
    const stage = await runStage(s, "doc");
    out({ ...sessionOverview(s), stage });
    return;
  }

  if (command === "next") {
    const s = loadState(positionals[0] ?? "");
    // 앞 단계 결과는 그 .md 로 받은 것이다. 파일이 바뀌었으면 이어서 볼 수 없다 (다른 문서로 받은 합격을 끌어오지 못하게)
    if (mdChanged(s)) {
      fail("md_changed", "면접을 시작한 뒤 에이전트 파일이 바뀌었습니다. 고친 파일로 새 면접을 시작하세요.", { session: s.session });
    }
    // 단계마다 다른 프롬프트로 채점된 결과가 한 기록으로 섞이지 않게 한다
    if (promptsChanged(s)) {
      fail("prompts_changed", "면접을 시작한 뒤 스킬이 업데이트되어 면접관 프롬프트가 바뀌었습니다. 새 면접을 시작하세요.", { session: s.session });
    }
    const challenge = nextChallenge(s.stages);
    if (!challenge) fail("finished", "더 볼 단계가 없습니다.", sessionOverview(s));
    const stage = await runStage(s, challenge);
    out({ ...sessionOverview(s), stage });
    return;
  }

  if (command === "again") {
    const prev = loadState(positionals[0] ?? "");
    // 같은 시험을 다시 보는 것이라, 명세나 프롬프트가 바뀌었으면 묶을 수 없다
    if (mdChanged(prev)) fail("md_changed", "면접을 본 뒤 에이전트 파일이 바뀌었습니다. 고친 파일로 새 면접을 시작하세요.", { session: prev.session });
    if (promptsChanged(prev)) fail("prompts_changed", "면접을 본 뒤 스킬이 업데이트되어 면접관 프롬프트가 바뀌었습니다. 새 면접을 시작하세요.", { session: prev.session });
    const group = prev.group ?? prev.session;
    const members = loadAllStates().filter(o => (o.group ?? o.session) === group);
    if (members.some(m => nextChallenge(m.stages) !== null)) fail("not_finished", "이 묶음에 아직 끝나지 않은 면접이 있습니다. 먼저 끝까지 보세요.", { session: prev.session });
    if (members.length >= MAX_REPEAT) fail("repeat_limit", `한 묶음은 ${MAX_REPEAT}판까지입니다.`, { session: prev.session });
    if (!prev.group) {
      prev.group = group;
      saveState(prev);
    }
    const s: SessionState = {
      version: ARENA_VERSION, session: `${new Date().toISOString().slice(0, 10)}-${randomBytes(4).toString("hex")}`,
      agent: prev.agent, mdPath: prev.mdPath, mdHash: prev.mdHash, md: prev.md, createdAt: new Date().toISOString(),
      options: prev.options, stages: {}, reports: [],
      divisionSource: prev.divisionSource, specModel: prev.specModel, promptsHash: prev.promptsHash,
      group, ...(prev.repeatTarget ? { repeatTarget: prev.repeatTarget } : {}),
    };
    saveState(s);
    const stage = await runStage(s, "doc");
    out({ ...sessionOverview(s), stage });
    return;
  }

  if (command === "status") {
    const s = loadState(positionals[0] ?? "");
    out({ ...sessionOverview(s), stages: s.reports.map(r => summarizeStage(r.challenge, r, s.stages)) });
    return;
  }

  if (command === "list") {
    // 세션 ID 뒤쪽은 무작위라 이름순은 같은 날 안에서 순서가 섞인다. 시작 시각으로 최신순 정렬한다
    const all = loadAllStates();
    const items = [...all].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20).map(x => sessionOverview(x, all));
    out({ sessions: items });
    return;
  }

  if (command === "submit") {
    const s = loadState(positionals[0] ?? "");
    if (nextChallenge(s.stages) !== null) fail("not_finished", "면접이 끝나야 제출할 수 있습니다.", sessionOverview(s));
    if (s.options.mode !== "ranked") fail("quick_mode", "연습(quick) 모드 결과는 순위표에 올릴 수 없습니다. 랭크전으로 다시 보세요.");
    if (mdChanged(s)) {
      fail("md_changed", "면접을 본 뒤 에이전트 파일이 바뀌었습니다. 제출은 면접을 본 그 문서로만 할 수 있습니다.");
    }
    if (promptsChanged(s)) {
      fail("prompts_changed", "면접을 본 뒤 스킬이 업데이트되어 면접관 프롬프트가 바뀌었습니다. 순위표는 지금 버전의 결과만 받으니 새로 면접을 보세요.");
    }
    // --unverified: 응답 원문 없이 낸다. 순위표가 1·2차·최종을 대조하지 못하므로 "미검증"으로 오르고 순위는 맨 아래다
    const withEvidence = !values.unverified;
    const problems = localProblems(s, withEvidence);
    if (problems.length > 0) fail("not_verifiable", "순위표 검증을 통과하지 못하는 결과라 제출하지 않았습니다.", { problems });
    const stats = repeatStats(s, loadAllStates());
    const sub = buildSubmission(s, ARENA_VERSION, { withEvidence, ...(stats && stats.runs > 1 ? { repeat: { runs: stats.runs, passes: stats.passes } } : {}) });
    const payload = encodeSubmission(sub);
    if (payload.length > MAX_PAYLOAD_CHARS) {
      fail("too_large", sub.schema === SUBMISSION_SCHEMA
        ? "제출 데이터(명세 + 지원자 응답 원문)가 GitHub Issue 한도를 넘습니다. 응답 원문 없이 내려면 --unverified 를 붙이세요 (미검증으로 오릅니다)."
        : "제출 데이터가 GitHub Issue 한도를 넘습니다. 에이전트 문서를 줄여 주세요.");
    }
    const rechecked = sub.schema === SUBMISSION_SCHEMA;
    const scores = [sub.stages.doc?.score, sub.stages.r1?.score, sub.stages.r2?.score].filter(x => x !== undefined).join(" / ");
    const body = [
      `Agent **${sub.agent}** · division \`${sub.options.division}\` (${sub.run.engine}) · reached \`${sub.reached}\`${sub.hired ? " · 🏆 HIRED" : ""}`,
      `Scores: ${scores || "-"}`,
      "",
      rechecked
        ? "This issue was generated by `arena submit`. The block below is the compressed submission (agent spec, tasks, the candidate's answers and verdicts). Do not edit it — the leaderboard bot re-checks it as is."
        : "This issue was generated by `arena submit`. The block below is the compressed submission (agent spec + verdicts, without the candidate's answers, so it is listed as unverified). Do not edit it — the leaderboard bot verifies it as is.",
      "",
      BODY_MARKER_START, "```", payload, "```", BODY_MARKER_END, "",
    ].join("\n");
    const bodyFile = join(SESSIONS, s.session, "submission.md");
    writeFileSync(bodyFile, body);
    out({
      session: s.session, repo: BOARD_REPO, title: `[arena-submission] ${sub.agent} (${sub.options.division})`, bodyFile,
      newIssueUrl: `https://github.com/${BOARD_REPO}/issues/new?template=1-arena-submission.md`,
      // responses: 과제와 지원자 응답 원문이 Issue 본문에 실린다 (저장소 사본에는 남기지 않는다)
      public: { agentSpec: true, githubLogin: true, scores: true, responses: rechecked },
      // 순위표에 오르는 등급. unverified 는 응답 원문이 없어 대조하지 못한 기록이다
      tier: rechecked ? "self-reported" : "unverified",
      repeat: sub.repeat ?? null,
      reached: sub.reached, hired: sub.hired,
    });
    return;
  }

  if (command === "config") {
    // 고른 언어를 기억한다. 값을 주지 않으면 지금 설정만 보여 준다 (설정이 없으면 lang: null → 스킬이 사용자에게 묻는다)
    const f = join(HOME, "config.json");
    const current = existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as { lang?: Lang }) : {};
    const given = rest.find(a => a.startsWith("--lang="))?.slice("--lang=".length) ?? (rest.includes("--lang") ? values.lang : undefined);
    if (given !== undefined) {
      if (given !== "ko" && given !== "en") fail("bad_lang", `언어는 ko 또는 en 입니다: ${given}`);
      current.lang = given;
      mkdirSync(HOME, { recursive: true });
      writeFileSync(f, JSON.stringify(current, null, 2));
    }
    out({ lang: current.lang ?? null });
    return;
  }

  if (command === "doctor") {
    // 첫 실행이 몇 분짜리 모델 호출이라, 환경 문제는 그 전에 알 수 있게 한다. 값(키·토큰)은 읽지도 내지도 않고 있는지만 본다
    const probe = (cmd: string, args: string[]) => {
      const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 15_000, stdio: ["ignore", "pipe", "pipe"] });
      return { found: !r.error, ok: !r.error && r.status === 0, out: `${r.stdout ?? ""}`.trim().split("\n")[0].slice(0, 80) };
    };
    const claude = probe("claude", ["--version"]);
    const gh = probe("gh", ["auth", "status"]);
    const mods = claude.found && /Run a mod's tests/i.test(spawnSync("claude", ["plugin", "test", "--help"], { encoding: "utf8", timeout: 15_000 }).stdout ?? "");
    const apiKey = !!process.env.ANTHROPIC_API_KEY;
    const problems: string[] = [];
    if (!apiKey && !claude.ok) problems.push("No model backend: install and sign in to the `claude` CLI, or set ANTHROPIC_API_KEY.");
    out({
      node: { version: process.versions.node, ok: nodeMajor >= MIN_NODE_MAJOR },
      backend: apiKey ? "api" : claude.ok ? "cli" : null,
      claude: { found: claude.found, version: claude.ok ? claude.out : null },
      apiKey,
      // 순위표 제출에만 쓴다. 없으면 제출할 때 브라우저로 Issue 를 연다
      gh: { found: gh.found, signedIn: gh.ok },
      // 대기실 패널(arena-room)을 쓸 수 있는 Claude Code 인가
      mods,
      home: HOME, ready: problems.length === 0, problems,
    });
    return;
  }

  if (command === "version") {
    out({ version: ARENA_VERSION });
    return;
  }

  fail("usage", "사용법: arena <start|next|again|status|list|submit|config|doctor|version> ...");
}

main().catch(e => {
  emit({ event: "error", message: String(e?.message ?? e) });
  fail("internal", String(e?.message ?? e));
});
