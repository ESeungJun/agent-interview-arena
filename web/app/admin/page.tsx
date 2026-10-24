import { notFound } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  eventKinds, events, isAdmin, overview, revokeWarning, runDetail, runs, system, users,
  type EventRow, type RunRow, type UserRow,
} from '@/lib/admin';
import { auditPage } from '@/lib/audited';
import { getViewer } from '@/lib/auth';
import CopyButton from './CopyButton';
import './admin.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: '운영자', robots: { index: false, follow: false } };

type Search = Promise<Record<string, string | string[] | undefined>>;
const TABS = [
  ['overview', '개요'], ['users', '유저'], ['runs', '면접 실행'], ['logs', '접속·요청 로그'], ['system', '시스템'],
] as const;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const kst = (iso: string | null) => (iso ? new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false }) : '—');
const usd = (v: number | null) => (v == null ? '—' : `$${v.toFixed(v < 1 ? 4 : 2)}`);
const ago = (iso: string | null) => {
  if (!iso) return '—';
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  return s < 60 ? `${s}초 전` : s < 3600 ? `${Math.round(s / 60)}분 전` : s < 86_400 ? `${Math.round(s / 3600)}시간 전` : `${Math.round(s / 86_400)}일 전`;
};
const STAGE: Record<string, string> = { doc: '서류', r1: '1차', r2: '2차', final: '최종' };
const json = (v: unknown) => JSON.stringify(v, (_k, x) => (x instanceof Date ? x.toISOString() : x), 2);

async function revoke(form: FormData) {
  'use server';
  const viewer = await getViewer();
  if (!isAdmin(viewer)) notFound();
  await revokeWarning(Number(form.get('id')), viewer!);
  revalidatePath('/admin');
}

/** 운영자 화면. 운영자가 아니면 존재도 알리지 않는다 (404) */
export default async function AdminPage({ searchParams }: { searchParams: Search }) {
  const viewer = await getViewer();
  if (!isAdmin(viewer)) notFound();
  await auditPage('/admin');
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === one(sp.tab)) ? one(sp.tab)! : 'overview';

  return (
    <main className="admin">
      <header>
        <h1>Agent Interview Arena · 운영자</h1>
        <span className="who">{viewer!.email ?? viewer!.id}</span>
      </header>
      <nav>
        {TABS.map(([k, label]) => (
          <a key={k} href={`?tab=${k}`} aria-current={k === tab ? 'page' : undefined}>{label}</a>
        ))}
      </nav>
      {tab === 'overview' && <Overview />}
      {tab === 'users' && <Users />}
      {tab === 'runs' && <Runs run={one(sp.run)} failed={one(sp.failed) === '1'} account={one(sp.account)} />}
      {tab === 'logs' && <Logs kind={one(sp.kind)} failed={one(sp.failed) === '1'} account={one(sp.account)} />}
      {tab === 'system' && <System />}
    </main>
  );
}

async function Overview() {
  const o = await overview();
  const stale = o.heartbeatStale;
  return (
    <>
      <section className="tiles">
        <Tile label="계정" value={o.accounts} sub={`오늘 가입 ${o.newToday}`} />
        <Tile label="24시간 활동 계정" value={o.active24h} />
        <Tile label="지원서" value={o.applications} />
        <Tile label="24시간 면접 실행" value={o.runs24h.done + o.runs24h.error} sub={`합격 ${o.runs24h.passed} · 서버 오류 ${o.runs24h.error}`} warn={o.runs24h.error > 0} />
        <Tile label="비용" value={usd(o.cost24h)} sub={`7일 ${usd(o.cost7d)}`} />
        <Tile label="대기열" value={`${o.queued} 대기 · ${o.running} 실행`} sub={o.oldestQueuedAt ? `가장 오래 기다린 단계 ${ago(o.oldestQueuedAt)}` : '비어 있음'} warn={o.queued > 10} />
        <Tile label="워커 생존 신호" value={ago(o.lastHeartbeatAt)} sub={stale ? '3분 넘게 끊김' : o.running ? '정상' : '실행 중인 단계 없음'} warn={Boolean(stale)} />
        <Tile label="24시간 오류" value={o.serverErrors24h} sub={`실패한 요청 ${o.failedRequests24h}`} warn={o.serverErrors24h > 0} href="?tab=logs&failed=1" />
        <Tile label="유효한 보안 경고" value={o.activeWarnings} href="?tab=users" />
      </section>
      <h2>단계별 (최근 7일)</h2>
      <table>
        <thead><tr><th>단계</th><th className="num">실행</th><th className="num">합격률</th><th className="num">평균 비용</th><th className="num">평균 시간</th></tr></thead>
        <tbody>
          {o.byChallenge.length === 0 && <tr><td colSpan={5} className="empty">아직 실행 기록이 없습니다</td></tr>}
          {o.byChallenge.map(c => (
            <tr key={c.challenge}>
              <td>{STAGE[c.challenge] ?? c.challenge}</td><td className="num">{c.runs}</td>
              <td className="num">{c.runs ? `${Math.round((c.passed / c.runs) * 100)}%` : '—'}</td>
              <td className="num">{usd(c.avgCost)}</td><td className="num">{c.avgSec.toFixed(0)}초</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="note">API 백엔드는 아직 비용을 계산하지 않아 0으로 남을 수 있습니다. 토큰 수는 면접 실행 상세에 있습니다.</p>
    </>
  );
}

function Tile({ label, value, sub, warn, href }: { label: string; value: string | number; sub?: string; warn?: boolean; href?: string }) {
  const body = (
    <>
      <span className="label">{label}</span>
      <strong>{value}</strong>
      {sub && <span className="sub">{sub}</span>}
    </>
  );
  return href ? <a className={`tile${warn ? ' warn' : ''}`} href={href}>{body}</a> : <div className={`tile${warn ? ' warn' : ''}`}>{body}</div>;
}

async function Users() {
  const rows: UserRow[] = await users();
  return (
    <table>
      <thead>
        <tr><th>계정</th><th>이메일</th><th>가입</th><th>마지막 접속</th><th className="num">지원서</th><th className="num">오늘 티켓</th><th className="num">실행</th><th className="num">비용</th><th>보안 경고</th></tr>
      </thead>
      <tbody>
        {rows.length === 0 && <tr><td colSpan={9} className="empty">계정이 없습니다</td></tr>}
        {rows.map(u => (
          <tr key={u.id}>
            <td><strong>{u.name}</strong><span className="mono dim">{u.id}</span></td>
            <td>{u.email ?? '—'}<span className="dim">{u.provider ?? ''}</span></td>
            <td>{kst(u.createdAt)}</td>
            <td title={kst(u.lastSeenAt)}>{ago(u.lastSeenAt)}</td>
            <td className="num">{u.applications}</td><td className="num">{u.ticketsToday}</td>
            <td className="num"><a href={`?tab=runs&account=${encodeURIComponent(u.id)}`}>{u.runs}</a></td>
            <td className="num">{usd(u.costUsd)}</td>
            <td>
              {u.warnings.length === 0 && '—'}
              {u.warnings.map(w => (
                <form key={w.id} action={revoke} className="warning">
                  <input type="hidden" name="id" value={w.id} />
                  <span className="mono">{w.rule}</span> <span className="dim">{kst(w.createdAt)}</span>
                  <button type="submit">취소</button>
                </form>
              ))}
              <a className="dim" href={`?tab=logs&account=${encodeURIComponent(u.id)}`}>로그</a>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

async function Runs({ run, failed, account }: { run?: string; failed: boolean; account?: string }) {
  if (run) {
    const r = await runDetail(Number(run));
    if (!r) return <p className="empty">실행 기록이 없습니다</p>;
    const { logs, stages, usage, config, ...rest } = r;
    const full = [
      `# 실행 #${String(r.id)} · ${STAGE[r.challenge as string] ?? String(r.challenge)} · ${String(r.status)}`,
      json(rest),
      '## 진행 로그', ((logs as string[]) ?? []).join('\n') || '—',
      '## 측정값 (usage)', json(usage),
      '## 출제 설정 (config)', json(config),
      '## 판정 결과 (stages)', json(stages),
    ].join('\n\n');
    return (
      <section className="detail">
        <div className="bar"><a href="?tab=runs">← 목록</a><CopyButton text={full} label="전체 복사" /></div>
        <h2>실행 #{String(r.id)} · {STAGE[r.challenge as string] ?? String(r.challenge)} · {String(r.status)}</h2>
        <dl>{Object.entries(rest).map(([k, v]) => <div key={k}><dt>{k}</dt><dd className="mono">{v instanceof Date ? v.toISOString() : String(v ?? '—')}</dd></div>)}</dl>
        <h3>측정값 (usage)</h3><pre>{JSON.stringify(usage, null, 2)}</pre>
        <h3>출제 설정 (config)</h3><pre>{JSON.stringify(config, null, 2)}</pre>
        <h3>진행 로그</h3><pre>{((logs as string[]) ?? []).join('\n') || '—'}</pre>
        <details><summary>판정 결과 전체 (stages, 지원자 응답 포함)</summary><pre>{JSON.stringify(stages, null, 2)}</pre></details>
      </section>
    );
  }
  const rows: RunRow[] = await runs({ failed, account });
  return (
    <>
      <div className="filters">
        <a href="?tab=runs" aria-current={!failed && !account ? 'page' : undefined}>전체</a>
        <a href="?tab=runs&failed=1" aria-current={failed ? 'page' : undefined}>서버 오류만</a>
        {account && <span className="dim">계정 {account}</span>}
      </div>
      <table>
        <thead><tr><th>끝난 시각</th><th>계정</th><th>에이전트</th><th>단계</th><th>결과</th><th className="num">시간</th><th className="num">비용</th><th /></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={8} className="empty">실행 기록이 없습니다</td></tr>}
          {rows.map(r => (
            <tr key={r.id} className={r.status === 'error' ? 'bad' : undefined}>
              <td>{kst(r.finishedAt)}</td><td>{r.account}</td><td>{r.agent ?? '—'} <span className="dim">v{r.version} · {r.division}</span></td>
              <td>{STAGE[r.challenge] ?? r.challenge}</td>
              <td>{r.status === 'error' ? <span className="err">오류: {r.error}</span> : r.result}</td>
              <td className="num">{r.durationSec.toFixed(0)}초</td><td className="num">{usd(r.costUsd)}</td>
              <td className="actions">
                <a href={`?tab=runs&run=${r.id}`}>상세</a>
                {r.status === 'error' && <CopyButton text={json(r)} />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

async function Logs({ kind, failed, account }: { kind?: string; failed: boolean; account?: string }) {
  const [rows, kinds]: [EventRow[], string[]] = await Promise.all([events({ kind, failed, account }), eventKinds()]);
  const link = (p: Record<string, string | undefined>) => `?${new URLSearchParams(Object.entries({ tab: 'logs', ...p }).filter(([, v]) => v) as [string, string][])}`;
  return (
    <>
      <div className="filters">
        <a href={link({})} aria-current={!kind && !failed ? 'page' : undefined}>전체</a>
        <a href={link({ failed: '1', account })} aria-current={failed ? 'page' : undefined}>실패만</a>
        {kinds.map(k => <a key={k} href={link({ kind: k, account })} aria-current={k === kind ? 'page' : undefined}>{k}</a>)}
        {account && <span className="dim">계정 {account}</span>}
      </div>
      <table>
        <thead><tr><th>시각</th><th>종류</th><th>결과</th><th>요청</th><th>계정</th><th>IP</th><th className="num">ms</th><th>내용</th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={8} className="empty">기록이 없습니다</td></tr>}
          {rows.map(e => (
            <tr key={e.id} className={e.ok ? undefined : 'bad'}>
              <td>{kst(e.at)}</td><td className="mono">{e.kind}</td><td>{e.ok ? '성공' : '실패'}{e.status ? ` ${e.status}` : ''}</td>
              <td className="mono">{e.method} {e.path}</td><td>{e.account ?? '—'}</td>
              <td className="mono" title={e.userAgent ?? ''}>{e.ip ?? '—'}</td><td className="num">{e.durationMs ?? '—'}</td>
              <td className="mono">
                {Object.keys(e.data).length ? JSON.stringify(e.data) : ''}
                {!e.ok && <CopyButton text={json(e)} />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

async function System() {
  const s = await system();
  return (
    <>
      <section className="tiles">
        <Tile label="DB" value={s.db === 'postgres' ? 'Supabase Postgres' : 'PGlite (로컬)'} />
        <Tile label="면접 워커" value={s.worker.enabled ? `켜짐 · ${s.worker.running}개 실행 중` : '꺼짐'} warn={!s.worker.enabled} />
        <Tile label="서버 가동 시간" value={`${Math.floor(s.uptimeSec / 3600)}시간 ${Math.floor((s.uptimeSec % 3600) / 60)}분`} sub={`Node ${s.node} · 메모리 ${s.memoryMb}MB`} />
      </section>
      <h2>설정 (값은 표시하지 않음)</h2>
      <ul className="config">{s.config.map(c => <li key={c.name} className={c.set ? 'ok' : 'missing'}><span className="mono">{c.name}</span> {c.set ? '설정됨' : '없음'}</li>)}</ul>
      <h2>대기열 (jobs)</h2>
      <table>
        <thead><tr><th>id</th><th>지원서</th><th>단계</th><th>들어온 시각</th><th>워커가 잡은 시각</th><th>생존 신호</th></tr></thead>
        <tbody>
          {s.jobs.length === 0 && <tr><td colSpan={6} className="empty">비어 있습니다</td></tr>}
          {s.jobs.map(j => (
            <tr key={j.id}>
              <td>{j.id}</td><td className="mono">{j.applicationId} v{j.version}</td><td>{STAGE[j.challenge] ?? j.challenge}</td>
              <td>{kst(j.createdAt)}</td><td>{kst(j.claimedAt)}</td><td>{ago(j.heartbeatAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>적용된 마이그레이션</h2>
      <ul className="config">{s.migrations.map(m => <li key={m.name} className="ok"><span className="mono">{m.name}</span> {kst(m.appliedAt)}</li>)}</ul>
    </>
  );
}
