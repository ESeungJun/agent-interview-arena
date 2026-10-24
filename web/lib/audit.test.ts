// 운영 기록: 단계 실행·접속 기록이 남고, 지원자 키는 가려지고, 오래된 접속 기록만 지워진다 (LLM 호출 없음)
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { openTestDb, type Db } from './db.ts';

let db: Db;
before(async () => {
  db = await openTestDb();
  (globalThis as { __arenaDb?: Promise<Db> }).__arenaDb = Promise.resolve(db);
});

const { logEvent, recordStageRun, pruneEvents, clientMeta, EVENT_RETENTION_DAYS } = await import('./audit.ts');

const KEY = 'sk-ant-api03-' + 'x'.repeat(40);
const base = {
  applicationId: '00000000-0000-4000-8000-000000000001', version: 1, challenge: 'doc', accountId: 'u1', division: 'light',
  mdHash: 'h', quarter: '2026Q4', startedAt: new Date(Date.now() - 5000).toISOString(),
};
const usage = { interviewer: { costUsd: 0.12 }, candidate: { costUsd: 0.03 } };

test('성공한 단계는 측정값·결과·로그를 남긴다', async () => {
  await recordStageRun({
    ...base, status: 'done', passed: true, result: '✅ 서류 합격', backend: 'api', config: { seed: 1 }, usage, stages: { doc: { score: 80 } }, logs: ['서류 채점 시작'],
  });
  const [r] = await db.query<{ status: string; passed: boolean; cost_usd: string; duration_ms: number; logs: string[]; stages: unknown }>(
    "select * from stage_runs where status = 'done'",
  );
  assert.equal(r.passed, true);
  assert.equal(Number(r.cost_usd), 0.15);
  assert.ok(r.duration_ms >= 5000);
  assert.deepEqual(r.logs, ['서류 채점 시작']);
  assert.deepEqual(r.stages, { doc: { score: 80 } });
});

test('실패한 단계도 남기고 지원자 키는 가린다', async () => {
  await recordStageRun({ ...base, status: 'error', error: `호출 실패 ${KEY}`, logs: [`키 ${KEY}`] });
  const [r] = await db.query<{ error: string; logs: string[] }>("select error, logs from stage_runs where status = 'error'");
  assert.ok(!r.error.includes(KEY) && !JSON.stringify(r.logs).includes(KEY));
});

test('접속 기록: 프록시 뒤 첫 주소를 쓰고, 잘못된 지원서 id 는 비운다', async () => {
  const meta = clientMeta(new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1', 'user-agent': 'test' }));
  assert.deepEqual(meta, { ip: '203.0.113.7', userAgent: 'test' });
  await logEvent({ kind: 'application_submit', ok: false, status: 400, applicationId: 'not-a-uuid', ...meta, data: { error: `키 ${KEY}` } });
  const [e] = await db.query<{ ip: string; application_id: string | null; data: { error: string } }>('select * from events');
  assert.equal(e.ip, '203.0.113.7');
  assert.equal(e.application_id, null);
  assert.ok(!e.data.error.includes(KEY));
});

test('보관 기간이 지난 접속 기록만 지운다', async () => {
  const old = new Date(Date.now() - (EVENT_RETENTION_DAYS + 1) * 86_400_000).toISOString();
  await db.query("insert into events (kind, ok, at) values ('page_view', true, $1)", [old]);
  await pruneEvents();
  const rows = await db.query<{ kind: string }>('select kind from events');
  assert.deepEqual(rows.map(r => r.kind), ['application_submit']);
});
