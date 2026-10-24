/**
 * 면접 워커. 대기열(jobs)에서 단계를 하나씩 꺼내 core 의 runChallenge 로 돌리고 결과를 지원서에 쓴다.
 *
 * 웹 서버 프로세스 안에서 돈다 (instrumentation.ts 가 시작). 로컬 PGlite 는 한 프로세스만 열 수 있고,
 * 운영도 시즌 1 규모에서는 한 프로세스면 충분하다. 웹을 여러 대로 늘리면 ARENA_WORKER=off 로 끄고 워커 한 대만 남긴다.
 * 대기열은 `for update skip locked` 로 꺼내 워커가 여럿이어도 같은 단계를 두 번 돌리지 않는다.
 * 붙잡은 단계는 워커가 살아 있다는 신호(heartbeat_at)를 주기적으로 갱신한다. 신호가 끊긴 단계만 오류로 돌린다.
 */
import { randomUUID } from 'node:crypto';
import { runChallenge, type Challenge } from '../../core/interview.ts';
import { logEvent, pruneEvents, recordStageRun } from './audit.ts';
import { BYOK_TTL_MS, maskKeys, openKey } from './byok.ts';
import { getDb } from './db.ts';
import { arenaLlm } from './llm.ts';
import { DIVISIONS, INTERVIEWER, LIMITS } from './policy.ts';
import { securityBanOf } from './runner.ts';
import { examStore, getApplication, mutateApplication, mutateAttempt } from './store.ts';

/** 공격 편성 시드용 비밀값. 운영은 필수다. 없으면 시드를 계산할 수 있어 쉬운 편성을 골라 낼 수 있다 (core/exam.ts). */
function examSecret(): string | undefined {
  const secret = process.env.ARENA_EXAM_SECRET;
  if (!secret && process.env.NODE_ENV === 'production') throw new Error('ARENA_EXAM_SECRET 이 없습니다');
  return secret;
}

type Job = { id: number; application_id: string; version: number; challenge: Challenge; byok_cipher: string | null; created_at: string | Date };

const POLL_MS = 2000;
/** 생존 신호를 이 간격으로 갱신한다 */
const HEARTBEAT_MS = 30_000;
/** 생존 신호가 이만큼 끊긴 단계는 워커가 죽은 것으로 보고 오류로 돌린다 */
const STALE_MS = 3 * 60_000;
const LOG_FLUSH_MS = 1500;
/** 이 프로세스의 워커 이름 (생존 신호·결과 쓰기 확인에 쓴다) */
const WORKER_ID = randomUUID();

const g = globalThis as unknown as { __arenaWorker?: { running: number; started: boolean; wake?: () => void } };
const state = (g.__arenaWorker ??= { running: 0, started: false });

const sleep = (ms: number) => new Promise<void>(resolve => {
  const t = setTimeout(resolve, ms);
  state.wake = () => {
    clearTimeout(t);
    resolve();
  };
});

export function startWorker(): void {
  if (state.started) return;
  state.started = true;
  void loop();
}

/** 새 단계가 들어왔으면 기다리지 말고 바로 꺼내 보게 한다 */
export function kickWorker(): void {
  state.wake?.();
}

async function loop(): Promise<void> {
  // 처음 한 번은 바로 정리한다 (재시작 전에 이 서버가 붙잡고 있던 단계가 신호 없이 남아 있을 수 있다)
  let lastSweep = 0;
  setInterval(() => void heartbeat().catch(() => undefined), HEARTBEAT_MS).unref?.();
  for (;;) {
    try {
      if (Date.now() - lastSweep > 60_000) {
        lastSweep = Date.now();
        await sweep();
      }
      while (state.running < LIMITS.workers) {
        const job = await claim();
        if (!job) break;
        state.running++;
        void run(job).finally(() => {
          state.running--;
          kickWorker();
        });
      }
    } catch (e) {
      console.error('[worker] 대기열 처리 실패:', maskKeys(e instanceof Error ? e.message : String(e)));
    }
    await sleep(POLL_MS);
  }
}

async function claim(): Promise<Job | null> {
  const rows = await (await getDb()).query<Job>(
    `update jobs set claimed_at = now(), heartbeat_at = now(), worker_id = $1
     where id = (select id from jobs where claimed_at is null order by id limit 1 for update skip locked)
     returning id, application_id, version, challenge, byok_cipher, created_at`,
    [WORKER_ID],
  );
  return rows[0] ?? null;
}

async function heartbeat(): Promise<void> {
  await (await getDb()).query('update jobs set heartbeat_at = now() where worker_id = $1', [WORKER_ID]);
}

/** 이 워커가 아직 이 단계를 맡고 있는지 (정리 작업이 오류로 돌리고 지웠으면 결과를 쓰지 않는다) */
async function stillMine(jobId: number): Promise<boolean> {
  return (await (await getDb()).query('select 1 from jobs where id = $1 and worker_id = $2', [jobId, WORKER_ID])).length > 0;
}

async function drop(jobId: number): Promise<void> {
  await (await getDb()).query('delete from jobs where id = $1', [jobId]);
}

/** fromSweep: 정리 작업이 돌린 오류. 실행 중 오류는 run 이 stage_runs 에 남기고, 이쪽은 events 에 남긴다 */
async function fail(job: Pick<Job, 'id' | 'application_id' | 'version' | 'challenge'>, message: string, fromSweep = false): Promise<void> {
  if (fromSweep) {
    await logEvent({
      kind: 'stage_error', ok: false, applicationId: job.application_id, version: job.version, challenge: job.challenge, data: { error: maskKeys(message), by: 'sweep' },
    });
  }
  await mutateAttempt(job.application_id, job.version, job.challenge, a => ({
    ...a, status: 'error', error: maskKeys(message), errors: (a.errors ?? 0) + 1, finishedAt: new Date().toISOString(),
  }));
  await drop(job.id);
}

/** 오래 붙잡힌 단계(워커가 죽음)와 키 보관 시간이 지난 무제한급 단계를 오류로 돌린다. 오류는 탈락이 아니라 다시 시도할 수 있다 */
async function sweep(): Promise<void> {
  const db = await getDb();
  const stale = await db.query<Job>('select id, application_id, version, challenge from jobs where claimed_at is not null and coalesce(heartbeat_at, claimed_at) < $1', [
    new Date(Date.now() - STALE_MS).toISOString(),
  ]);
  for (const job of stale) await fail(job, '면접 워커가 끝내지 못했습니다', true);
  const expired = await db.query<Job>('select id, application_id, version, challenge from jobs where claimed_at is null and byok_cipher is not null and created_at < $1', [
    new Date(Date.now() - BYOK_TTL_MS).toISOString(),
  ]);
  for (const job of expired) await fail(job, '대기 시간이 길어 지원자 키를 버렸습니다', true);
  await pruneEvents();
}

async function run(job: Job): Promise<void> {
  const { application_id: id, version: n, challenge } = job;
  // 진행 로그는 모아서 잠깐마다 한 번에 쓴다 (줄마다 쓰면 지원서 행을 너무 자주 잠근다)
  let pending: string[] = [];
  // 단계 실행 기록(stage_runs)에 남길 진행 로그 전체
  const allLogs: string[] = [];
  let audit: Omit<Parameters<typeof recordStageRun>[0], 'status' | 'logs'> | undefined;
  let flushing: Promise<void> = Promise.resolve();
  const flush = () => {
    if (pending.length === 0) return flushing;
    const lines = pending;
    pending = [];
    // 로그 쓰기가 한 번 실패해도 이후 쓰기와 결과 저장을 막지 않는다 (로그는 진행 표시용이다)
    flushing = flushing
      .then(() => mutateAttempt(id, n, challenge, a => ({ ...a, logs: [...a.logs, ...lines] })))
      .catch(e => console.error('[worker] 진행 로그 저장 실패:', maskKeys(e instanceof Error ? e.message : String(e))));
    return flushing;
  };
  const timer = setInterval(() => void flush(), LOG_FLUSH_MS);
  try {
    const app = await getApplication(id);
    const version = app?.versions.find(v => v.n === n);
    if (!app || !version?.attempts[challenge]) return void (await drop(job.id));
    if (Date.now() - new Date(job.created_at).getTime() > BYOK_TTL_MS && job.byok_cipher) throw new Error('대기 시간이 길어 지원자 키를 버렸습니다');
    const division = DIVISIONS[app.division];
    const byokKey = job.byok_cipher ? openKey(job.byok_cipher) : undefined;
    await mutateAttempt(id, n, challenge, a => ({ ...a, status: 'running' }));
    audit = {
      applicationId: id, version: n, challenge, accountId: app.ownerId, division: app.division, mdHash: version.mdHash, quarter: version.quarter,
      startedAt: new Date().toISOString(), workerId: WORKER_ID,
    };
    const report = await runChallenge(
      {
        md: version.md,
        llm: await arenaLlm({ effort: version.effort, byokKey }),
        examStore,
        target: 'claude',
        division: app.division,
        engine: division.engine,
        interviewer: INTERVIEWER,
        // 정규식은 키워드 없는 정중한 주입을 못 잡는다. 표본 검사(10%)로 두면 나머지 90%는 서류 면접관 한 명만 막는다.
        screenAll: true,
        examSecret: examSecret(),
        log: line => {
          const masked = maskKeys(line);
          pending.push(masked);
          allLogs.push(masked);
        },
      },
      challenge,
      version.results,
    );
    clearInterval(timer);
    await flush();
    if (!(await stillMine(job.id))) {
      console.error(`[application ${id} v${n} ${challenge}] 정리 작업이 이미 오류로 돌린 단계라 결과를 버립니다`);
      // 결과는 버려도 쓴 비용은 남긴다
      await recordStageRun({ ...audit, status: 'error', logs: allLogs, error: '정리 작업이 이미 오류로 돌린 단계라 결과를 버림', usage: report.usage });
      return;
    }
    await mutateApplication(id, async (a, q) => {
      const v = a.versions.find(x => x.n === n)!;
      v.results = { ...v.results, ...report.stages };
      v.attempts[challenge] = {
        ...v.attempts[challenge]!, status: 'done', result: report.result, passed: report.passed, backend: report.backend, finishedAt: new Date().toISOString(),
      };
      // 보안 실격은 계정 경고 1회 (90일 안에 3회면 제출 정지)
      const ban = securityBanOf(report.stages);
      if (ban) await q('insert into warnings (account_id, application_id, rule) values ($1, $2, $3)', [a.ownerId, a.id, ban.rule]);
    });
    const ban = securityBanOf(report.stages);
    await recordStageRun({
      ...audit, status: 'done', logs: allLogs, passed: report.passed, securityBan: ban?.rule, result: report.result, backend: report.backend,
      config: report.config, usage: report.usage, stages: report.stages,
    });
    if (ban) await logEvent({ kind: 'security_warning', ok: false, accountId: app.ownerId, applicationId: id, version: n, challenge, data: { rule: ban.rule } });
    await drop(job.id);
  } catch (e) {
    clearInterval(timer);
    await flush().catch(() => undefined);
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[application ${id} v${n} ${challenge}] 실패:`, maskKeys(message));
    if (audit) await recordStageRun({ ...audit, status: 'error', logs: allLogs, error: message });
    else await logEvent({ kind: 'stage_error', ok: false, applicationId: id, version: n, challenge, data: { error: maskKeys(message), by: 'run' } });
    await fail(job, message);
  } finally {
    clearInterval(timer);
  }
}
