/**
 * 지원서와 출제분 저장소 (Postgres / PGlite).
 *
 * 지원서 = 계정의 에이전트 하나(체급 하나). 그 안에 .md 버전(v1, v2, …)이 쌓인다. 떨어지면 고친 .md 로 새 버전을 만들어 서류부터 다시 본다.
 * 버전마다 서류 → 1차 → 2차 → 최종을 한 단계씩 도전하며, 단계 결과(results)를 쌓아 다음 단계에 넘긴다.
 */
import type { ExamRecord, ExamStore } from '../../core/exam.ts';
import type { Challenge, StageResults } from '../../core/interview.ts';
import { getDb, type Query } from './db.ts';
import type { Division, Effort } from './policy.ts';

export type AttemptStatus = 'queued' | 'running' | 'done' | 'error';

export type Attempt = {
  status: AttemptStatus;
  logs: string[];
  startedAt: string;
  finishedAt?: string;
  /** 결과 한 줄 (예: "✅ 📄 서류전형 합격") */
  result?: string;
  passed?: boolean;
  backend?: string;
  /** 서버 오류 메시지 (화면에는 내려 주지 않는다). 탈락이 아니므로 다시 시도할 수 있다 */
  error?: string;
  /** 이 단계가 서버 오류로 끝난 횟수 (다시 시도 상한) */
  errors?: number;
  /** 응시자가 결과 통지서를 연 시각. 열기 전에는 합격·불합격을 응답에 담지 않는다 */
  revealedAt?: string;
};

export type Version = {
  /** 1부터 */
  n: number;
  md: string;
  mdHash: string;
  quarter: string;
  createdAt: string;
  /** 지원자 엔진 추론 강도 (체급 상한 안에서 지원자가 고른다) */
  effort?: Effort;
  /** 끝난 단계의 결과. 다음 단계가 앞 단계 출력을 쓴다 */
  results: StageResults;
  attempts: Partial<Record<Challenge, Attempt>>;
};

export type Application = {
  id: string;
  ownerId: string;
  agentName: string;
  division: Division;
  createdAt: string;
  versions: Version[];
  /** 휴지통으로 옮긴 시각. 있으면 새 도전을 받지 않고 리더보드에서도 뺀다 */
  trashedAt?: string;
  /** 대기실 캐릭터 */
  character?: { job: string; tone: string; reason: string };
};

type Row = { doc: Application };

export async function createApplication(app: Application, q?: Query): Promise<void> {
  const run = q ?? (await getDb()).query;
  await run('insert into applications (id, owner_id, agent_name, division, doc, created_at) values ($1, $2, $3, $4, $5, $6)', [
    app.id, app.ownerId, app.agentName, app.division, app, app.createdAt,
  ]);
}

export async function getApplication(id: string): Promise<Application | undefined> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
  const rows = await (await getDb()).query<Row>('select doc from applications where id = $1', [id]);
  return rows[0]?.doc;
}

/** 휴지통에 있는 것까지 포함한다. 화면은 trashedAt 으로 나눈다 */
export async function listByOwner(ownerId: string): Promise<Application[]> {
  const rows = await (await getDb()).query<Row>('select doc from applications where owner_id = $1 order by created_at desc', [ownerId]);
  return rows.map(r => r.doc);
}

export async function listByDivision(division: Division): Promise<Application[]> {
  const rows = await (await getDb()).query<Row>('select doc from applications where division = $1', [division]);
  return rows.map(r => r.doc);
}

/** 최근 끝난 도전들 (예상 소요 시간 계산용) */
export async function listRecent(limit = 200): Promise<Application[]> {
  const rows = await (await getDb()).query<Row>('select doc from applications order by updated_at desc limit $1', [limit]);
  return rows.map(r => r.doc);
}

/**
 * 지원서 하나를 잠그고 고친다. fn 이 돌려준 값을 돌려준다. 같은 트랜잭션에서 다른 표도 고칠 수 있게 Query 를 넘긴다.
 * 동시에 들어온 요청은 행 잠금으로 줄을 선다 — 상태 확인과 기록을 fn 안에서 하면 두 번 접수되지 않는다.
 */
export async function mutateApplication<T>(id: string, fn: (app: Application, q: Query) => T | Promise<T>): Promise<T | undefined> {
  return (await getDb()).tx(async q => {
    const rows = await q<Row>('select doc from applications where id = $1 for update', [id]);
    const app = rows[0]?.doc;
    if (!app) return undefined;
    const result = await fn(app, q);
    await q('update applications set doc = $2, updated_at = now() where id = $1', [id, app]);
    return result;
  });
}

/** 특정 버전의 한 단계 도전 기록을 고친다 */
export function mutateAttempt(id: string, n: number, challenge: Challenge, fn: (attempt: Attempt) => Attempt): Promise<void> {
  return mutateApplication(id, app => {
    const v = app.versions.find(x => x.n === n);
    const cur = v?.attempts[challenge];
    if (v && cur) v.attempts[challenge] = fn(cur);
  }).then(() => undefined);
}

export async function removeApplication(id: string): Promise<void> {
  await (await getDb()).query('delete from applications where id = $1', [id]);
}

export function currentVersion(app: Application): Version {
  return app.versions[app.versions.length - 1];
}

export const examStore: ExamStore = {
  async load(quarter, hash) {
    const rows = await (await getDb()).query<{ data: ExamRecord }>('select data from exams where quarter = $1 and md_hash = $2', [quarter, hash]);
    return rows[0]?.data;
  },
  async save(record) {
    await (await getDb()).query(
      'insert into exams (quarter, md_hash, data) values ($1, $2, $3) on conflict (quarter, md_hash) do update set data = excluded.data',
      [record.quarter, record.mdHash, record],
    );
  },
};
