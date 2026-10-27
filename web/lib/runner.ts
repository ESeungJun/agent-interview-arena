/**
 * 지원서 접수와 단계별 도전 (공개판 정책은 lib/policy.ts).
 *
 * 제출하면 v1 의 서류전형(보안 검문소 포함)을 대기열에 넣는다. 통과한 단계마다 다음 단계 도전 자격이 생긴다.
 * 단계 하나는 수 분 걸려 요청 안에서 끝낼 수 없다. 대기열(jobs)에 넣고 워커(lib/worker.ts)가 꺼내 돌린다. 화면은 주기적으로 조회한다.
 */
import { mdHash, quarterOf } from '../../core/exam.ts';
import { MAX_MD_BYTES } from '../../core/gate.ts';
import { CHALLENGES, nextChallenge, STAGE_NAMES, STAGES, type Challenge, type StageResults } from '../../core/interview.ts';
import { sealKey, verifyKey } from './byok.ts';
import { getDb, type Query } from './db.ts';
import { ADS, DIVISIONS, GATE, LIMITS, startOfTodayKst, WARNING, type Division, type Effort } from './policy.ts';
import { takeKeyCheck } from './limits.ts';
import { createApplication, currentVersion, listByOwner, mutateApplication, removeApplication, type Application, type Version } from './store.ts';

export type Fail = { ok: false; status: number; message: string };

/** 보안 실격. 보안 검문소뿐 아니라 서류·1차·2차·최종 면접관도 실격을 내린다 */
export function securityBanOf(results: StageResults) {
  return STAGES.map(s => results[s]?.securityBan).find(Boolean);
}

/** 결과 통지서를 아직 열지 않은 단계 (지금 버전) */
export function sealedChallenge(app: Application): Challenge | null {
  const v = currentVersion(app);
  return CHALLENGES.find(c => v.attempts[c]?.status === 'done' && !v.attempts[c]!.revealedAt) ?? null;
}

export type ChallengeState = {
  /** 지금 버전에서 진행 중인 단계 */
  running: Challenge | null;
  /** 지금 버전에서 도전할 수 있는 단계 (결과를 열지 않았으면 null) */
  next: Challenge | null;
  /** 떨어졌다 — 고친 .md 로 새 버전을 낼 수 있다 (티켓은 따로 본다) */
  canRevise: boolean;
  banned: boolean;
};

/** 결과 통지서를 열기 전에는 합격·불합격과 그에 따른 다음 단계·재지원 여부를 드러내지 않는다 */
export function challengeState(app: Application): ChallengeState {
  const v = currentVersion(app);
  const running = (Object.entries(v.attempts).find(([, a]) => a?.status === 'queued' || a?.status === 'running')?.[0] ?? null) as Challenge | null;
  if (running) return { running, next: null, canRevise: false, banned: false };
  if (sealedChallenge(app)) return { running, next: null, canRevise: false, banned: false };
  const banned = Boolean(securityBanOf(v.results));
  const next = banned ? null : nextChallenge(v.results);
  const failed = !next && !banned && !app.trashedAt && CHALLENGES.some(c => v.results[c] && !v.results[c]!.passed);
  return { running, next, canRevise: failed, banned };
}

const SHORT: Record<Challenge, string> = { doc: '서류', r1: '1차', r2: '2차', final: '최종' };

/** 이력 목록에 보여 줄 지금 상태 한 줄과 색. 지난 결과보다 다음에 할 일을 먼저 말한다 */
export function statusLabel(app: Application): { text: string; tone: 'wait' | 'pass' | 'fail' | 'arrived' | 'ready' } {
  const v = currentVersion(app);
  const state = challengeState(app);
  if (state.running) return { text: `${SHORT[state.running]} 면접 중`, tone: 'wait' };
  const errored = CHALLENGES.find(c => v.attempts[c]?.status === 'error');
  if (errored) return { text: `${SHORT[errored]} 오류 · 다시 시도`, tone: 'fail' };
  const sealed = sealedChallenge(app);
  if (sealed) return { text: `${SHORT[sealed]} 결과 도착`, tone: 'arrived' };
  if (state.banned) return { text: '보안 실격', tone: 'fail' };
  if (state.next) return { text: `${SHORT[state.next]} 도전 가능`, tone: 'ready' };
  const done = CHALLENGES.filter(c => v.attempts[c]?.status === 'done');
  const last = done[done.length - 1];
  if (!last) return { text: '면접 전', tone: 'wait' };
  if (v.attempts[last]!.passed) return { text: last === 'final' ? '최종 합격' : `${SHORT[last]} 합격`, tone: 'pass' };
  return { text: `${SHORT[last]} 불합격 · 고쳐서 재도전`, tone: 'fail' };
}

function checkMd(md: string): Fail | null {
  if (!md.trim()) return { ok: false, status: 400, message: '.md 내용이 비어 있습니다.' };
  if (Buffer.byteLength(md, 'utf8') > MAX_MD_BYTES) {
    return { ok: false, status: 400, message: `.md 는 ${MAX_MD_BYTES / 1024}KB(한글 약 ${Math.round(MAX_MD_BYTES / 3 / 10000)}만 자) 이하만 받습니다.` };
  }
  return null;
}

function newVersion(n: number, md: string, effort: Effort | undefined): Version {
  return { n, md, mdHash: mdHash(md), quarter: quarterOf(new Date()), createdAt: new Date().toISOString(), effort, results: {}, attempts: {} };
}

/** 파일 이름에서 저장해도 되는 글자만 남긴다 (지원 폼도 같은 규칙으로 이어짐 여부를 미리 맞춰 본다) */
export const cleanName = (name: string) => name.replace(/[^\w.\-가-힣 ]/g, '').slice(0, 80) || 'agent.md';

// ── 티켓·경고 ─────────────────────────────────────────────────────

/** 오늘 체급별로 쓴 서류 티켓 수 */
export async function ticketsUsedToday(accountId: string): Promise<Record<Division, number>> {
  const rows = await (await getDb()).query<{ division: Division; n: string | number }>(
    "select division, count(*) as n from tickets where account_id = $1 and challenge = 'doc' and used_at >= $2 group by division",
    [accountId, startOfTodayKst()],
  );
  const used: Record<Division, number> = { light: 0, middle: 0, open: 0 };
  for (const r of rows) used[r.division] = Number(r.n);
  return used;
}

/** 티켓을 한 장 잡는다. 계정 행을 잠가 동시에 낸 두 지원이 마지막 한 장을 같이 쓰지 못하게 한다. 실패하면 사유 */
async function takeTicket(accountId: string, division: Division): Promise<{ ok: true; ticketId: number } | Fail> {
  return (await getDb()).tx(async q => {
    await q('select id from accounts where id = $1 for update', [accountId]);
    const [{ n }] = await q<{ n: string | number }>("select count(*) as n from tickets where account_id = $1 and division = $2 and challenge = 'doc' and used_at >= $3", [
      accountId, division, startOfTodayKst(),
    ]);
    const limit = DIVISIONS[division].ticketsPerDay;
    if (Number(n) >= limit) {
      return { ok: false, status: 429, message: `오늘 ${DIVISIONS[division].label} 티켓 ${limit}장을 모두 썼습니다. 자정(한국 시간)에 다시 채워집니다.` } as Fail;
    }
    const [row] = await q<{ id: number }>('insert into tickets (account_id, division) values ($1, $2) returning id', [accountId, division]);
    return { ok: true as const, ticketId: Number(row.id) };
  });
}

async function refundTicket(ticketId: number): Promise<void> {
  await (await getDb()).query('delete from tickets where id = $1', [ticketId]);
}

/** 티켓을 지원서의 한 버전에 묶는다. 서류전형은 그 버전에 묶인 티켓이 있을 때만 접수한다 */
async function attachTicket(ticketId: number, applicationId: string, version: number): Promise<void> {
  await (await getDb()).query('update tickets set application_id = $2, version = $3 where id = $1', [ticketId, applicationId, version]);
}

// ── 관문권 (D-48) ────────────────────────────────────────────────

/** 관문권 잔액 (장부 합계) */
export async function passBalance(accountId: string, q?: Query): Promise<number> {
  const query = q ?? (await getDb()).query;
  const [{ n }] = await query<{ n: string | number | null }>('select coalesce(sum(delta), 0) as n from pass_ledger where account_id = $1', [accountId]);
  return Number(n);
}

export type PassEntry = { id: number; delta: number; reason: string; challenge: string | null; agentName: string | null; at: string };

/** 관문권 증감 기록 (상점 화면). 어느 지원서의 어느 관문에 썼는지 함께 보여 준다 */
export async function passHistory(accountId: string, limit = 20): Promise<PassEntry[]> {
  const rows = await (await getDb()).query<{ id: number; delta: number; reason: string; challenge: string | null; agent_name: string | null; created_at: string | Date }>(
    `select l.id, l.delta, l.reason, l.challenge, a.agent_name, l.created_at
     from pass_ledger l left join applications a on a.id = l.application_id
     where l.account_id = $1 order by l.created_at desc, l.id desc limit $2`,
    [accountId, limit],
  );
  return rows.map(r => ({
    id: Number(r.id), delta: Number(r.delta), reason: r.reason, challenge: r.challenge, agentName: r.agent_name, at: new Date(r.created_at).toISOString(),
  }));
}

/** 오늘 쓴 무료 1차 (체급 합산) */
export async function freeR1UsedToday(accountId: string, q?: Query): Promise<number> {
  const query = q ?? (await getDb()).query;
  const [{ n }] = await query<{ n: string | number }>("select count(*) as n from tickets where account_id = $1 and challenge = 'r1' and used_at >= $2", [
    accountId, startOfTodayKst(),
  ]);
  return Number(n);
}

/** 화면에 보여 줄 계정 수치: 오늘 쓴 서류 티켓(체급별)·무료 1차·보상형 광고로 받은 관문권, 관문권 잔액 */
export type AccountCounts = { docUsed: Record<Division, number>; freeR1Used: number; rewardsUsed: number; balance: number };

/**
 * AccountCounts 를 세는 SQL 조각. 지원서 조회·결과 열기 같은 다른 문장에 붙여 왕복 한 번에 함께 읽는다
 * (DB 가 컨테이너와 다른 지역에 있어 왕복 한 번이 0.1초 넘게 든다). owner·day 는 그 문장의 SQL 식이다
 */
export const countsSql = (owner: string, day: string) => `
  (select coalesce(jsonb_object_agg(division, n), '{}'::jsonb) from (
     select division, count(*) as n from tickets where account_id = ${owner} and challenge = 'doc' and used_at >= ${day} group by division) t) as doc_used,
  (select count(*) from tickets where account_id = ${owner} and challenge = 'r1' and used_at >= ${day}) as r1_used,
  (select count(*) from pass_ledger where account_id = ${owner} and reason = 'reward' and created_at >= ${day}) as rewards_used,
  (select coalesce(sum(delta), 0) from pass_ledger where account_id = ${owner}) as balance`;

export type CountsRow = { doc_used: Partial<Record<Division, string | number>>; r1_used: string | number; rewards_used: string | number; balance: string | number | null };

export function toCounts(r: CountsRow): AccountCounts {
  const docUsed: Record<Division, number> = { light: 0, middle: 0, open: 0 };
  for (const [d, n] of Object.entries(r.doc_used ?? {})) docUsed[d as Division] = Number(n);
  return { docUsed, freeR1Used: Number(r.r1_used), rewardsUsed: Number(r.rewards_used ?? 0), balance: Number(r.balance ?? 0) };
}

export async function accountCounts(accountId: string): Promise<AccountCounts> {
  const [row] = await (await getDb()).query<CountsRow>(`select ${countsSql('$1', '$2')}`, [accountId, startOfTodayKst()]);
  return toCounts(row);
}

/**
 * 보상형 광고를 끝까지 본 계정에 관문권 1장을 준다 (D-51). 계정당 하루 ADS.rewardedPerDay 장까지.
 * 웹 보상형 광고는 서버 측 확인이 없어 브라우저의 "보상 지급" 신호를 믿는다. 그래서 하루 상한이 실제 방어선이다
 * (광고 없이 이 요청만 보내도 하루 1장 이상은 받을 수 없다). 계정 행을 잠가 동시에 보낸 요청이 상한을 함께 넘지 않게 한다
 */
export async function claimReward(accountId: string): Promise<{ ok: true; counts: AccountCounts } | Fail> {
  return (await getDb()).tx(async q => {
    const [row] = await q<CountsRow>(
      `select ${countsSql('$1', '$2')} from (select id from accounts where id = $1 for update) a`, [accountId, startOfTodayKst()]);
    if (!row) return { ok: false, status: 404, message: '계정이 없습니다.' };
    if (Number(row.rewards_used) >= ADS.rewardedPerDay) {
      return { ok: false, status: 429, message: `광고로 받는 관문권은 하루 ${ADS.rewardedPerDay}장까지입니다. 내일 다시 받을 수 있습니다.` };
    }
    await q("insert into pass_ledger (account_id, delta, reason, note) values ($1, 1, 'reward', 'rewarded ad')", [accountId]);
    const counts = toCounts(row);
    return { ok: true, counts: { ...counts, rewardsUsed: counts.rewardsUsed + 1, balance: counts.balance + 1 } };
  });
}

const UUID = /^[0-9a-f-]{36}$/i;

/** 본인 지원서와 계정 수치를 한 번에 읽는다. 남의 지원서면 undefined */
export async function ownedApplication(id: string, ownerId: string): Promise<{ app: Application; counts: AccountCounts } | undefined> {
  if (!UUID.test(id)) return undefined;
  const [row] = await (await getDb()).query<CountsRow & { doc: Application }>(
    `select a.doc, ${countsSql('a.owner_id', '$3')} from applications a where a.id = $1 and a.owner_id = $2`,
    [id, ownerId, startOfTodayKst()],
  );
  return row && { app: row.doc, counts: toCounts(row) };
}

/**
 * 결과 통지서를 열었다고 기록하고, 연 뒤의 지원서와 계정 수치를 돌려준다. 문장 하나로 끝낸다 (잠그고 읽고 쓰는 왕복을 줄인다).
 * 이미 열었으면 처음 연 시각을 둔다. 끝나지 않은 단계거나 남의 지원서면 undefined
 */
export async function revealAttempt(id: string, ownerId: string, challenge: Challenge): Promise<{ app: Application; counts: AccountCounts } | undefined> {
  if (!UUID.test(id)) return undefined;
  const [row] = await (await getDb()).query<CountsRow & { doc: Application }>(
    `update applications a
     set doc = jsonb_set(a.doc, array['versions', (jsonb_array_length(a.doc->'versions') - 1)::text, 'attempts', $3::text, 'revealedAt'],
                         coalesce(a.doc->'versions'-> -1->'attempts'->$3::text->'revealedAt', to_jsonb($4::text))),
         updated_at = now()
     where a.id = $1 and a.owner_id = $2 and a.doc->'versions'-> -1->'attempts'->$3::text->>'status' = 'done'
     returning a.doc, ${countsSql('a.owner_id', '$5')}`,
    [id, ownerId, challenge, new Date().toISOString(), startOfTodayKst()],
  );
  return row && { app: row.doc, counts: toCounts(row) };
}

/** 서버 오류로 끝난 단계를 티켓 없이 다시 시도할 수 있는 횟수 (같은 버전·단계) */
const MAX_ERROR_RETRIES = 3;
/** 계정 수와 상관없이 대기열 길이를 셀 때 잡는 잠금 번호 */
const QUEUE_LOCK = 7_270_032;

/** 보안 실격 경고가 쌓여 제출이 막혀 있으면 풀리는 시각 */
export async function suspendedUntil(accountId: string): Promise<string | null> {
  const since = new Date(Date.now() - WARNING.windowDays * 86_400_000).toISOString();
  const rows = await (await getDb()).query<{ created_at: string | Date }>(
    'select created_at from warnings where account_id = $1 and revoked_at is null and created_at >= $2 order by created_at desc',
    [accountId, since],
  );
  if (rows.length < WARNING.limit) return null;
  const until = new Date(new Date(rows[0].created_at).getTime() + WARNING.suspendDays * 86_400_000);
  return until.getTime() > Date.now() ? until.toISOString() : null;
}

// ── 접수 ─────────────────────────────────────────────────────────

export type SubmitInput = { ownerId: string; agentName: string; md: string; division: Division; effort?: Effort; byokKey?: string };

/** 체급·추론 강도·지원자 키·제출 정지를 확인한다 */
async function checkEntry(input: Pick<SubmitInput, 'ownerId' | 'division' | 'effort' | 'byokKey'>): Promise<Fail | null> {
  const division = DIVISIONS[input.division];
  if (!division.open) return { ok: false, status: 403, message: `${division.label}은 아직 열지 않았습니다. ${division.closedReason ?? ''}`.trim() };
  if (input.effort && !division.efforts.includes(input.effort)) {
    return { ok: false, status: 400, message: `${division.label}에서는 추론 강도를 ${division.efforts.length ? division.efforts.join('·') + ' 중에서' : '고를 수 없습니다'}${division.efforts.length ? ' 고를 수 있습니다' : ''}.` };
  }
  const until = await suspendedUntil(input.ownerId);
  if (until) return { ok: false, status: 403, message: `보안 실격 경고가 ${WARNING.limit}번 쌓여 ${new Date(until).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}까지 제출할 수 없습니다.` };
  // 키 확인(외부 호출) 전에 티켓이 남았는지 먼저 본다. 실제로 잡는 것은 takeTicket 이다
  if ((await ticketsUsedToday(input.ownerId))[input.division] >= division.ticketsPerDay) {
    return { ok: false, status: 429, message: `오늘 ${division.label} 티켓 ${division.ticketsPerDay}장을 모두 썼습니다. 자정(한국 시간)에 다시 채워집니다.` };
  }
  if (division.byok) return checkKey(input.ownerId, input.byokKey, division.engine);
  return null;
}

/** 무제한급 지원자 키 확인. 남의 키가 유효한지 알아보는 용도로 쓰이지 않게 계정당 분당 횟수를 둔다 */
async function checkKey(accountId: string, byokKey: string | undefined, engine: (typeof DIVISIONS)[Division]['engine']): Promise<Fail | null> {
  if (!byokKey) return { ok: false, status: 400, message: '무제한급은 지원자 API 키가 필요합니다. 키는 저장하지 않고 이번 면접에만 씁니다.' };
  const limited = takeKeyCheck(accountId);
  if (limited) return { ok: false, status: 429, message: limited };
  const bad = await verifyKey(byokKey, engine);
  return bad ? { ok: false, status: 400, message: bad } : null;
}

/**
 * 채용 페이지에서 지원. 세 가지로 갈린다.
 *  - 같은 분기에 같은 체급으로 이미 낸 .md 면 그 지원서를 돌려준다 (티켓을 쓰지 않는다)
 *  - 같은 파일 이름·체급으로 떨어진 지원서가 있으면 그 지원서의 새 버전으로 붙여 서류부터 다시 본다
 *  - 그 밖에는 새 지원서
 */
export async function submitApplication(input: SubmitInput): Promise<{ ok: true; id: string; reused: boolean } | Fail> {
  const bad = checkMd(input.md);
  if (bad) return bad;
  const agentName = cleanName(input.agentName);
  const hash = mdHash(input.md);
  const quarter = quarterOf(new Date());
  const mine = (await listByOwner(input.ownerId)).filter(a => !a.trashedAt && a.division === input.division);
  const same = mine.find(a => a.versions.some(v => v.mdHash === hash && v.quarter === quarter));
  if (same) return { ok: true, id: same.id, reused: true };

  const entry = await checkEntry(input);
  if (entry) return entry;

  const sameName = mine.filter(a => a.agentName === agentName);
  if (sameName.some(a => sealedChallenge(a))) {
    return { ok: false, status: 409, message: `${agentName.replace(/\.md$/, '')} 의 결과가 도착했습니다. 결과를 먼저 확인한 뒤 다시 내 주세요.` };
  }
  const failed = sameName.find(a => challengeState(a).canRevise);
  if (failed) {
    const revised = await reviseApplication(failed, { md: input.md, effort: input.effort, byokKey: input.byokKey }, { checked: true });
    return revised.ok ? { ok: true, id: failed.id, reused: false } : revised;
  }

  if ((await listByOwner(input.ownerId)).length >= LIMITS.applications) {
    return { ok: false, status: 429, message: `지원서는 계정당 ${LIMITS.applications}개까지 보관할 수 있습니다. 휴지통에서 완전히 삭제한 뒤 다시 지원해 주세요.` };
  }
  const ticket = await takeTicket(input.ownerId, input.division);
  if (!ticket.ok) return ticket;
  const v1 = newVersion(1, input.md, input.effort);
  const app: Application = { id: crypto.randomUUID(), ownerId: input.ownerId, agentName, division: input.division, createdAt: v1.createdAt, versions: [v1] };
  await createApplication(app);
  await attachTicket(ticket.ticketId, app.id, 1);
  const reserved = await reserveChallenge(app.id, 'doc', input.byokKey);
  if (!reserved.ok) {
    // 접수하지 못한 지원서는 남기지 않는다 (남기면 티켓 없이 서류전형을 여는 길이 된다). 티켓도 돌려준다
    await removeApplication(app.id);
    await refundTicket(ticket.ticketId);
    return { ok: false, status: reserved.status, message: `서류전형을 시작하지 못했습니다: ${reserved.message}` };
  }
  return { ok: true, id: app.id, reused: false };
}

/** 떨어진 지원서에 고친 .md 를 붙여 새 버전을 만들고 서류전형을 접수한다 (티켓 1장) */
export async function reviseApplication(
  app: Application,
  input: { md: string; effort?: Effort; byokKey?: string },
  opts: { checked?: boolean } = {},
): Promise<{ ok: true; n: number } | Fail> {
  if (app.trashedAt) return { ok: false, status: 403, message: '휴지통에 있는 지원서입니다. 복원한 뒤 다시 지원해 주세요.' };
  const state = challengeState(app);
  if (!state.canRevise) {
    const why = state.running ? '진행 중인 면접이 있습니다.' : sealedChallenge(app) ? '결과를 먼저 확인해 주세요.' : state.banned ? '보안 실격된 지원서는 다시 도전할 수 없습니다.'
      : state.next ? `지금 버전으로 ${STAGE_NAMES[state.next]}에 도전할 수 있습니다.` : '면접이 끝난 지원서입니다.';
    return { ok: false, status: 403, message: why };
  }
  const bad = checkMd(input.md);
  if (bad) return bad;
  const hash = mdHash(input.md);
  if (app.versions.some(v => v.mdHash === hash)) return { ok: false, status: 400, message: '이전에 낸 .md 와 내용이 같습니다. 고친 .md 를 첨부해 주세요.' };
  if (!opts.checked) {
    const entry = await checkEntry({ ownerId: app.ownerId, division: app.division, effort: input.effort, byokKey: input.byokKey });
    if (entry) return entry;
  }
  const ticket = await takeTicket(app.ownerId, app.division);
  if (!ticket.ok) return ticket;

  // 버전 번호는 행을 잠근 채 정한다. 같은 재지원이 동시에 두 번 들어와도 버전이 겹치지 않는다
  const n = await mutateApplication(app.id, a => {
    if (!challengeState(a).canRevise || a.versions.some(v => v.mdHash === hash)) return 0;
    const next = a.versions.length + 1;
    a.versions.push(newVersion(next, input.md, input.effort));
    return next;
  });
  if (!n) {
    await refundTicket(ticket.ticketId);
    return { ok: false, status: 409, message: '이미 새 버전이 접수됐습니다. 화면을 새로 고쳐 주세요.' };
  }
  await attachTicket(ticket.ticketId, app.id, n);
  const reserved = await reserveChallenge(app.id, 'doc', input.byokKey);
  if (!reserved.ok) {
    // 접수하지 못한 새 버전은 되돌리고 티켓도 돌려준다
    await mutateApplication(app.id, a => {
      const last = a.versions[a.versions.length - 1];
      if (last.n === n && Object.keys(last.attempts).length === 0) a.versions.pop();
    });
    await refundTicket(ticket.ticketId);
    return { ok: false, status: reserved.status, message: `서류전형을 시작하지 못했습니다: ${reserved.message}` };
  }
  return { ok: true, n };
}

type Reserved = { ok: true; n: number; app: Application; counts: AccountCounts };

/**
 * 지금 버전의 한 단계 도전을 대기열에 넣는다. 확인과 기록을 지원서 행 잠금 안에서 해 같은 단계가 두 번 들어가지 않는다.
 * 서류 다음 관문은 무료 1차·관문권(D-48)도 같은 트랜잭션에서 낸다. 접수에 실패하면 함께 되돌아가 따로 돌려줄 것이 없다
 * (나눠 하면 동시에 들어온 다른 요청이 "이미 낸 관문"으로 보고 지나간 뒤 돌려받는 틈이 생긴다).
 * ownerId 를 주면 본인 지원서일 때만 접수한다. 무제한급은 지원자 키를 암호화해 대기열 행에 함께 둔다.
 */
export async function reserveChallenge(id: string, challenge: Challenge, byokKey?: string, ownerId?: string): Promise<Reserved | Fail> {
  const notFound: Fail = { ok: false, status: 404, message: '지원서가 없습니다.' };
  if (!UUID.test(id)) return notFound;
  const result = await (await getDb()).tx(async (q): Promise<Reserved | Fail> => {
    const [row] = await q<{ doc: Application }>(
      `select doc from applications where id = $1${ownerId ? ' and owner_id = $2' : ''} for update`, ownerId ? [id, ownerId] : [id]);
    const app = row?.doc;
    if (!app) return notFound;
    if (app.trashedAt) return { ok: false, status: 403, message: '휴지통에 있는 지원서입니다. 복원한 뒤 도전해 주세요.' };
    const { running, next } = challengeState(app);
    if (running) return { ok: false, status: 409, message: `${STAGE_NAMES[running]}이 진행 중입니다.` };
    if (next !== challenge) {
      return { ok: false, status: 403, message: next ? `지금 도전할 수 있는 단계는 ${STAGE_NAMES[next]}입니다.` : '지금 버전으로 더 도전할 단계가 없습니다.' };
    }
    const division = DIVISIONS[app.division];
    if (division.byok && !byokKey) return { ok: false, status: 400, message: '무제한급은 도전할 때마다 지원자 API 키가 필요합니다.' };
    const v = currentVersion(app);
    const prev = v.attempts[challenge];
    if (prev?.status === 'error' && (prev.errors ?? 0) >= MAX_ERROR_RETRIES) {
      return { ok: false, status: 429, message: `서버 오류가 ${MAX_ERROR_RETRIES}번 이어졌습니다. 운영자가 확인할 때까지 이 단계를 다시 시도할 수 없습니다.` };
    }
    // 대기열 잠금을 잡은 뒤에 센다. 다른 지원서로 동시에 들어온 요청이 동시 상한·무료 1차·관문권 잔액을 함께 넘지 않게
    await q('select pg_advisory_xact_lock($1)', [QUEUE_LOCK]);
    const [c] = await q<CountsRow & { mine: string | number; all_jobs: string | number; doc_ticket: boolean; gate_free: boolean; gate_paid: string | number }>(
      `select
         (select count(*) from jobs j join applications a on a.id = j.application_id where a.owner_id = $1) as mine,
         (select count(*) from jobs j join applications a on a.id = j.application_id) as all_jobs,
         exists (select 1 from tickets where application_id = $2 and version = $3 and challenge = 'doc') as doc_ticket,
         exists (select 1 from tickets where application_id = $2 and version = $3 and challenge = $4) as gate_free,
         (select coalesce(sum(delta), 0) from pass_ledger where application_id = $2 and version = $3 and challenge = $4) as gate_paid,
         ${countsSql('$1', '$5')}`,
      [app.ownerId, app.id, v.n, challenge, startOfTodayKst()],
    );
    // 서류전형은 이 버전에 쓴 티켓이 있어야 한다 (서버 오류 뒤 다시 시도할 때도 같은 티켓을 쓴다)
    if (challenge === 'doc' && !c.doc_ticket) return { ok: false, status: 403, message: '이 버전에 쓴 티켓이 없습니다. 고친 .md 를 새로 내 주세요.' };
    if (Number(c.mine) >= LIMITS.concurrent) return { ok: false, status: 429, message: `면접은 계정당 동시에 ${LIMITS.concurrent}개까지 진행할 수 있습니다.` };
    if (Number(c.all_jobs) >= LIMITS.queue) return { ok: false, status: 503, message: '지금 면접장이 붐빕니다. 잠시 뒤 다시 시도해 주세요.' };
    const counts = toCounts(c);
    // 서류 다음 관문: 이미 낸 관문(서버 오류 뒤 다시 시도)이면 더 내지 않는다. 1차는 하루 무료 횟수 안이면 무료, 그 밖에는 관문권
    let free = false;
    let passes = 0;
    if (GATE.required && challenge !== 'doc' && !c.gate_free && Number(c.gate_paid) >= 0) {
      if (challenge === 'r1' && counts.freeR1Used < GATE.freeR1PerDay) free = true;
      else passes = division.passesPerGate;
      if (passes > counts.balance) {
        return { ok: false, status: 402, message: `${STAGE_NAMES[challenge]}에는 관문권 ${passes}장이 필요합니다 (보유 ${counts.balance}장). 관문권 결제는 준비 중입니다.` };
      }
    }
    v.attempts[challenge] = { status: 'queued', logs: [], startedAt: new Date().toISOString(), errors: prev?.errors };
    // 대기열·무료 1차·관문권 기록과 지원서 갱신을 문장 하나로 쓴다
    await q(
      `with job as (insert into jobs (application_id, version, challenge, byok_cipher) values ($1, $2, $3, $4)),
       free as (insert into tickets (account_id, division, application_id, version, challenge) select $5, $6, $1, $2, $3 where $7::boolean),
       paid as (insert into pass_ledger (account_id, delta, reason, application_id, version, challenge) select $5, -$8::int, 'use', $1, $2, $3 where $8::int > 0)
       update applications set doc = $9, updated_at = now() where id = $1`,
      [app.id, v.n, challenge, byokKey ? sealKey(byokKey) : null, app.ownerId, app.division, free, passes, app],
    );
    if (free) counts.freeR1Used++;
    counts.balance -= passes;
    return { ok: true, n: v.n, app, counts };
  });
  if (result.ok) void import('./worker.ts').then(w => w.kickWorker());
  return result;
}

/** 다음 단계 도전 (본인 지원서만). 1차는 하루 무료 횟수 안에서 무료, 그 밖의 관문은 관문권을 쓴다 (D-48) */
export async function startChallenge(id: string, ownerId: string, challenge: Challenge, byokKey?: string): Promise<Reserved | Fail> {
  // 지원자 키를 받는 체급이 열려 있을 때만 미리 읽어 키를 확인한다 (외부 호출이라 행을 잠근 채 하지 않는다)
  if (Object.values(DIVISIONS).some(d => d.byok)) {
    const owned = await ownedApplication(id, ownerId);
    if (!owned) return { ok: false, status: 404, message: '지원서가 없습니다.' };
    const division = DIVISIONS[owned.app.division];
    if (division.byok) {
      const bad = await checkKey(ownerId, byokKey, division.engine);
      if (bad) return bad;
    }
  }
  return reserveChallenge(id, challenge, byokKey, ownerId);
}

/** 휴지통으로 옮기거나 되돌린다. 면접이 진행 중인 지원서는 옮기지 않는다 */
export async function setTrashed(app: Application, trashed: boolean): Promise<{ ok: true } | Fail> {
  if (trashed && challengeState(app).running) return { ok: false, status: 409, message: '면접이 진행 중인 지원서는 휴지통으로 옮길 수 없습니다.' };
  await mutateApplication(app.id, a => {
    if (trashed) a.trashedAt = new Date().toISOString();
    else delete a.trashedAt;
  });
  return { ok: true };
}
