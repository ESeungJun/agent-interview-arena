process.env.ARENA_PASSES_REQUIRED = '1'; // 관문권 규칙(D-48)을 켠 채로 확인한다
// 접수·티켓·대기열·결과 숨김·리더보드를 메모리 PGlite 로 확인한다 (LLM 호출 없음)
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { openTestDb, type Db } from './db.ts';

let db: Db;
before(async () => {
  db = await openTestDb();
  (globalThis as { __arenaDb?: Promise<Db> }).__arenaDb = Promise.resolve(db);
  await db.query("insert into accounts (id, display_name) values ('u1', '하울'), ('u2', '다른 사람')");
});

const { submitApplication, reviseApplication, challengeState, ticketsUsedToday, suspendedUntil, startChallenge, passBalance, freeR1UsedToday, revealAttempt, ownedApplication } = await import('./runner.ts');
const { getApplication, mutateApplication, appendLogs } = await import('./store.ts');
const { leaderboard } = await import('./leaderboard.ts');

const md = (s: string) => `# ${s}\n코드 리뷰를 돕는 에이전트입니다. ${s}`;

/** 워커 대신 단계 결과를 써 넣는다 */
async function finish(id: string, challenge: 'doc' | 'r1' | 'r2', passed: boolean, score: number, extra: Record<string, unknown> = {}) {
  await mutateApplication(id, async (a, q) => {
    const v = a.versions[a.versions.length - 1];
    (v.results as Record<string, unknown>)[challenge] = { passed, score, ...extra };
    v.attempts[challenge] = { ...v.attempts[challenge]!, status: 'done', passed, finishedAt: new Date().toISOString() };
    await q('delete from jobs where application_id = $1', [a.id]);
  });
}
async function reveal(id: string, challenge: 'doc' | 'r1') {
  await mutateApplication(id, a => void (a.versions[a.versions.length - 1].attempts[challenge]!.revealedAt = new Date().toISOString()));
}

test('지원하면 티켓 1장을 쓰고 서류전형이 대기열에 들어간다', async () => {
  const r = await submitApplication({ ownerId: 'u1', agentName: 'reviewer.md', md: md('v1'), division: 'light' });
  assert.equal(r.ok, true);
  assert.equal((await ticketsUsedToday('u1')).light, 1);
  const jobs = await db.query<{ challenge: string }>('select challenge from jobs');
  assert.deepEqual(jobs.map(j => j.challenge), ['doc']);
  const app = await getApplication((r as { id: string }).id);
  assert.equal(app?.versions[0].attempts.doc?.status, 'queued');
});

test('같은 분기에 같은 .md 를 다시 내면 이전 지원서를 돌려주고 티켓을 쓰지 않는다', async () => {
  const r = await submitApplication({ ownerId: 'u1', agentName: 'other-name.md', md: md('v1'), division: 'light' });
  assert.equal(r.ok && r.reused, true);
  assert.equal((await ticketsUsedToday('u1')).light, 1);
});

test('계정당 동시에 걸어 둘 수 있는 면접은 2개이고, 밀린 지원은 티켓을 돌려준다', async () => {
  assert.equal((await submitApplication({ ownerId: 'u1', agentName: 'b.md', md: md('b'), division: 'light' })).ok, true);
  const third = await submitApplication({ ownerId: 'u1', agentName: 'c.md', md: md('c'), division: 'light' });
  assert.equal(third.ok, false);
  assert.match((third as { message: string }).message, /동시에 2개/);
  assert.equal((await ticketsUsedToday('u1')).light, 2);
});

test('접수하지 못한 지원서는 남지 않고, 티켓 없는 버전은 서류전형을 열 수 없다', async () => {
  const [{ n }] = await db.query<{ n: string }>("select count(*) as n from applications where agent_name = 'c.md'");
  assert.equal(Number(n), 0, '동시 상한에 막힌 지원서는 지워진다');
  // 티켓 없이 만들어진 지원서를 흉내 낸다 (예전 우회 경로)
  const id = crypto.randomUUID();
  const { createApplication } = await import('./store.ts');
  await createApplication({ id, ownerId: 'u2', agentName: 'z.md', division: 'light', createdAt: new Date().toISOString(),
    versions: [{ n: 1, md: md('z'), mdHash: 'z', quarter: '2026-Q4', createdAt: new Date().toISOString(), results: {}, attempts: {} }] });
  const r = await startChallenge(id, 'u2', 'doc');
  assert.equal(r.ok, false);
  assert.match((r as { message: string }).message, /티켓이 없습니다/);
});

test('결과를 열기 전에는 탈락이 드러나지 않고 재지원도 받지 않는다', async () => {
  const [row] = await db.query<{ id: string }>("select id from applications where agent_name = 'reviewer.md'");
  await finish(row.id, 'doc', false, 20);
  const app = (await getApplication(row.id))!;
  assert.deepEqual(challengeState(app), { running: null, next: null, canRevise: false, banned: false });
  const early = await submitApplication({ ownerId: 'u1', agentName: 'reviewer.md', md: md('v2'), division: 'light' });
  assert.match((early as { message: string }).message, /결과를 먼저 확인/);

  await reveal(row.id, 'doc');
  assert.equal(challengeState((await getApplication(row.id))!).canRevise, true);
  const again = await submitApplication({ ownerId: 'u1', agentName: 'reviewer.md', md: md('v2'), division: 'light' });
  assert.equal(again.ok && again.id, row.id);
  assert.equal((await getApplication(row.id))!.versions.length, 2);
  assert.equal((await ticketsUsedToday('u1')).light, 3);
});

test('경량급 티켓은 하루 3장이다', async () => {
  const [b] = await db.query<{ id: string }>("select id from applications where agent_name = 'b.md'");
  await finish(b.id, 'doc', false, 10);
  await reveal(b.id, 'doc');
  const app = (await getApplication(b.id))!;
  const r = await reviseApplication(app, { md: md('b2') });
  assert.equal(r.ok, false);
  assert.match((r as { message: string }).message, /티켓 3장을 모두/);
});

test('중량급·무제한급도 지원자 키 없이 서류를 받는다 (D-48)', async () => {
  assert.equal((await submitApplication({ ownerId: 'u2', agentName: 'x.md', md: md('x'), division: 'open' })).ok, true);
  assert.equal((await submitApplication({ ownerId: 'u2', agentName: 'x.md', md: md('x'), division: 'middle' })).ok, true);
});

test('보안 실격 경고가 90일 안에 3번이면 제출이 막힌다', async () => {
  for (let i = 0; i < 3; i++) await db.query("insert into warnings (account_id, rule) values ('u2', 'L1-HIDDEN')");
  assert.ok(await suspendedUntil('u2'));
  const r = await submitApplication({ ownerId: 'u2', agentName: 'y.md', md: md('y'), division: 'light' });
  assert.match((r as { message: string }).message, /제출할 수 없습니다/);
});

test('리더보드는 결과를 연 단계만, 에이전트별 최고 기록으로 센다', async () => {
  const [c] = await db.query<{ id: string }>("select id from applications where agent_name = 'reviewer.md'");
  await finish(c.id, 'doc', true, 55);
  assert.equal((await leaderboard('light', { fresh: true })).length, 0, '열기 전에는 순위에 없다');
  await reveal(c.id, 'doc');
  const board = await leaderboard('light', { fresh: true });
  assert.equal(board.length, 1);
  assert.equal(board[0].owner, '하울');
  assert.equal(board[0].reached, 'doc');
  assert.equal(board[0].scores.doc, 55);
  const started = await startChallenge(c.id, 'u1', 'r1');
  assert.equal(started.ok, true, '하루 첫 1차는 관문권 없이 도전한다');
  assert.equal(await freeR1UsedToday('u1'), 1);
});

test('결과를 짐작할 수 있는 진행 로그 줄은 결과를 열기 전에 뺀다', async () => {
  const { hideRevealing } = await import('./view-logs.ts');
  const logs = ['📄 서류전형', '  72점 (통과선 30)', '  ↻ 서류전형: "없다" 판정 2건 재확인 → 정정 없음', '💼 1차 면접', '  과제 3개 출제 → 지원자 실행 4회', '  🛡️ 방어 ATK-01 …', '  💥 뚫림 ATK-02 …'];
  assert.deepEqual(hideRevealing(logs), ['📄 서류전형', '💼 1차 면접', '  과제 3개 출제 → 지원자 실행 4회']);
});

test('서버 오류로 끝난 단계는 3번까지만 티켓 없이 다시 시도한다', async () => {
  const [c] = await db.query<{ id: string }>("select id from applications where agent_name = 'reviewer.md'");
  await mutateApplication(c.id, async (a, q) => {
    const v = a.versions[a.versions.length - 1];
    v.attempts.r1 = { status: 'error', logs: [], startedAt: new Date().toISOString(), errors: 3 };
    await q('delete from jobs where application_id = $1', [a.id]);
  });
  const r = await startChallenge(c.id, 'u1', 'r1');
  assert.equal(r.ok, false);
  assert.match((r as { message: string }).message, /3번 이어졌습니다/);
});

test('2차부터는 관문권을 쓰고, 서버 오류 뒤 다시 시도는 더 쓰지 않는다 (D-48)', async () => {
  const [c] = await db.query<{ id: string }>("select id from applications where agent_name = 'reviewer.md'");
  await finish(c.id, 'r1', true, 80);
  await reveal(c.id, 'r1');
  const none = await startChallenge(c.id, 'u1', 'r2');
  assert.equal(none.ok, false);
  assert.match((none as { message: string }).message, /관문권 1장이 필요/);

  await db.query("insert into pass_ledger (account_id, delta, reason) values ('u1', 1, 'grant')");
  assert.equal((await startChallenge(c.id, 'u1', 'r2')).ok, true);
  assert.equal(await passBalance('u1'), 0);

  await mutateApplication(c.id, async (a, q) => {
    a.versions[a.versions.length - 1].attempts.r2 = { status: 'error', logs: [], startedAt: new Date().toISOString(), errors: 1 };
    await q('delete from jobs where application_id = $1', [a.id]);
  });
  assert.equal((await startChallenge(c.id, 'u1', 'r2')).ok, true, '이미 낸 관문은 잔액이 없어도 다시 시도한다');
  assert.equal(await passBalance('u1'), 0);
});

test('남의 지원서는 도전·결과 열기·조회 모두 없는 것으로 본다', async () => {
  const [c] = await db.query<{ id: string }>("select id from applications where agent_name = 'reviewer.md'");
  const r = await startChallenge(c.id, 'u2', 'r2');
  assert.equal(r.ok, false);
  assert.equal((r as { status: number }).status, 404);
  assert.equal(await revealAttempt(c.id, 'u2', 'doc'), undefined);
  assert.equal(await ownedApplication(c.id, 'u2'), undefined);
  assert.equal((await ownedApplication(c.id, 'u1'))?.app.id, c.id);
});

test('결과 열기는 끝난 단계만 기록하고, 처음 연 시각을 지킨다', async () => {
  const [c] = await db.query<{ id: string }>("select id from applications where agent_name = 'reviewer.md'");
  await finish(c.id, 'r2', true, 70);
  const first = await revealAttempt(c.id, 'u1', 'r2');
  const at = first?.app.versions.at(-1)!.attempts.r2!.revealedAt;
  assert.ok(at);
  const again = await revealAttempt(c.id, 'u1', 'r2');
  assert.equal(again?.app.versions.at(-1)!.attempts.r2!.revealedAt, at);
  assert.equal(await revealAttempt(c.id, 'u1', 'final'), undefined, '도전하지 않은 단계는 열 수 없다');
  assert.equal(first?.counts.balance, 0);
});

test('관문권이 있어도 접수하지 못하면 쓰지 않는다 (같은 트랜잭션에서 되돌린다)', async () => {
  const [c] = await db.query<{ id: string }>("select id from applications where agent_name = 'reviewer.md'");
  await db.query("insert into pass_ledger (account_id, delta, reason) values ('u1', 1, 'grant')");
  // 동시 상한(2)을 채운다
  const [b] = await db.query<{ id: string }>("select id from applications where agent_name = 'b.md'");
  await db.query("insert into jobs (application_id, version, challenge) values ($1, 1, 'doc'), ($1, 1, 'r1')", [b.id]);
  const r = await startChallenge(c.id, 'u1', 'final');
  assert.equal(r.ok, false);
  assert.match((r as { message: string }).message, /동시에 2개/);
  assert.equal(await passBalance('u1'), 1, '돌려줄 것 없이 그대로다');
  await db.query('delete from jobs where application_id = $1', [b.id]);
  const ok = await startChallenge(c.id, 'u1', 'final');
  assert.equal(ok.ok, true);
  assert.equal(ok.ok && ok.counts.balance, 0, '응답에 쓴 뒤 잔액을 담는다');
  assert.equal(await passBalance('u1'), 0);
});

test('진행 로그는 그 단계 로그 끝에만 덧붙는다', async () => {
  const [c] = await db.query<{ id: string }>("select id from applications where agent_name = 'reviewer.md'");
  const n = (await getApplication(c.id))!.versions.at(-1)!.n;
  await appendLogs(c.id, n, 'final', ['첫 줄']);
  await appendLogs(c.id, n, 'final', ['둘째 줄', '셋째 줄']);
  const a = (await getApplication(c.id))!.versions.at(-1)!.attempts;
  assert.deepEqual(a.final!.logs, ['첫 줄', '둘째 줄', '셋째 줄']);
  assert.equal(a.final!.status, 'queued');
});
