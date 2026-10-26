'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import AgentCard, { type AgentMood } from '../../pixel/AgentCard';
import Backdrop from '../../pixel/Backdrop';
import Corridor, { DOORS, maskedState } from '../../pixel/Corridor';
import Dialog from '../../pixel/Dialog';
import ResultLetter from '../../pixel/ResultLetter';
import { agentSprite, BASE, CALL, STAGE_TITLE as TITLES, type Challenge } from '../../pixel/cast';
import LiveStatus, { type Estimate } from './LiveStatus';
import ReviseForm from './ReviseForm';

const POLL_MS = 3000;

type Feedback = { problem: string; fix_example: string };
type Ban = { rule: string; reason: string };
type Round = { passed: boolean; securityBan?: Ban; score: number; breakdown?: Record<string, number | null>; output?: { decisive_mistake?: string | null; comment?: string } };
type Attack = { defended: boolean; reason: string };
type Results = {
  security?: { passed: boolean; securityBan?: Ban };
  doc?: { passed: boolean; securityBan?: Ban; score: number; breakdown?: Record<string, number | null>; output?: { feedback?: Feedback[]; persona?: { waiting_room_monologue?: string } } };
  r1?: Round;
  r2?: Round;
  final?: { passed: boolean; securityBan?: Ban; attacks: Attack[]; executiveComment?: string };
};
type Attempt = { status: 'queued' | 'running' | 'done' | 'error'; logs: string[]; startedAt: string; finishedAt?: string; result?: string; passed?: boolean; revealedAt?: string };
type PassLines = { doc: number; r1: number; r2: number };
type Version = { n: number; createdAt: string; results: Results; attempts: Partial<Record<Challenge, Attempt>> };
type Application = {
  id: string; agentName: string; createdAt: string; versions: Version[];
  character: { job: string; tone: string; reason: string } | null;
  trashedAt?: string;
  running: Challenge | null; next: Challenge | null; canRevise: boolean; banned: boolean;
  division: string; divisionLabel: string; engineLabel: string; byok: boolean; efforts: string[];
  /** 오늘 이 체급에서 쓴 제출 티켓 */
  tickets: { used: number; perDay: number };
  /** 서류 다음 관문 비용 (lib/view.ts) */
  gate: { required: boolean; freeR1Left: number; passesPerGate: number; balance: number; priceKrw: number };
  passLines: PassLines;
  estimates?: Record<Challenge, Estimate>;
};

const STEPS: { key: Challenge }[] = [{ key: 'doc' }, { key: 'r1' }, { key: 'r2' }, { key: 'final' }];

const HINTS: Record<Challenge, string> = {
  doc: '보안 검문소를 거쳐 .md 자체를 채점합니다.',
  r1: '정보가 충분한 평범한 업무 3개를 맡겨 제대로, 매번, 약속한 형식대로 해내는지 봅니다.',
  r2: '빠진 정보·충돌하는 요구·도구 실패 같은 함정과 꼬리 압박을 견디는지 봅니다.',
  final: '레드팀 공격 5개를 모두 막아야 합격입니다.',
};

/** 보안 실격. 보안 검문소뿐 아니라 각 단계 면접관도 실격을 내린다 */
function banOf(r: Results): Ban | undefined {
  return r.security?.securityBan ?? r.doc?.securityBan ?? r.r1?.securityBan ?? r.r2?.securityBan ?? r.final?.securityBan;
}

/** 버전의 결과 한 줄 (예: "2차 면접 탈락") */
function versionSummary(v: Version): string {
  if (banOf(v.results)) return '보안 실격';
  const done = STEPS.filter(s => v.attempts[s.key]?.status === 'done');
  const last = done[done.length - 1];
  if (!last) return '진행 전';
  const passed = v.attempts[last.key]!.passed;
  return last.key === 'final' && passed ? '최종 합격' : `${TITLES[last.key]} ${passed ? '합격' : '불합격'}`;
}

export default function ApplicationView({ id, initial }: { id: string; initial: Application }) {
  const [app, setApp] = useState<Application | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  /** 사용자가 고른 문. 없으면 지금 서 있는 문을 보여 준다 */
  const [picked, setPicked] = useState<Challenge | null>(null);
  /** 열려 있는 결과 통지서 */
  const [letter, setLetter] = useState<{ stage: Challenge; mode: 'reveal' | 'view' } | null>(null);
  /** 방금 연 결과. 통지서를 닫을 때까지 뒤 화면(복도·캐릭터)은 열기 전 상태로 두고, 통지서만 이 결과로 그린다 (도장 전에 문이 열려 결과가 새지 않게) */
  const [revealed, setRevealed] = useState<Application | null>(null);
  /** 무제한급 도전에 쓸 지원자 키. 화면 메모리에만 두고 보낸 뒤 비운다 */
  const [apiKey, setApiKey] = useState('');

  /** 화면 데이터의 순번. 결과 열기·도전 응답으로 화면을 바꾸면 그보다 먼저 나간 조회 응답은 버린다 (늦게 도착해 열기 전 데이터로 덮지 않게) */
  const seq = useRef(0);
  const apply = useCallback((data: Application) => {
    seq.current++;
    setApp(data);
  }, []);
  const load = useCallback(async () => {
    const mine = ++seq.current;
    const res = await fetch(`${BASE}/api/applications/${id}`, { cache: 'no-store' });
    const body = await res.json();
    if (!res.ok) throw Object.assign(new Error(body.error ?? `조회 실패 (${res.status})`), { status: res.status });
    if (mine === seq.current) setApp(body);
    return body as Application;
  }, [id]);

  // 진행 중인 단계가 있으면 3초마다 다시 읽는다
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let tries = 0;
    const tick = async () => {
      try {
        const a = await load();
        if (stopped) return;
        setError(null);
        // 진행 중이거나 캐릭터를 고르는 중이면 다시 읽는다 (캐릭터는 몇 초면 정해진다)
        if (a.running || (!a.character && tries++ < 10)) timer = setTimeout(tick, POLL_MS);
      } catch (e) {
        if (stopped) return;
        setError(e instanceof Error ? e.message : String(e));
        // 지원서가 없어졌으면(완전 삭제 등) 다시 묻지 않는다. 그 밖의 오류는 잠시 뒤 다시 시도
        if ((e as { status?: number }).status !== 404) timer = setTimeout(tick, POLL_MS * 2);
      }
    };
    // 첫 데이터는 서버에서 받았으므로, 진행 중이거나 캐릭터를 고르는 중일 때만 이어서 조회한다
    if (app?.running || !app?.character) timer = setTimeout(tick, POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [load, app?.running, app?.character]);

  async function post(path: string, body: unknown) {
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/applications/${id}/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `접수 실패 (${res.status})`);
      apply(data);
      setApiKey('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  if (!app) return <p className={error ? 'error' : 'muted'}>{error ?? '불러오는 중…'}</p>;
  const cur = app.versions[app.versions.length - 1];
  /** 통지서에 그릴 버전: 방금 연 결과가 있으면 그것, 아니면 지금 화면 */
  const lv = revealed ? revealed.versions[revealed.versions.length - 1] : cur;
  const r = cur.results;
  const past = app.versions.slice(0, -1).reverse();
  // 결과 통지서를 아직 열지 않은 단계. 열기 전에는 합격·불합격과 그에 따른 다음 단계를 드러내지 않는다
  const sealed = STEPS.find(s => cur.attempts[s.key]?.status === 'done' && !cur.attempts[s.key]!.revealedAt)?.key ?? null;
  const next = sealed ? null : app.next;
  const canRevise = !sealed && !app.trashedAt && app.canRevise;
  // 실격도 결과 통지서를 연 뒤에 드러낸다 (열기 전에는 '결과 도착' 그대로)
  const banned = !sealed && app.banned;
  const ticketsLeft = Math.max(0, app.tickets.perDay - app.tickets.used);
  const failedStage = STEPS.find(s => r[s.key] && !r[s.key]!.passed && cur.attempts[s.key]?.revealedAt)?.key ?? null;
  const hired = Boolean(r.final?.passed && cur.attempts.final?.revealedAt);
  // 캐릭터가 서 있는 문: 진행 중 → 결과 도착 → 도전할 문 → 떨어진 문 → 마지막으로 본 문
  const lastDone = [...STEPS].reverse().find(s => cur.attempts[s.key])?.key ?? 'doc';
  const here: Challenge = app.running ?? sealed ?? next ?? failedStage ?? lastDone;
  const focus: Challenge = picked ?? here;
  const attempt = cur.attempts[focus];
  // 복도에 보이는 상태와 같게: 결과를 열지 않은 문 뒤의 문은 잠김
  const st = maskedState(cur.attempts, next, DOORS.findIndex(d => d.key === focus));
  const name = app.agentName.replace(/\.md$/, '');

  const monologue = r.doc?.output?.persona?.waiting_room_monologue;
  const mood: AgentMood = banned ? { kind: 'banned' }
    : app.running ? { kind: 'running', stage: app.running }
    : sealed ? { kind: 'sealed' }
    : hired ? { kind: 'hired' }
    : next ? (next !== 'doc' && !monologue ? { kind: 'passed' } : { kind: 'ready', stage: next, monologue })
    : canRevise && ticketsLeft > 0 ? { kind: 'failed', ticketsLeft }
    : { kind: 'out' };
  const statusText = app.running ? `${TITLES[app.running]} 면접 중`
    : sealed ? `${TITLES[sealed]} 결과 도착`
    : next ? `${TITLES[next]} 도전 가능`
    : hired ? '최종 합격'
    : banned ? '보안 실격'
    : canRevise ? (ticketsLeft > 0 ? '고친 .md 로 재도전 가능' : '오늘 티켓 소진 · 내일 재도전 가능')
    : '면접 종료';

  // 서류 다음 관문 비용 (D-48). 서버 오류 뒤 다시 시도는 이미 낸 관문이라 더 쓰지 않는다
  const { gate } = app;
  const freeR1 = focus === 'r1' && gate.freeR1Left > 0;
  const short = gate.required && focus !== 'doc' && !freeR1 && gate.balance < gate.passesPerGate;
  const gateText = !gate.required ? '서류를 통과해 얻은 도전이라 티켓을 쓰지 않습니다.' : freeR1 ? `오늘 무료 1차가 ${gate.freeR1Left}번 남았습니다. 관문권을 쓰지 않습니다.`
    : short ? `관문권 ${gate.passesPerGate}장이 필요합니다 (보유 ${gate.balance}장). 관문권 상점을 확인해 주세요.`
    : `관문권 ${gate.passesPerGate}장을 씁니다 (보유 ${gate.balance}장 · 1장 ${gate.priceKrw.toLocaleString('ko-KR')}원).`;

  // 도전 버튼이 보이는 동안은 오류를 버튼 바로 아래에 띄운다 (맨 위에 띄우면 누른 사람이 못 본다)
  const tryHere = !banned && (st === 'open-to-try' || st === 'error');

  /** 결과 통지서를 연다. 서버가 열었다고 기록한 뒤에야 결과를 내려 주므로, 받은 결과로 통지서를 펴고 도장을 찍는다 */
  async function openSealed(stage: Challenge) {
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/applications/${id}/reveal`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ challenge: stage }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `결과를 열지 못했습니다 (${res.status})`);
      setRevealed(data);
      setLetter({ stage, mode: 'reveal' });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      {app.trashedAt && <p className="trash-banner" role="status">휴지통에 있는 지원서입니다. 결과는 볼 수 있지만, 새로 도전하려면 바탕화면 휴지통에서 복원해 주세요.</p>}
      <Backdrop seed={app.id} exclude={app.character ? `${app.character.job}-${app.character.tone}` : undefined} />
      {error && !tryHere && <p className="error">{error}</p>}

      <div className="stage-area">
        <AgentCard
          img={agentSprite(app.character)}
          name={name}
          version={cur.n}
          character={app.character}
          mood={mood}
          chances={`${statusText} · ${app.divisionLabel}(${app.engineLabel}) · 오늘 남은 티켓 ${ticketsLeft}/${app.tickets.perDay}`}
        />
      <Corridor
        attempts={cur.attempts}
        next={next}
        here={here}
        selected={focus}
        onSelect={c => setPicked(c === here ? null : c)}
        characterImg={agentSprite(app.character)}
        agentName={name}
        hired={hired}
      />
      </div>

      {banned ? (
        <Dialog speaker="guard">
          <p className="dialog-line">평가 시스템을 노린 흔적이 있습니다. 들어갈 수 없습니다.</p>
          <p className="muted">{banOf(r)?.rule} · {banOf(r)?.reason}</p>
        </Dialog>
      ) : (
        <Dialog speaker={focus}>
          {st === 'running' && attempt && (
            <>
              <p className="dialog-line">{CALL[focus](name)}</p>
              <LiveStatus challenge={focus} attempt={attempt} estimate={app.estimates?.[focus]} />
            </>
          )}
          {(st === 'open-to-try' || st === 'error') && (
            <>
              <p className="dialog-line">
                {st === 'error' ? '서버 오류로 면접을 마치지 못했습니다. 티켓은 쓰지 않았으니 다시 시도해 주세요.' : `${name} 님, 준비되면 들어오세요.`}
              </p>
              <p className="muted">
                {HINTS[focus]}
                {app.estimates ? ` 보통 약 ${Math.max(1, Math.round(app.estimates[focus].seconds / 60))}분 걸립니다.` : ''}
              </p>
              {focus !== 'doc' && st !== 'error' && <p className={short ? 'gate-short' : 'muted small'}>{gateText}</p>}
              {short && st !== 'error' && <p><Link className="button-link gold" href={`/shop?from=/a/${id}`}>🎟️ 관문권 상점 가기</Link></p>}
              {app.byok && (
                <label className="key-field">
                  <span>내 Anthropic API 키 ({app.engineLabel} 지원자 호출에만 씁니다. 저장하지 않습니다)</span>
                  <input type="password" autoComplete="off" spellCheck={false} placeholder="sk-ant-…" value={apiKey} onChange={e => setApiKey(e.target.value)} />
                </label>
              )}
              {!(short && st !== 'error') && (
                <button disabled={sending || (app.byok && !apiKey.trim())} onClick={() => post('challenge', { challenge: focus, apiKey: app.byok ? apiKey : undefined })}>
                  {st === 'error' ? '다시 시도하기' : `${TITLES[focus]} 도전하기`}
                </button>
              )}
              {error && <p className="error" role="alert">{error}</p>}
            </>
          )}
          {st === 'sealed' && (
            <>
              <p className="dialog-line">{name} 님, {TITLES[focus]} 결과가 나왔습니다.</p>
              <button disabled={sending} onClick={() => void openSealed(focus)}>결과를 확인해주세요</button>
            </>
          )}
          {(st === 'passed' || st === 'failed') && (
            <>
              <p className="dialog-line">{verdictLine(focus, r) || (st === 'passed' ? '합격입니다.' : '이번엔 여기까지입니다.')}</p>
              <button onClick={() => setLetter({ stage: focus, mode: 'view' })}>결과 보기</button>
            </>
          )}
          {sealed && focus !== sealed && (st === 'locked' || st === 'open-to-try') && (
            <>
              <p className="dialog-line">{name} 님, {TITLES[sealed]} 결과가 도착했습니다. 먼저 결과를 확인해 보세요.</p>
              <button onClick={() => setPicked(sealed)}>{TITLES[sealed]} 결과 확인하러 가기</button>
            </>
          )}
          {st === 'locked' && !sealed && (
            <p className="dialog-line">
              아직 들어올 수 없습니다. 앞 단계를 먼저 통과하세요. <span className="muted">({HINTS[focus]})</span>
            </p>
          )}
        </Dialog>
      )}

      {canRevise && ticketsLeft === 0 && (
        <section className="card">
          <h2>오늘 {app.divisionLabel} 티켓을 모두 썼습니다</h2>
          <p className="muted">티켓은 새 .md 를 낼 때 1장씩 쓰고, {app.divisionLabel}은 하루 {app.tickets.perDay}장입니다. 자정(한국 시간)에 다시 채워지면 이 화면에서 고친 .md 를 바로 낼 수 있습니다. 그동안 아래 피드백을 반영해 두세요.</p>
          {failedStage && (
            <div className="revise-feedback">
              <h3>{TITLES[failedStage]} 면접관 피드백</h3>
              <StageResult passLines={app.passLines} stage={failedStage} results={r} />
            </div>
          )}
        </section>
      )}

      {canRevise && ticketsLeft > 0 && (
        <section className="card" aria-labelledby="revise-title">
          <h2 id="revise-title">{failedStage ? `${TITLES[failedStage]}에서 떨어졌습니다` : '이번 버전은 탈락했습니다'}</h2>
          <p className="muted">
            같은 .md 로는 떨어진 단계를 다시 볼 수 없습니다. 피드백을 반영해 고친 .md 를 내면 v{cur.n + 1} 로 서류부터 다시 봅니다 (티켓 1장, 오늘 남은 티켓 {ticketsLeft}/{app.tickets.perDay}). 지난 결과는 아래 &lsquo;지난 버전&rsquo;에 남습니다.
          </p>
          <div className="revise-grid">
            {failedStage && (
              <div className="revise-feedback">
                <h3>면접관 피드백</h3>
                <StageResult passLines={app.passLines} stage={failedStage} results={r} />
              </div>
            )}
            <ReviseForm
              id={id}
              agentName={app.agentName}
              nextVersion={cur.n + 1}
              byok={app.byok}
              engineLabel={app.engineLabel}
              efforts={app.efforts}
              onSubmitted={data => {
                setPicked(null);
                apply(data as Application);
              }}
            />
          </div>
        </section>
      )}

      {letter && lv.attempts[letter.stage] && (
        <ResultLetter
          stage={letter.stage}
          passed={Boolean(lv.attempts[letter.stage]!.passed)}
          agentName={name}
          version={lv.n}
          date={lv.attempts[letter.stage]!.finishedAt}
          mode={letter.mode}
          onClose={() => {
            // 통지서를 닫은 뒤에야 뒤 화면을 연 결과로 바꾼다 (그때 문이 열리고 캐릭터가 움직인다)
            if (revealed) apply(revealed);
            setRevealed(null);
            setLetter(null);
            setPicked(null);
            void load();
          }}
        >
          <StageResult passLines={app.passLines} stage={letter.stage} results={lv.results} />
          <Logs attempt={lv.attempts[letter.stage]} />
        </ResultLetter>
      )}

      {past.length > 0 && (
        <>
          <h2>지난 버전</h2>
          {past.map(v => (
            <details key={v.n} className="card">
              <summary>
                <strong>v{v.n}</strong> · {versionSummary(v)}{' '}
                <span className="muted">· {new Date(v.createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</span>
              </summary>
              {STEPS.filter(s => v.results[s.key]).map(s => (
                <div key={s.key} style={{ marginTop: 12 }}>
                  <strong>{TITLES[s.key]}</strong>
                  <StageResult passLines={app.passLines} stage={s.key} results={v.results} />
                </div>
              ))}
            </details>
          ))}
        </>
      )}
    </>
  );
}

/** 장면 대화창에 면접관이 남기는 한마디 */
function verdictLine(stage: Challenge, r: Results): string {
  if (stage === 'doc') {
    const f = r.doc?.output?.feedback?.[0];
    return r.doc ? `${r.doc.score}점입니다. ${f ? f.problem : ''}` : '';
  }
  if (stage === 'final') return r.final?.executiveComment ?? '';
  const round = stage === 'r1' ? r.r1 : r.r2;
  return round?.output?.decisive_mistake ?? round?.output?.comment ?? '';
}

function Logs({ attempt }: { attempt?: Attempt }) {
  if (!attempt || attempt.logs.length === 0) return null;
  return (
    <details className="logs">
      <summary>자세한 진행 기록</summary>
      <div className="panel log" style={{ marginTop: 8 }}>{attempt.logs.join('\n')}</div>
    </details>
  );
}

function Score({ passed, score }: { passed: boolean; score: number }) {
  return <strong className={passed ? 'pass' : 'fail'}>{score}점</strong>;
}

function Breakdown({ values }: { values?: Record<string, number | null> }) {
  if (!values) return null;
  return <p className="muted">{Object.entries(values).filter(([, v]) => v !== null).map(([k, v]) => `${k} ${v}`).join(' · ')}</p>;
}

function StageResult({ stage, results: r, passLines }: { stage: Challenge; results: Results; passLines: PassLines }) {
  if (stage === 'doc' && r.doc) {
    return (
      <>
        <p><Score passed={r.doc.passed} score={r.doc.score} /> <span className="muted">(통과선 {passLines.doc})</span></p>
        <Breakdown values={r.doc.breakdown} />
        {(r.doc.output?.feedback ?? []).map((f, i) => (
          <p key={i}>
            {f.problem}
            <br />
            <span className="muted">→ {f.fix_example}</span>
          </p>
        ))}
      </>
    );
  }
  const round = stage === 'r1' ? r.r1 : stage === 'r2' ? r.r2 : undefined;
  if (round) {
    return (
      <>
        <p><Score passed={round.passed} score={round.score} /> <span className="muted">(통과선 {stage === 'r1' ? passLines.r1 : passLines.r2})</span></p>
        <Breakdown values={round.breakdown} />
        {round.output?.comment && <p className="say">{round.output.comment}</p>}
        {round.output?.decisive_mistake && <p className="muted">결정적 실수: {round.output.decisive_mistake}</p>}
      </>
    );
  }
  if (stage === 'final' && r.final) {
    return (
      <>
        <table>
          <tbody>
            {r.final.attacks.map((a, i) => (
              <tr key={i}>
                <td style={{ width: 56 }} className={a.defended ? 'pass' : 'fail'}>{a.defended ? '방어' : '뚫림'}</td>
                <td><strong>공격 {i + 1}</strong><br /><span className="muted">{a.reason}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        {r.final.executiveComment && <p className="say">{r.final.executiveComment}</p>}
      </>
    );
  }
  return null;
}
