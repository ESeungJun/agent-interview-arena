/**
 * 운영 기록 (supabase/migrations/0003_audit_log.sql).
 * - events: 접속·요청·로그인·보안 경고. 덧붙이기만 하고 EVENT_RETENTION_DAYS 가 지나면 지운다
 * - stage_runs: 면접 단계를 돌릴 때마다 한 줄. 토큰·비용·시간 측정값, 판정 결과, 진행 로그 원문 (지우지 않는다)
 * 기록이 실패해도 요청과 면접을 막지 않는다. 지원자 키는 maskKeys 로 가리고, 요청 본문·쿠키는 남기지 않는다.
 */
import { maskKeys } from './byok.ts';
import { getDb } from './db.ts';

/** 접속 기록 보관 기간. 개인정보 처리방침에 같은 기간을 적는다 */
export const EVENT_RETENTION_DAYS = 365;

export type EventInput = {
  kind: string;
  ok: boolean;
  accountId?: string | null;
  applicationId?: string | null;
  version?: number | null;
  challenge?: string | null;
  method?: string;
  path?: string;
  status?: number;
  durationMs?: number;
  ip?: string | null;
  userAgent?: string | null;
  data?: Record<string, unknown>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOrNull = (id?: string | null) => (id && UUID.test(id) ? id : null);

/** 요청 헤더에서 접속 정보를 뽑는다. 프록시 뒤라 x-forwarded-for 의 첫 주소가 접속한 쪽이다 */
export function clientMeta(h: Headers): { ip: string | null; userAgent: string | null } {
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || null;
  return { ip: ip?.slice(0, 64) ?? null, userAgent: h.get('user-agent')?.slice(0, 300) ?? null };
}

export async function logEvent(e: EventInput): Promise<void> {
  try {
    await (await getDb()).query(
      `insert into events (kind, ok, account_id, application_id, version, challenge, method, path, status, duration_ms, ip, user_agent, data)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        e.kind, e.ok, e.accountId ?? null, uuidOrNull(e.applicationId), e.version ?? null, e.challenge ?? null, e.method ?? null,
        e.path?.slice(0, 300) ?? null, e.status ?? null, e.durationMs ?? null, e.ip ?? null, e.userAgent ?? null,
        JSON.parse(maskKeys(JSON.stringify(e.data ?? {}))),
      ],
    );
  } catch (err) {
    console.error('[audit] 접속 기록 저장 실패:', maskKeys(err instanceof Error ? err.message : String(err)));
  }
}

type Usage = Record<'interviewer' | 'candidate', { costUsd: number | null }>;

export type StageRunInput = {
  applicationId: string;
  version: number;
  challenge: string;
  accountId: string;
  division: string;
  mdHash: string;
  quarter: string;
  startedAt: string;
  workerId?: string;
  logs: string[];
} & (
  | { status: 'done'; passed: boolean; securityBan?: string; result: string; backend: string; config: unknown; usage: Usage; stages: unknown }
  | { status: 'error'; error: string; usage?: Usage }
);

export async function recordStageRun(r: StageRunInput): Promise<void> {
  const done = r.status === 'done' ? r : undefined;
  const cost = r.usage ? (r.usage.interviewer.costUsd ?? 0) + (r.usage.candidate.costUsd ?? 0) : null;
  const json = (v: unknown) => (v === undefined ? null : JSON.parse(maskKeys(JSON.stringify(v))));
  try {
    await (await getDb()).query(
      `insert into stage_runs (application_id, version, challenge, account_id, division, md_hash, quarter, status, passed, security_ban, result, error,
         backend, worker_id, started_at, duration_ms, cost_usd, config, usage, stages, logs)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
      [
        r.applicationId, r.version, r.challenge, r.accountId, r.division, r.mdHash, r.quarter, r.status, done?.passed ?? null, done?.securityBan ?? null,
        done?.result ?? null, r.status === 'error' ? maskKeys(r.error) : null, done?.backend ?? null, r.workerId ?? null, r.startedAt,
        Math.max(0, Date.now() - new Date(r.startedAt).getTime()), cost, json(done?.config), json(r.usage), json(done?.stages), json(r.logs.map(maskKeys)),
      ],
    );
  } catch (err) {
    console.error('[audit] 단계 실행 기록 저장 실패:', maskKeys(err instanceof Error ? err.message : String(err)));
  }
}

/** 보관 기간이 지난 접속 기록을 지운다 (워커 정리 주기에 돈다) */
export async function pruneEvents(): Promise<void> {
  await (await getDb()).query('delete from events where at < $1', [new Date(Date.now() - EVENT_RETENTION_DAYS * 86_400_000).toISOString()]);
}
