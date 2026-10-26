/**
 * DB 연결. 운영은 DATABASE_URL(Supabase Postgres)로 node-postgres 풀을 쓰고, 없으면 로컬 개발용 PGlite(WASM Postgres)를 web/.data 에 연다.
 * 두 쪽 모두 같은 SQL 을 쓴다. 시작할 때 supabase/migrations 의 SQL 을 순서대로 한 번씩 적용한다.
 * PGlite 는 한 프로세스만 열 수 있어 면접 워커도 웹 서버 프로세스 안에서 돈다 (lib/worker.ts).
 */
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export type Query = <T = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<T[]>;
export type Db = {
  query: Query;
  /** 여러 문장으로 된 SQL 을 그대로 실행한다 (마이그레이션) */
  exec(sql: string): Promise<void>;
  /** 한 트랜잭션 안에서 실행한다. 실패하면 되돌린다. exec 는 같은 트랜잭션에서 여러 문장 SQL 을 돌린다 */
  tx<T>(fn: (q: Query, exec: (sql: string) => Promise<void>) => Promise<T>): Promise<T>;
  kind: 'postgres' | 'pglite';
};

const MIGRATIONS = path.join(process.cwd(), 'supabase', 'migrations');

async function postgres(url: string): Promise<Db> {
  const { default: pg } = await import('pg');
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  // Supabase CA 인증서(PEM)를 DATABASE_CA_CERT 로 주면 서버 인증서를 검증한다 (README 배포 절 참고).
  // 운영에서 없으면 열지 않는다. 검증 없이 열면 중간에서 DB 연결을 가로챌 수 있다. 개발에서는 암호화만 한다
  const ca = process.env.DATABASE_CA_CERT;
  if (!local && !ca && process.env.NODE_ENV === 'production') throw new Error('DATABASE_CA_CERT 가 없습니다');
  const ssl = local ? undefined : ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false };
  // DB 가 컨테이너와 다른 지역에 있어 새 연결 하나에 0.6초쯤 든다 (TCP·TLS·인증 왕복). 쉬는 연결을 닫지 않고 붙들어 둔다
  const pool = new pg.Pool({ connectionString: url, max: 5, ssl, idleTimeoutMillis: 0, keepAlive: true });
  // 끊긴 연결은 풀이 버리고 다음 요청에서 새로 연다. 오류 이벤트를 받지 않으면 프로세스가 죽는다
  pool.on('error', e => console.error('[db] 쉬는 연결 오류:', e.message));
  return {
    kind: 'postgres',
    query: async (text, params) => (await pool.query(text, params)).rows,
    exec: async sql => void (await pool.query(sql)),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const result = await fn(async (text, params) => (await client.query(text, params)).rows, async sql => void (await client.query(sql)));
        await client.query('commit');
        return result;
      } catch (e) {
        await client.query('rollback');
        throw e;
      } finally {
        client.release();
      }
    },
  };
}

async function pglite(dir: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  if (dir !== 'memory://') mkdirSync(dir, { recursive: true });
  const db = await PGlite.create(dir);
  return {
    kind: 'pglite',
    query: async (text, params) => (await db.query(text, params)).rows as never,
    exec: async sql => void (await db.exec(sql)),
    tx: fn => db.transaction(t => fn(async (text, params) => (await t.query(text, params)).rows as never, async sql => void (await t.exec(sql)))),
  };
}

/** 마이그레이션을 서버 여러 대가 동시에 돌리지 않게 잡는 잠금 번호 */
const MIGRATION_LOCK = 7_270_031;

async function migrate(db: Db): Promise<void> {
  await db.tx(async q => {
    await q('select pg_advisory_xact_lock($1)', [MIGRATION_LOCK]);
    await q('create table if not exists arena_migrations (name text primary key, applied_at timestamptz not null default now())');
    // 이 표도 공개 REST(anon 키)로 건드릴 수 없게 한다
    await q('alter table arena_migrations enable row level security');
  });
  const done = new Set((await db.query<{ name: string }>('select name from arena_migrations')).map(r => r.name));
  for (const name of readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort()) {
    if (done.has(name)) continue;
    const sql = readFileSync(path.join(MIGRATIONS, name), 'utf8');
    await db.tx(async (q, exec) => {
      await q('select pg_advisory_xact_lock($1)', [MIGRATION_LOCK]);
      // 다른 서버가 먼저 적용했으면 건너뛴다
      if ((await q('select 1 from arena_migrations where name = $1', [name])).length > 0) return;
      await exec(sql);
      await q('insert into arena_migrations (name) values ($1)', [name]);
    });
  }
}

/** 테스트용: 메모리 PGlite 에 스키마를 적용해 돌려준다 */
export async function openTestDb(): Promise<Db> {
  const db = await pglite('memory://');
  await migrate(db);
  return db;
}

const g = globalThis as unknown as { __arenaDb?: Promise<Db> };

/** 프로세스에 하나뿐인 DB 연결 (next dev 가 모듈을 다시 불러와도 유지) */
export function getDb(): Promise<Db> {
  g.__arenaDb ??= (async () => {
    const url = process.env.DATABASE_URL;
    const db = url ? await postgres(url) : await pglite(process.env.PGLITE_DIR ?? path.join(process.cwd(), '.data', 'pglite'));
    await migrate(db);
    return db;
  })().catch(e => {
    // 일시적인 접속 실패로 프로세스가 영영 못 쓰게 되지 않게, 다음 요청에서 다시 연다
    g.__arenaDb = undefined;
    throw e;
  });
  return g.__arenaDb;
}
