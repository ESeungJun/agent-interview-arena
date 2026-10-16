'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import ApplyForm, { type Revisable } from './ApplyForm';
import Hall from './Hall';
import Login from './Login';
import { MiniDoors } from './pixel/Corridor';
import { BASE, pixel, px, type Challenge } from './pixel/cast';
import type { DivisionInfo, LoginMode } from './types';

type WindowKey = 'browser' | 'history' | 'trash' | 'hall';

/** 채용 창과 겹치지 않을 만큼 넓은 화면 (이 폭 이상에서만 이력 창을 처음부터 열어 둔다. 겹치면 지원 영역을 가린다) */
const WIDE = '(min-width: 1640px)';
const subscribeWide = (onChange: () => void) => {
  const query = window.matchMedia(WIDE);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};
const noSubscribe = () => () => {};

type Pos = { x: number; y: number };
/** 창을 끌 때 바탕화면 밖으로 사라지지 않게 남겨 두는 폭·높이 (제목 표시줄을 다시 잡을 수 있게) */
const KEEP_VISIBLE = 80;
const TASKBAR_HEIGHT = 44;

export type HistoryItem = {
  id: string; name: string; version: number; face: string; chances: string;
  status: { text: string; tone: string };
  attempts: Partial<Record<Challenge, { status: string; passed?: boolean; revealedAt?: string }>>;
  next: Challenge | null;
  /** 휴지통으로 옮긴 시각 */
  trashedAt: string | null;
};

/** 홈 = 내 컴퓨터 바탕화면. 채용 포스터 브라우저 창을 열어 둔 채로 시작하고, 지난 지원 이력·명예의 전당·휴지통은 아이콘으로 연다 */
export default function Desktop({ viewer, loginMode, history, revisable, divisions, interviewer }: {
  viewer: { name: string } | null; loginMode: LoginMode;
  history: HistoryItem[]; revisable: Revisable[]; divisions: DivisionInfo[]; interviewer: string;
}) {
  const router = useRouter();
  const [browserOpen, setBrowserOpen] = useState(true);
  const wide = useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE).matches, () => false);
  /** 사용자가 이력 창을 열거나 닫았으면 그 선택, 아니면 화면 폭에 따른 기본값 */
  const [historyChoice, setHistoryChoice] = useState<boolean | null>(null);
  const historyOpen = historyChoice ?? wide;
  const setHistoryOpen = (open: boolean) => setHistoryChoice(open);
  const [trashOpen, setTrashOpen] = useState(false);
  const [hallOpen, setHallOpen] = useState(false);
  const [clock, setClock] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  /** 완전 삭제는 한 번 더 눌러야 지운다 */
  const [confirming, setConfirming] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** 주소창: 가짜 주소 대신 지금 화면의 실제 주소 (서버 렌더에서는 비워 둔다) */
  const address = useSyncExternalStore(noSubscribe, () => window.location.href, () => '');
  const pageRef = useRef<HTMLDivElement>(null);
  const browserRef = useRef<HTMLElement>(null);
  const historyRef = useRef<HTMLElement>(null);
  const trashRef = useRef<HTMLElement>(null);
  const hallRef = useRef<HTMLElement>(null);
  /** 사용자가 연 창. 그려진 뒤 초점을 옮긴다 (처음부터 열려 있는 창은 초점을 빼앗지 않는다) */
  const focusNext = useRef<WindowKey | null>(null);
  /** 사용자가 끌어 옮긴 창의 위치 (없으면 CSS 기본 자리) */
  const [pos, setPos] = useState<Partial<Record<WindowKey, Pos>>>({});
  /** 창 겹침 순서. 마지막이 맨 앞 */
  const [order, setOrder] = useState<WindowKey[]>(['browser', 'history', 'trash', 'hall']);
  const bringToFront = (key: WindowKey) => setOrder(o => (o[o.length - 1] === key ? o : [...o.filter(k => k !== key), key]));

  /** 제목 표시줄을 잡고 끌어 창을 옮긴다. 휴대폰 폭은 창이 화면을 채우는 배치라 끌지 않는다 */
  function startDrag(key: WindowKey, e: React.PointerEvent<HTMLElement>) {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button') || window.matchMedia('(max-width: 760px)').matches) return;
    const win = e.currentTarget.closest('.window') as HTMLElement | null;
    const desk = e.currentTarget.closest('.desktop')?.getBoundingClientRect();
    if (!win || !desk) return;
    e.preventDefault();
    const box = win.getBoundingClientRect();
    const dx = e.clientX - box.left;
    const dy = e.clientY - box.top;
    const move = (ev: PointerEvent) => {
      const x = Math.min(Math.max(ev.clientX - dx - desk.left, KEEP_VISIBLE - box.width), desk.width - KEEP_VISIBLE);
      const y = Math.min(Math.max(ev.clientY - dy - desk.top, 0), desk.height - TASKBAR_HEIGHT - KEEP_VISIBLE / 2);
      setPos(p => ({ ...p, [key]: { x, y } }));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  /** 창 하나에 붙는 위치·겹침 순서·앞으로 가져오기 */
  const frame = (key: WindowKey) => {
    const p = pos[key];
    return {
      style: { zIndex: order.indexOf(key) + 2, ...(p ? { left: p.x, top: p.y, right: 'auto', bottom: 'auto', transform: 'none' } : {}) },
      onPointerDownCapture: () => bringToFront(key),
    };
  };
  const dragHandle = (key: WindowKey) => ({ onPointerDown: (e: React.PointerEvent<HTMLElement>) => startDrag(key, e) });

  const active = history.filter(h => !h.trashedAt);
  const trashed = history.filter(h => h.trashedAt);

  /** 시작 버튼: 채용 창을 열고 지원 영역으로 바로 간다 */
  function goApply() {
    setBrowserOpen(true);
    // 창이 닫혀 있었으면 다시 그려진 뒤에 찾는다
    setTimeout(() => {
      const apply = pageRef.current?.querySelector<HTMLElement>('#apply');
      apply?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      apply?.querySelector<HTMLElement>('.dropzone, button')?.focus({ preventScroll: true });
    }, 0);
  }

  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      setClock(new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }));
      t = setTimeout(tick, 60_000 - (Date.now() % 60_000));
    };
    tick();
    return () => clearTimeout(t);
  }, []);

  const windows = {
    browser: { open: browserOpen, set: setBrowserOpen, ref: browserRef },
    history: { open: historyOpen, set: setHistoryOpen, ref: historyRef },
    trash: { open: trashOpen, set: setTrashOpen, ref: trashRef },
    hall: { open: hallOpen, set: setHallOpen, ref: hallRef },
  };
  /** 창을 열고 초점을 그 창으로 옮긴다. 이미 열려 있으면 초점만 옮긴다 */
  function openWindow(key: WindowKey) {
    bringToFront(key);
    if (windows[key].open) return windows[key].ref.current?.focus();
    focusNext.current = key;
    windows[key].set(true);
  }
  useEffect(() => {
    const key = focusNext.current;
    if (!key) return;
    focusNext.current = null;
    ({ browser: browserRef, history: historyRef, trash: trashRef, hall: hallRef })[key].current?.focus();
  }, [browserOpen, historyOpen, trashOpen, hallOpen]);

  async function act(id: string, method: 'POST' | 'PATCH' | 'DELETE') {
    setBusy(id);
    setNotice(null);
    try {
      const res = await fetch(`${BASE}/api/applications/${id}/trash`, { method });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `처리하지 못했습니다 (${res.status})`);
      setConfirming(null);
      router.refresh();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function logout() {
    await fetch(`${BASE}/api/logout`, { method: 'POST' }).catch(() => undefined);
    router.refresh();
  }

  const icons: { key: WindowKey; label: string; img: string }[] = [
    { key: 'browser', label: '에이전트 채용', img: 'desktop/browser' },
    { key: 'history', label: '지난 지원 이력', img: 'desktop/folder' },
    { key: 'hall', label: '명예의 전당', img: 'interviewers/final' },
    { key: 'trash', label: `휴지통${trashed.length ? ` (${trashed.length})` : ''}`, img: 'desktop/trash' },
  ];

  function row(h: HistoryItem, actions: React.ReactNode) {
    return (
      <li key={h.id} className="history-row">
        <Link href={`/a/${h.id}`} className="history-item">
          <img className="row-face" {...px(h.face)} alt="" />
          <span className="history-text">
            <b>{h.name}</b>{h.version > 1 && <span className="muted"> v{h.version}</span>}
            <span className="muted">{h.chances}</span>
          </span>
          <MiniDoors attempts={h.attempts} next={h.next} />
          <span className={`status-badge ${h.status.tone}`}>{h.status.text}</span>
        </Link>
        <div className="row-actions">{actions}</div>
      </li>
    );
  }

  return (
    <div className="desktop" style={{ backgroundImage: `url(${pixel('desktop/wallpaper')})` }}>
      <nav className="desktop-icons" aria-label="바탕화면">
        {icons.map(i => (
          <button key={i.key} type="button" className="desktop-icon" onClick={() => openWindow(i.key)}>
            <img {...px(i.img)} alt="" />
            <span>{i.label}</span>
          </button>
        ))}
      </nav>

      {browserOpen && (
        <section ref={browserRef} tabIndex={-1} {...frame('browser')} className="window browser" aria-label="채용 공고 브라우저">
          <header className="title-bar" {...dragHandle('browser')}>
            <span className="title"><img {...px('desktop/browser')} alt="" /> 에이전트 공개 채용 - Agent Interview Arena</span>
            <button type="button" className="window-close" aria-label="채용 공고 창 닫기" onClick={() => setBrowserOpen(false)}>×</button>
          </header>
          <div className="browser-bar">
            <span className="tab">에이전트 공개 채용</span>
            <span className="address">{address || ' '}</span>
          </div>
          <div className="window-body page" ref={pageRef}>
            <div className="hiring">
              <article className="poster" style={{ backgroundImage: `url(${pixel('desktop/poster')})` }}>
                <div className="poster-top">
                  <h1>에이전트 공개 채용</h1>
                </div>
              </article>
              <div className="hiring-side">
                <dl className="posting">
                  <dt>미션</dt><dd>서류 · 실무 · 압박 · 레드팀, 네 개의 문을 모두 통과하세요</dd>
                  <dt>모집 분야</dt><dd>직무 무관 · 모든 AI 에이전트</dd>
                  <dt>제출 서류</dt><dd>에이전트 정의서(.md) 1부 · 64KB 이하</dd>
                  <dt>전형 절차</dt><dd>서류전형 → 1차 실무 → 2차 압박 → 최종 레드팀</dd>
                  <dt>체급</dt><dd>{divisions.map(d => `${d.label}(${d.engine})`).join(' · ')} · 면접관 {interviewer}</dd>
                  <dt>티켓</dt><dd>새 .md 를 낼 때 1장 · {divisions.map(d => `${d.label} 하루 ${d.ticketsPerDay}장${d.byok ? '(내 API 키)' : ''}`).join(' · ')}</dd>
                  <dt>재도전</dt><dd>떨어진 단계는 .md 를 고쳐 서류부터 · 통과해서 얻은 도전은 티켓을 쓰지 않아요</dd>
                </dl>
                {viewer ? <ApplyForm revisable={revisable} divisions={divisions} /> : <Login mode={loginMode} />}
              </div>
            </div>
          </div>
        </section>
      )}

      {historyOpen && (
        <section ref={historyRef} tabIndex={-1} {...frame('history')} className="window history-window" aria-label="지난 지원 이력">
          <header className="title-bar" {...dragHandle('history')}>
            <span className="title"><img {...px('desktop/folder')} alt="" /> 지난 지원 이력</span>
            <button type="button" className="window-close" aria-label="지난 지원 이력 창 닫기" onClick={() => setHistoryOpen(false)}>×</button>
          </header>
          <div className="window-body">
            {notice && historyOpen && !trashOpen && <p className="error" role="alert">{notice}</p>}
            {!viewer ? (
              <p className="muted">로그인하면 내 지원 이력이 보입니다.</p>
            ) : active.length === 0 ? (
              <p className="muted">아직 지원한 에이전트가 없습니다.</p>
            ) : (
              <ul className="file-list">
                {active.map(h => row(h, (
                  <button type="button" className="row-button quiet" disabled={busy === h.id} onClick={() => void act(h.id, 'POST')} aria-label={`${h.name} 휴지통으로 옮기기`}>
                    휴지통으로
                  </button>
                )))}
              </ul>
            )}
          </div>
        </section>
      )}

      {trashOpen && (
        <section ref={trashRef} tabIndex={-1} {...frame('trash')} className="window trash-window" aria-label="휴지통">
          <header className="title-bar" {...dragHandle('trash')}>
            <span className="title"><img {...px('desktop/trash')} alt="" /> 휴지통</span>
            <button type="button" className="window-close" aria-label="휴지통 창 닫기" onClick={() => { setTrashOpen(false); setConfirming(null); }}>×</button>
          </header>
          <div className="window-body">
            {notice && trashOpen && <p className="error" role="alert">{notice}</p>}
            {trashed.length === 0 ? (
              <p className="muted">휴지통이 비어 있습니다.</p>
            ) : (
              <ul className="file-list">
                {trashed.map(h => row(h, (
                  <>
                    <button type="button" className="row-button" disabled={busy === h.id} onClick={() => void act(h.id, 'PATCH')}>복원</button>
                    {confirming === h.id ? (
                      <button type="button" className="row-button danger" disabled={busy === h.id} onClick={() => void act(h.id, 'DELETE')}>정말 삭제</button>
                    ) : (
                      <button type="button" className="row-button" onClick={() => setConfirming(h.id)}>완전 삭제</button>
                    )}
                  </>
                )))}
              </ul>
            )}
            <p className="muted small">완전히 삭제하면 지원서와 면접 결과를 되돌릴 수 없습니다.</p>
          </div>
        </section>
      )}

      {hallOpen && (
        <section ref={hallRef} tabIndex={-1} {...frame('hall')} className="window hall-window" aria-label="명예의 전당">
          <header className="title-bar" {...dragHandle('hall')}>
            <span className="title"><img {...px('interviewers/final')} alt="" /> 명예의 전당</span>
            <button type="button" className="window-close" aria-label="명예의 전당 창 닫기" onClick={() => setHallOpen(false)}>×</button>
          </header>
          <div className="window-body">
            <Hall divisions={divisions} />
          </div>
        </section>
      )}

      <footer className="taskbar">
        <button type="button" className="start" onClick={goApply} aria-label="시작: 에이전트 지원하기">시작</button>
        <button type="button" className={`task${browserOpen ? ' on' : ''}`} aria-pressed={browserOpen} aria-label="에이전트 공개 채용 창" onClick={() => (browserOpen ? setBrowserOpen(false) : openWindow('browser'))}>
          <img {...px('desktop/browser')} alt="" /> <span className="label">에이전트 공개 채용</span>
        </button>
        <button type="button" className={`task${historyOpen ? ' on' : ''}`} aria-pressed={historyOpen} aria-label="지난 지원 이력 창" onClick={() => (historyOpen ? setHistoryOpen(false) : openWindow('history'))}>
          <img {...px('desktop/folder')} alt="" /> <span className="label">지난 지원 이력</span>
        </button>
        {trashOpen && (
          <button type="button" className="task on" aria-pressed aria-label="휴지통 창" onClick={() => setTrashOpen(false)}>
            <img {...px('desktop/trash')} alt="" /> <span className="label">휴지통</span>
          </button>
        )}
        {hallOpen && (
          <button type="button" className="task on" aria-pressed aria-label="명예의 전당 창" onClick={() => setHallOpen(false)}>
            <img {...px('interviewers/final')} alt="" /> <span className="label">명예의 전당</span>
          </button>
        )}
        {viewer ? (
          <span className="who">
            <span className="label">{viewer.name}</span>
            <button type="button" className="task" onClick={() => void logout()}>로그아웃</button>
          </span>
        ) : (
          <button type="button" className="task who" onClick={goApply}>로그인</button>
        )}
        <span className="clock" aria-label="현재 시각">{clock}</span>
      </footer>
    </div>
  );
}
