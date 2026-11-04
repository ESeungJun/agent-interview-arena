// 순위표 CLI. GitHub Actions 와 로컬 시험에서 쓴다 (엔진 번들에는 들어가지 않는다).
//   node runner/board_cli.ts sweep                       열린 제출 Issue 를 모두 처리한다 (Actions 용, gh 필요)
//                                                         ISSUE_NUMBER 가 있으면 그 Issue 를 목록보다 먼저 처리한다
//   node runner/board_cli.ts verify <body.txt> --author <login> --issue <n> --created-at <ISO>   한 건 검증·저장
//   node runner/board_cli.ts rebuild                     docs/leaderboard.json 다시 만들기
// Issue 제목·본문·작성자는 신뢰할 수 없는 입력이다. gh·git 은 셸 없이 인자 배열로만 부른다.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  acceptedHashes, decodeIssueBody, ranksAbove, readEntries, rebuildBoard, slotOf, storedSubmission, SUBS, toEntry, verifySubmission,
  type BoardEntry, type Submission,
} from "./board.ts";

/** .github/workflows/leaderboard.yml 의 if 조건과 같은 값이다 (YAML 에서 이 상수를 읽을 수 없어 두 곳에 있다) */
export const TITLE_PREFIX = "[arena-submission]";
export const LABEL = "arena-submission";
export const MAX_PER_DAY = 5;
export const MIN_ACCOUNT_DAYS = 7;
const BOARD_URL = "https://eseungjun.github.io/agent-interview-arena/";

const LOGIN = /^[A-Za-z0-9-]{1,39}$/;

type Accepted = { id: string; entry: BoardEntry; stored: Submission };

/** 한 건 검증. 통과하면 저장할 내용을 돌려준다. 파일은 쓰지 않는다. */
export function processSubmission(body: string, author: string, issue: number, issueCreatedAt: string, hashes: string[]):
  { ok: true; accepted: Accepted; sub: Submission } | { ok: false; problems: string[] } {
  if (!LOGIN.test(author) || !Number.isInteger(issue) || issue <= 0 || Number.isNaN(Date.parse(issueCreatedAt))) {
    return { ok: false, problems: ["Invalid author, issue number or issue time"] };
  }
  const sub = decodeIssueBody(body);
  if (!sub) return { ok: false, problems: ["Could not read the submission data. Post the body exactly as `arena submit` generated it."] };
  let problems: string[];
  try {
    problems = verifySubmission(sub, hashes);
  } catch {
    // 검증 코드가 예상 못 한 모양에 터지면 일시 오류가 아니라 받을 수 없는 제출이다 (열어 두면 매 주기 다시 돈다)
    return { ok: false, problems: ["The submission data has an unexpected shape."] };
  }
  if (problems.length > 0) return { ok: false, problems };
  // 로그인 이름과 Issue 번호만으로 만든 id 라 경로를 벗어날 수 없다
  const id = `${author.toLowerCase()}-${issue}`;
  const createdAt = new Date(issueCreatedAt).toISOString();
  return { ok: true, sub, accepted: { id, entry: toEntry(id, author, issue, createdAt, sub), stored: storedSubmission(sub) } };
}

/**
 * 새 기록이 그 사람의 그 체급·같은 등급 최고 기록을 넘는지 본다. 넘으면 밀려날 기존 파일 id 를, 못 넘으면 null 을 준다.
 * 한 칸에 파일 하나만 남겨, 같은 사람이 문서를 바꿔 가며 저장소에 텍스트를 쌓지 못하게 한다.
 * 등급(직접 측정 self-reported·재검증 verified)마다 따로 비교한다. verified 는 순위에서 항상 앞서므로, 함께 비교하면
 * 한 번 검증받은 사람은 그 체급에 새 직접 측정 기록(다음 재검증 대상)을 영영 낼 수 없다. 순위표에는 칸마다 더 높은 하나만 나온다.
 */
export function replaces(entry: BoardEntry, existing: BoardEntry[]): string[] | null {
  const mine = existing.filter(e => slotOf(e) === slotOf(entry) && e.tier === entry.tier);
  if (mine.some(e => !ranksAbove(entry, e))) return null;
  return mine.map(e => e.id);
}

/**
 * 최신 main 의 기록(current) 위에 이번 실행에서 검증을 통과한 제출을 받은 순서대로 얹는다.
 *  - write: 새로 쓸 파일
 *  - remove: 밀려나 지울 기존 파일 id
 *  - superseded: 받았지만 같은 실행의 더 나은 제출에 밀려 파일은 쓰지 않는 것 (접수 답글은 단다)
 *  - dropped: 이미 같거나 더 나은 기록이 있어 받지 않는 것 (거절 답글)
 *  - saved: main 에 이미 이 제출의 파일이 있는 것 (지난 시도의 push 가 실제로는 올라갔는데 실패로 보고된 경우). 접수 답글만 단다
 * push 를 다시 시도할 때마다 새로 받은 main 으로 다시 계산하므로, 그 사이 main 이 바뀌어도 어긋나지 않는다.
 */
export function planWrite<T extends { a: Accepted }>(accepted: T[], current: BoardEntry[]):
  { write: T[]; remove: string[]; superseded: T[]; dropped: T[]; saved: T[] } {
  const currentIds = new Set(current.map(e => e.id));
  let pool = [...current];
  let write: T[] = [];
  const superseded: T[] = [];
  const dropped: T[] = [];
  const saved: T[] = [];
  const remove = new Set<string>();
  for (const x of accepted) {
    // 자기 파일과 비교하면 "같은 기록이 이미 있다"로 떨어지므로 먼저 거른다
    if (currentIds.has(x.a.id)) {
      saved.push(x);
      continue;
    }
    const old = replaces(x.a.entry, pool);
    if (old === null) {
      dropped.push(x);
      continue;
    }
    for (const id of old) {
      if (currentIds.has(id)) remove.add(id);
      const k = write.findIndex(w => w.a.id === id);
      if (k >= 0) superseded.push(...write.splice(k, 1));
    }
    pool = [...pool.filter(e => !old.includes(e.id)), x.a.entry];
    write = [...write, x];
  }
  return { write, remove: [...remove], superseded, dropped, saved };
}

function writeAccepted(list: Accepted[], remove: string[] = []): void {
  mkdirSync(SUBS, { recursive: true });
  for (const id of remove) rmSync(join(SUBS, `${id}.json`), { force: true });
  for (const a of list) writeFileSync(join(SUBS, `${a.id}.json`), `${JSON.stringify({ entry: a.entry, submission: a.stored }, null, 2)}\n`);
  rebuildBoard();
}

// ---------------------------------------------------------------- Actions 용 일괄 처리

/** 한 번 실행에 처리하는 최대 건수. 넘는 것은 다음 주기가 가져간다 (API 한도·실행 시간 보호) */
export const MAX_PER_RUN = 30;
/** 일시 오류로 이만큼 열린 채 남은 제출은 안내하고 닫는다 (같은 Issue 를 끝없이 다시 처리하지 않게) */
export const GIVE_UP_MS = 6 * 3600 * 1000;
export const REJECTED_LABEL = "arena-rejected";
/** 접수가 확정됐다는 표시. 답글보다 먼저 붙여, 답글이 실패해도 다음 실행이 다시 검증하지 않고 답글만 마저 단다 */
export const ACCEPTED_LABEL = "arena-accepted";
const OUR_LABELS = [LABEL, ACCEPTED_LABEL, REJECTED_LABEL];
/** 봇 답글 끝에 붙이는 표시. 다시 시도할 때 이미 단 답글을 또 달지 않으려고 찾는다 */
export const BOT_MARK = "<!-- arena-bot -->";
/** 열린 Issue 목록을 넘겨 보는 최대 쪽 수 (쪽당 100건) */
const MAX_PAGES = 10;

export type OpenIssue = { number: number; title: string; createdAt: string; author: string; labels: string[] };
type Verified = { i: OpenIssue; a: Accepted; division: string };

/**
 * 검증 전에 정할 수 있는 처리. 돌려준 값이 null 이면 정상 처리(한도·나이·검증)로 간다.
 *  - finish: 이미 접수된 제출이다. 답글·닫기만 마저 한다 (지난 실행이 접수 뒤 답글·닫기에서 멈춘 경우)
 *  - reclose: 이미 거절하고 답글까지 단 제출이 다시 열렸다. 말없이 닫는다
 *  - expire: 일시 오류로 너무 오래 남았다. 다시 내 달라고 안내하고 닫는다
 */
export function triage(i: OpenIssue, now: number, savedIds: Set<string>): "finish" | "reclose" | "expire" | null {
  if (i.labels.includes(ACCEPTED_LABEL) || savedIds.has(`${i.author.toLowerCase()}-${i.number}`)) return "finish";
  if (i.labels.includes(REJECTED_LABEL)) return "reclose";
  if (i.labels.includes(LABEL) && now - Date.parse(i.createdAt) > GIVE_UP_MS) return "expire";
  return null;
}

/**
 * 이 Issue 보다 먼저 낸, 이미 처리 표시가 붙은 제출 중 이 Issue 를 열기 전 24시간 안에 연 것의 수.
 * 처리 시각이 아니라 Issue 를 연 시각으로 센다. 처리가 하루 넘게 밀려도 한꺼번에 연 제출이 한도를 빠져나가지 못한다.
 */
export function countEarlier(labeled: Map<number, number>, issue: number, issueCreated: number): number {
  const since = issueCreated - 24 * 3600 * 1000;
  return [...labeled].filter(([n, created]) => n < issue && created >= since).length;
}

const run = (cmd: string, args: string[]): string => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });

/** gh api 한 쪽을 받아, 한 줄에 하나씩 나오는 JSON 을 모은다 (검색 인덱스가 아닌 목록 API) */
function ghPage<T>(path: string, jq: string): T[] {
  return run("gh", ["api", path, "--jq", jq]).split("\n").filter(Boolean).map(l => JSON.parse(l) as T);
}

const ACCEPTED_TEXT = `✅ Accepted as **self-reported**. The leaderboard updates in a minute: ${BOARD_URL}`;

function sweep(repo: string): void {
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repo)) throw new Error(`bad repo: ${repo}`);
  const gh = (...args: string[]) => run("gh", [...args, "-R", repo]);
  const git = (...args: string[]) => run("git", args);
  const now = Date.now();
  const errors: string[] = [];

  const ISSUE_FIELDS = "{number, title, createdAt: .created_at, author: .user.login, labels: [.labels[].name], pr: (.pull_request != null), open: (.state == \"open\")}";
  const isSubmission = (r: OpenIssue & { pr: boolean; open: boolean }) => r.open && !r.pr && r.title.startsWith(TITLE_PREFIX);
  const open: OpenIssue[] = [];
  // 이번 실행을 부른 Issue 는 목록과 상관없이 먼저 본다. 제출이 아닌 Issue 가 목록을 가득 채워도 새 제출은 바로 처리된다
  const eventIssue = Number(process.env.ISSUE_NUMBER);
  if (Number.isInteger(eventIssue) && eventIssue > 0) {
    try {
      const r = ghPage<OpenIssue & { pr: boolean; open: boolean }>(`repos/${repo}/issues/${eventIssue}`, ISSUE_FIELDS)[0];
      if (r && isSubmission(r)) open.push(r);
    } catch (e) {
      // 그사이 지워졌거나 옮겨진 Issue 일 수 있다. 목록 처리는 그대로 한다
      errors.push(`issue #${eventIssue}: ${(e as Error).message}`);
    }
  }
  // 나머지는 오래된 것부터, 이번 실행 몫(MAX_PER_RUN)이 차면 더 넘기지 않는다. Pull request 도 이 목록에 섞여 오므로 뺀다
  let listed = 0;
  let capped = false;
  for (let page = 1; open.length < MAX_PER_RUN; page++) {
    if (page > MAX_PAGES) {
      capped = true;
      break;
    }
    const rows = ghPage<OpenIssue & { pr: boolean; open: boolean }>(
      `repos/${repo}/issues?state=open&sort=created&direction=asc&per_page=100&page=${page}`, `.[] | ${ISSUE_FIELDS}`,
    );
    listed += rows.length;
    for (const r of rows) if (isSubmission(r) && !open.some(o => o.number === r.number) && open.length < MAX_PER_RUN) open.push(r);
    if (rows.length < 100) break;
  }
  // 열린 Issue 가 너무 많아 뒤쪽을 못 봤다. 조용히 넘어가면 그 뒤의 제출이 영영 처리되지 않으므로 실패로 끝내 운영자에게 알린다
  if (capped) errors.push(`more than ${listed} open issues: submissions after them were not looked at. Close spam issues, then re-run.`);
  if (open.length === 0) {
    console.log("no open submissions");
    for (const e of errors) console.error(e);
    if (errors.length > 0) process.exitCode = 1;
    return;
  }
  for (const [name, color, description] of [
    [LABEL, "3b4cca", "Processed by the leaderboard bot"],
    [ACCEPTED_LABEL, "1a7f37", "Accepted by the leaderboard bot"],
    [REJECTED_LABEL, "b3261e", "Rejected by the leaderboard bot"],
  ]) gh("label", "create", name, "--color", color, "--description", description, "--force");

  // 작성자별 값은 한 번만 받는다 (같은 사람이 Issue 를 몰아 열어도 API 호출이 늘지 않게)
  const labeledCache = new Map<string, Map<number, number>>();
  const labeledBy = (author: string) => {
    const key = author.toLowerCase();
    let m = labeledCache.get(key);
    if (!m) {
      // 최신 100건이면 충분하다: 24시간 안의 것이 100건을 넘으면 어차피 한도(5건)를 넘는다
      m = new Map(ghPage<[number, string]>(
        `repos/${repo}/issues?state=all&creator=${author}&labels=${LABEL}&sort=created&direction=desc&per_page=100`,
        ".[] | [.number, .created_at]",
      ).map(([n, c]) => [n, Date.parse(c)]));
      labeledCache.set(key, m);
    }
    return m;
  };
  const ageCache = new Map<string, number>();
  const accountCreated = (author: string) => {
    const key = author.toLowerCase();
    if (!ageCache.has(key)) ageCache.set(key, Date.parse(JSON.parse(run("gh", ["api", `users/${author}`])).created_at));
    return ageCache.get(key)!;
  };

  // 답글. 지난 실행이 손댄 Issue 라면 이미 단 답글이 있는지 먼저 본다 (중복 답글 방지)
  const reply = (i: OpenIssue, text: string) => {
    if (i.labels.some(l => OUR_LABELS.includes(l))) {
      // 봇이 단 댓글만 센다. 누구나 댓글에 표시를 넣을 수 있으므로, 작성자를 보지 않으면 남의 댓글이 봇 답글을 막는다
      const mine = ghPage<number>(
        `repos/${repo}/issues/${i.number}/comments?per_page=100`,
        `[.[] | select(.user.login == "github-actions[bot]" and (.body | contains("${BOT_MARK}")))] | length`,
      );
      if ((mine[0] ?? 0) > 0) return;
    }
    gh("issue", "comment", String(i.number), "--body", `${text}\n\n${BOT_MARK}`);
  };
  const addLabel = (i: OpenIssue, label: string) => {
    if (!i.labels.includes(label)) gh("issue", "edit", String(i.number), "--add-label", label);
  };
  // 거절: 답글 → 거절 표시 → 닫기. 답글이 실패하면 표시가 없어 다음 실행이 같은 사유로 다시 답한다
  const reject = (i: OpenIssue, text?: string) => {
    if (text) reply(i, text);
    addLabel(i, REJECTED_LABEL);
    gh("issue", "close", String(i.number), "--reason", "not planned");
  };
  // 접수: 접수 표시 → 답글 → 닫기. 표시가 먼저라 답글이 실패해도 다음 실행이 다시 검증하지 않는다
  const finish = (i: OpenIssue) => {
    addLabel(i, ACCEPTED_LABEL);
    reply(i, ACCEPTED_TEXT);
    gh("issue", "close", String(i.number), "--reason", "completed");
  };

  const hashes = acceptedHashes();
  const savedIds = new Set(existsSync(SUBS) ? readdirSync(SUBS).filter(f => f.endsWith(".json")).map(f => f.slice(0, -5)) : []);
  const verified: Verified[] = [];
  const toFinish: OpenIssue[] = [];
  const toReject: { i: OpenIssue; text: string }[] = [];

  for (const i of open) {
    try {
      const t = triage(i, now, savedIds);
      if (t === "finish") {
        toFinish.push(i);
        continue;
      }
      if (t === "reclose") {
        gh("issue", "close", String(i.number), "--reason", "not planned");
        continue;
      }
      if (t === "expire") {
        reject(i, "❌ This submission could not be processed (repeated errors). Please submit it again.");
        continue;
      }
      if (!LOGIN.test(i.author)) {
        reject(i, "❌ Not accepted: unsupported account name.");
        continue;
      }
      // 처리 표시를 먼저 붙이고 센다. 작성자는 표시를 뗄 수 없고, 제목을 고쳐도 빠지지 않는다
      const labeled = labeledBy(i.author);
      addLabel(i, LABEL);
      labeled.set(i.number, Date.parse(i.createdAt));
      if (countEarlier(labeled, i.number, Date.parse(i.createdAt)) >= MAX_PER_DAY) {
        // 오늘 이미 답을 5번 받았다. 더 답글을 달면 그 자체가 스팸 통로가 되므로 말없이 닫는다
        reject(i);
        continue;
      }
      if (!(now - accountCreated(i.author) >= MIN_ACCOUNT_DAYS * 86400 * 1000)) {
        reject(i, `❌ Not accepted: GitHub accounts younger than ${MIN_ACCOUNT_DAYS} days cannot submit yet.`);
        continue;
      }

      const body = JSON.parse(gh("issue", "view", String(i.number), "--json", "body")).body as string;
      const result = processSubmission(body, i.author, i.number, i.createdAt, hashes);
      if (!result.ok) {
        reject(i, [
          "❌ Not accepted. Verification found:", "",
          ...result.problems.map(p => `- ${p}`), "",
          "Re-run `/arena:apply` and submit again without editing the generated issue body.",
        ].join("\n"));
        continue;
      }
      verified.push({ i, a: result.accepted, division: result.sub.options.division });
    } catch (e) {
      // gh·네트워크 같은 일시 오류. 열어 둔 채로 두면 다음 주기가 다시 처리하고, 6시간이 지나면 닫는다
      errors.push(`issue #${i.number}: ${(e as Error).message}`);
    }
  }

  if (verified.length > 0) {
    // 시도마다 최신 main 으로 맞추고 그 기록 기준으로 다시 계산한다 (그 사이 main 이 바뀌었을 수 있다)
    let plan: ReturnType<typeof planWrite<Verified>> | null = null;
    for (let attempt = 1; attempt <= 3 && !plan; attempt++) {
      try {
        git("fetch", "origin", "main");
        git("reset", "--hard", "origin/main");
        const p = planWrite(verified, readEntries());
        if (p.write.length > 0) {
          writeAccepted(p.write.map(x => x.a), p.remove);
          git("add", "docs/submissions", "docs/leaderboard.json");
          git("commit", "-m", `순위표: ${p.write.map(x => `#${x.i.number}`).join(" ")} 제출 추가`);
          git("push", "origin", "HEAD:main");
        }
        plan = p;
      } catch (e) {
        console.error(`saving the leaderboard failed (attempt ${attempt}): ${(e as Error).message}`);
      }
    }
    if (plan) {
      toFinish.push(...[...plan.write, ...plan.superseded, ...plan.saved].map(x => x.i));
      for (const x of plan.dropped) {
        toReject.push({ i: x.i, text: `❌ Not accepted: you already have an equal or better entry in the ${x.division} division. Only your best result per division is listed.` });
      }
    } else errors.push("could not save the leaderboard; the issues stay open for the next sweep");
  }

  // 한 건이 실패해도 나머지는 계속한다. 실패한 건은 남은 표시를 보고 다음 주기가 이어서 처리한다
  for (const i of toFinish) {
    try {
      finish(i);
    } catch (e) {
      errors.push(`finish #${i.number}: ${(e as Error).message}`);
    }
  }
  for (const { i, text } of toReject) {
    try {
      reject(i, text);
    } catch (e) {
      errors.push(`reject #${i.number}: ${(e as Error).message}`);
    }
  }

  if (errors.length > 0) {
    for (const e of errors) console.error(e);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------- 진입점

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [command, file] = process.argv.slice(2);
  const arg = (name: string) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  if (command === "sweep") {
    sweep(process.env.REPO ?? "");
  } else if (command === "verify") {
    const r = processSubmission(readFileSync(file, "utf8"), arg("author") ?? "", Number(arg("issue")), arg("created-at") ?? new Date().toISOString(), acceptedHashes());
    if (r.ok) writeAccepted([r.accepted]);
    console.log(JSON.stringify(r.ok ? { ok: true, problems: [], reached: r.sub.reached, hired: r.sub.hired } : r));
  } else if (command === "rebuild") {
    console.log(JSON.stringify({ entries: rebuildBoard().length }));
  } else {
    console.error("usage: node runner/board_cli.ts sweep | verify <body.txt> --author <login> --issue <n> [--created-at <ISO>] | rebuild");
    process.exit(2);
  }
}
