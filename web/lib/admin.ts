/**
 * 운영자 화면(/admin) 데이터. 운영 기록(events·stage_runs)과 계정·대기열을 읽는다.
 * 운영자는 ARENA_ADMIN_EMAILS(쉼표로 구분한 이메일 또는 계정 id, 로컬은 `dev:<닉네임>`)에 있는 사람만이다.
 */
import { logEvent } from './audit.ts';
import type { Viewer } from './auth.ts';
import { getDb } from './db.ts';
import { startOfTodayKst, WARNING } from './policy.ts';

export function isAdmin(viewer: Viewer | null): boolean {
  if (!viewer) return false;
  const allowed = (process.env.ARENA_ADMIN_EMAILS ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(viewer.id.toLowerCase()) || (!!viewer.email && allowed.includes(viewer.email.toLowerCase()));
}

const n = (v: unknown) => Number(v ?? 0);
const DAY = 86_400_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

export type Overview = {
  accounts: number; newToday: number; active24h: number; applications: number;
  runs24h: { done: number; error: number; passed: number }; cost24h: number; cost7d: number;
  byChallenge: { challenge: string; runs: number; passed: number; avgCost: number; avgSec: number }[];
  queued: number; running: number; oldestQueuedAt: string | null; lastHeartbeatAt: string | null;
  /** 실행 중인 단계가 있는데 생존 신호가 3분 넘게 끊겼다 (워커가 죽었을 수 있다) */
  heartbeatStale: boolean;
  failedRequests24h: number; serverErrors24h: number; activeWarnings: number;
};

export async function overview(): Promise<Overview> {
  const q = (await getDb()).query;
  const [acc] = await q<{ total: unknown; today: unknown }>('select count(*) total, count(*) filter (where created_at >= $1) today from accounts', [startOfTodayKst()]);
  const [act] = await q<{ n: unknown }>('select count(distinct account_id) n from events where at >= $1 and account_id is not null', [ago(DAY)]);
  const [apps] = await q<{ n: unknown }>('select count(*) n from applications');
  const [runs] = await q<{ done: unknown; error: unknown; passed: unknown; cost: unknown }>(
    `select count(*) filter (where status = 'done') done, count(*) filter (where status = 'error') error,
            count(*) filter (where passed) passed, coalesce(sum(cost_usd), 0) cost from stage_runs where finished_at >= $1`, [ago(DAY)]);
  const [week] = await q<{ cost: unknown }>('select coalesce(sum(cost_usd), 0) cost from stage_runs where finished_at >= $1', [ago(7 * DAY)]);
  const byChallenge = await q<{ challenge: string; runs: unknown; passed: unknown; avg_cost: unknown; avg_ms: unknown }>(
    `select challenge, count(*) runs, count(*) filter (where passed) passed, coalesce(avg(cost_usd), 0) avg_cost, avg(duration_ms) avg_ms
     from stage_runs where status = 'done' and finished_at >= $1 group by challenge`, [ago(7 * DAY)]);
  const [jobs] = await q<{ queued: unknown; running: unknown; oldest: string | Date | null; beat: string | Date | null }>(
    `select count(*) filter (where claimed_at is null) queued, count(*) filter (where claimed_at is not null) running,
            min(created_at) filter (where claimed_at is null) oldest, max(heartbeat_at) beat from jobs`);
  const [errs] = await q<{ failed: unknown; server: unknown }>(
    `select count(*) filter (where not ok and kind not in ('server_error', 'stage_error')) failed,
            count(*) filter (where kind in ('server_error', 'stage_error')) server from events where at >= $1`, [ago(DAY)]);
  const [warn] = await q<{ n: unknown }>('select count(*) n from warnings where revoked_at is null and created_at >= $1', [ago(WARNING.windowDays * DAY)]);
  const iso = (v: string | Date | null) => (v ? new Date(v).toISOString() : null);
  const order = ['doc', 'r1', 'r2', 'final'];
  return {
    accounts: n(acc.total), newToday: n(acc.today), active24h: n(act.n), applications: n(apps.n),
    runs24h: { done: n(runs.done), error: n(runs.error), passed: n(runs.passed) }, cost24h: n(runs.cost), cost7d: n(week.cost),
    byChallenge: byChallenge
      .map(r => ({ challenge: r.challenge, runs: n(r.runs), passed: n(r.passed), avgCost: n(r.avg_cost), avgSec: n(r.avg_ms) / 1000 }))
      .sort((a, b) => order.indexOf(a.challenge) - order.indexOf(b.challenge)),
    queued: n(jobs.queued), running: n(jobs.running), oldestQueuedAt: iso(jobs.oldest), lastHeartbeatAt: iso(jobs.beat),
    heartbeatStale: n(jobs.running) > 0 && !!jobs.beat && Date.now() - new Date(jobs.beat).getTime() > 3 * 60_000,
    failedRequests24h: n(errs.failed), serverErrors24h: n(errs.server), activeWarnings: n(warn.n),
  };
}

export type UserRow = {
  id: string; name: string; email: string | null; provider: string | null; createdAt: string; lastLoginAt: string | null; lastSeenAt: string | null;
  applications: number; ticketsToday: number; runs: number; costUsd: number; warnings: { id: number; rule: string; createdAt: string }[];
};

export async function users(limit = 200): Promise<UserRow[]> {
  const q = (await getDb()).query;
  const rows = await q<Record<string, unknown>>(
    `select a.id, a.display_name, a.email, a.provider, a.created_at, a.last_login_at,
       (select max(at) from events e where e.account_id = a.id) last_seen,
       (select count(*) from applications p where p.owner_id = a.id) apps,
       (select count(*) from tickets t where t.account_id = a.id and t.used_at >= $1) tickets_today,
       (select count(*) from stage_runs r where r.account_id = a.id) runs,
       (select coalesce(sum(cost_usd), 0) from stage_runs r where r.account_id = a.id) cost
     from accounts a order by coalesce((select max(at) from events e where e.account_id = a.id), a.created_at) desc limit $2`,
    [startOfTodayKst(), limit],
  );
  const warnings = await q<{ id: number; account_id: string; rule: string; created_at: string | Date }>(
    'select id, account_id, rule, created_at from warnings where revoked_at is null and created_at >= $1 order by created_at desc', [ago(WARNING.windowDays * DAY)]);
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
  return rows.map(r => ({
    id: r.id as string, name: r.display_name as string, email: (r.email as string) ?? null, provider: (r.provider as string) ?? null,
    createdAt: iso(r.created_at)!, lastLoginAt: iso(r.last_login_at), lastSeenAt: iso(r.last_seen),
    applications: n(r.apps), ticketsToday: n(r.tickets_today), runs: n(r.runs), costUsd: n(r.cost),
    warnings: warnings.filter(w => w.account_id === r.id).map(w => ({ id: Number(w.id), rule: w.rule, createdAt: iso(w.created_at)! })),
  }));
}

export type RunRow = {
  id: number; finishedAt: string; account: string; agent: string | null; applicationId: string; version: number; challenge: string; division: string;
  status: string; passed: boolean | null; result: string | null; error: string | null; durationSec: number; costUsd: number | null; backend: string | null;
};

export async function runs(filter: { failed?: boolean; account?: string } = {}, limit = 100): Promise<RunRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.failed) where.push("r.status = 'error'");
  if (filter.account) where.push(`r.account_id = $${params.push(filter.account)}`);
  params.push(limit);
  const rows = await (await getDb()).query<Record<string, unknown>>(
    `select r.*, a.display_name, p.agent_name from stage_runs r left join accounts a on a.id = r.account_id left join applications p on p.id = r.application_id
     ${where.length ? `where ${where.join(' and ')}` : ''} order by r.id desc limit $${params.length}`,
    params,
  );
  return rows.map(r => ({
    id: Number(r.id), finishedAt: new Date(r.finished_at as string).toISOString(), account: (r.display_name as string) ?? (r.account_id as string),
    agent: (r.agent_name as string) ?? null, applicationId: r.application_id as string, version: Number(r.version), challenge: r.challenge as string,
    division: r.division as string, status: r.status as string, passed: (r.passed as boolean) ?? null, result: (r.result as string) ?? null,
    error: (r.error as string) ?? null, durationSec: n(r.duration_ms) / 1000, costUsd: r.cost_usd == null ? null : n(r.cost_usd), backend: (r.backend as string) ?? null,
  }));
}

export async function runDetail(id: number): Promise<Record<string, unknown> | null> {
  const [row] = await (await getDb()).query<Record<string, unknown>>('select * from stage_runs where id = $1', [id]);
  return row ?? null;
}

export type EventRow = {
  id: number; at: string; kind: string; ok: boolean; status: number | null; method: string | null; path: string | null; account: string | null;
  applicationId: string | null; ip: string | null; userAgent: string | null; durationMs: number | null; data: Record<string, unknown>;
};

export async function events(filter: { kind?: string; failed?: boolean; account?: string } = {}, limit = 200): Promise<EventRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.kind) where.push(`e.kind = $${params.push(filter.kind)}`);
  if (filter.failed) where.push('not e.ok');
  if (filter.account) where.push(`e.account_id = $${params.push(filter.account)}`);
  params.push(limit);
  const rows = await (await getDb()).query<Record<string, unknown>>(
    `select e.*, a.display_name from events e left join accounts a on a.id = e.account_id
     ${where.length ? `where ${where.join(' and ')}` : ''} order by e.id desc limit $${params.length}`,
    params,
  );
  return rows.map(r => ({
    id: Number(r.id), at: new Date(r.at as string).toISOString(), kind: r.kind as string, ok: r.ok as boolean, status: r.status == null ? null : n(r.status),
    method: (r.method as string) ?? null, path: (r.path as string) ?? null,
    account: r.account_id ? `${(r.display_name as string) ?? ''} (${r.account_id as string})` : null, applicationId: (r.application_id as string) ?? null,
    ip: (r.ip as string) ?? null, userAgent: (r.user_agent as string) ?? null, durationMs: r.duration_ms == null ? null : n(r.duration_ms),
    data: (r.data as Record<string, unknown>) ?? {},
  }));
}

export async function eventKinds(): Promise<string[]> {
  const rows = await (await getDb()).query<{ kind: string }>('select distinct kind from events order by kind');
  return rows.map(r => r.kind);
}

export type SystemInfo = {
  db: string; migrations: { name: string; appliedAt: string }[]; node: string; uptimeSec: number; memoryMb: number;
  worker: { enabled: boolean; running: number }; config: { name: string; set: boolean }[];
  jobs: { id: number; applicationId: string; version: number; challenge: string; createdAt: string; claimedAt: string | null; heartbeatAt: string | null; workerId: string | null }[];
};

/** 값은 내보내지 않고 설정됐는지만 본다 */
const CONFIG = [
  'ANTHROPIC_API_KEY', 'DATABASE_URL', 'DATABASE_CA_CERT', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SITE_URL',
  'ARENA_BYOK_SECRET', 'ARENA_EXAM_SECRET', 'ARENA_ADMIN_EMAILS',
];

export async function system(): Promise<SystemInfo> {
  const db = await getDb();
  const migrations = await db.query<{ name: string; applied_at: string | Date }>('select name, applied_at from arena_migrations order by name');
  const jobs = await db.query<Record<string, unknown>>('select id, application_id, version, challenge, created_at, claimed_at, heartbeat_at, worker_id from jobs order by id');
  const worker = (globalThis as { __arenaWorker?: { running: number; started: boolean } }).__arenaWorker;
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
  return {
    db: db.kind, node: process.version, uptimeSec: Math.round(process.uptime()), memoryMb: Math.round(process.memoryUsage().rss / 1_048_576),
    migrations: migrations.map(m => ({ name: m.name, appliedAt: iso(m.applied_at)! })),
    worker: { enabled: Boolean(worker?.started), running: worker?.running ?? 0 },
    config: CONFIG.map(name => ({ name, set: Boolean(process.env[name]) })),
    jobs: jobs.map(j => ({
      id: Number(j.id), applicationId: j.application_id as string, version: Number(j.version), challenge: j.challenge as string,
      createdAt: iso(j.created_at)!, claimedAt: iso(j.claimed_at), heartbeatAt: iso(j.heartbeat_at), workerId: (j.worker_id as string) ?? null,
    })),
  };
}

/** 보안 실격 경고를 취소한다 (오탐 정정, docs/08 4번). 누가 취소했는지 접속 기록에 남긴다 */
export async function revokeWarning(id: number, admin: Viewer): Promise<void> {
  const rows = await (await getDb()).query<{ account_id: string; rule: string }>(
    'update warnings set revoked_at = now() where id = $1 and revoked_at is null returning account_id, rule', [id]);
  if (rows[0]) {
    await logEvent({ kind: 'admin_revoke_warning', ok: true, accountId: admin.id, data: { warningId: id, target: rows[0].account_id, rule: rows[0].rule } });
  }
}
