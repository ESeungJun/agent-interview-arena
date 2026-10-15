'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import EntryOptions from './EntryOptions';
import { BASE, JOB_LABEL, MAX_MD_BYTES, px, TONE_LABEL } from './pixel/cast';
import type { DivisionInfo } from './types';

/** 붙여넣기는 입력이 멈춘 뒤 이만큼 기다렸다가 캐릭터를 판단한다 */
const PASTE_IDLE_MS = 1200;

type Character = { job: string; tone: string; reason: string };
/** 같은 파일 이름·체급으로 내면 다음 버전으로 이어지는 떨어진 지원서 */
export type Revisable = { agentName: string; division: DivisionInfo['key']; version: number; outToday: boolean; /** 결과 통지서를 아직 열지 않았다 */ sealed: boolean };

/** 서버(lib/runner.ts cleanName)와 같은 규칙으로 파일 이름을 정리한다 */
const cleanName = (name: string) => name.replace(/[^\w.\-가-힣 ]/g, '').slice(0, 80) || 'agent.md';
/** 브라우저가 붙이는 "(1)" 같은 번호와 대소문자를 뗀 이름. 이름이 조금 다른 같은 에이전트를 알아보는 데만 쓴다 */
const looseName = (name: string) => name.replace(/\.md$/i, '').replace(/\s*\d+$/, '').trim().toLowerCase();

/** 이 이름으로 내면 어떻게 접수되는지 */
function routeOf(fileName: string, all: Revisable[], division: DivisionInfo['key']): { kind: 'continue' | 'blocked' | 'sealed' | 'similar' | 'new'; target?: Revisable } {
  const name = cleanName(fileName);
  const revisable = all.filter(r => r.division === division);
  const exact = revisable.find(r => r.agentName === name);
  if (exact) return { kind: exact.sealed ? 'sealed' : exact.outToday ? 'blocked' : 'continue', target: exact };
  const similar = revisable.find(r => !r.sealed && looseName(r.agentName) === looseName(name));
  return similar ? { kind: 'similar', target: similar } : { kind: 'new' };
}
type Preview = { state: 'idle' } | { state: 'judging' } | { state: 'done'; character: Character } | { state: 'error'; message: string };

/**
 * 채용 페이지의 지원 영역.
 * .md 를 첨부하는 순간 성격·직무를 판단해 캐릭터를 먼저 보여 주고, 마음에 들지 않으면 다시 첨부한다. 제출하면 그 캐릭터를 이어 쓴다.
 */
export default function ApplyForm({ revisable, divisions }: { revisable: Revisable[]; divisions: DivisionInfo[] }) {
  const router = useRouter();
  /** 처음에는 티켓이 남은 첫 체급을 고른다 */
  const [division, setDivision] = useState<DivisionInfo['key']>(
    () => divisions.find(d => d.open && d.used < d.ticketsPerDay)?.key ?? 'light',
  );
  const [effort, setEffort] = useState('');
  const [apiKey, setApiKey] = useState('');
  const chosen = divisions.find(d => d.key === division)!;
  const ticketsLeft = Math.max(0, chosen.ticketsPerDay - chosen.used);
  const fileRef = useRef<HTMLInputElement>(null);
  const [md, setMd] = useState('');
  const [fileName, setFileName] = useState('');
  const [pasting, setPasting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<Preview>({ state: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  /** 늦게 도착한 이전 판단 결과가 새 첨부를 덮어쓰지 않게 요청 번호를 센다 */
  const ticket = useRef(0);

  async function judge(text: string) {
    const my = ++ticket.current;
    setPreview({ state: 'judging' });
    try {
      const res = await fetch(`${BASE}/api/character`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ md: text }),
      });
      const data = await res.json();
      if (my !== ticket.current) return;
      if (!res.ok) throw new Error(data.error ?? `판단 실패 (${res.status})`);
      setPreview({ state: 'done', character: data });
    } catch (e) {
      if (my === ticket.current) setPreview({ state: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }

  async function take(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_MD_BYTES) {
      setError(`${file.name} 은(는) ${Math.ceil(file.size / 1024)}KB 입니다. .md 는 ${MAX_MD_BYTES / 1024}KB 이하만 받습니다.`);
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    const text = await file.text();
    setMd(text);
    setFileName(file.name);
    setError(null);
    void judge(text);
  }

  // 붙여넣기: 입력이 멈추면 판단한다
  useEffect(() => {
    if (!pasting || md.trim().length < 40) return;
    const t = setTimeout(() => void judge(md), PASTE_IDLE_MS);
    return () => clearTimeout(t);
  }, [md, pasting]);

  function reattach() {
    ticket.current++;
    setMd('');
    setFileName('');
    setPreview({ state: 'idle' });
    setError(null);
    if (fileRef.current) fileRef.current.value = '';
    fileRef.current?.click();
  }

  async function submit() {
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/applications`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          md,
          agentName: fileName || 'agent.md',
          character: preview.state === 'done' ? preview.character : undefined,
          division,
          effort: effort || undefined,
          apiKey: chosen.byok ? apiKey : undefined,
        }),
      });
      const data = (await res.json()) as { id?: string; error?: string };
      if (!res.ok || !data.id) throw new Error(data.error ?? `접수 실패 (${res.status})`);
      router.push(`/a/${data.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSending(false);
    }
  }

  const attached = Boolean(md.trim());
  const route = routeOf(fileName || 'agent.md', revisable, division);
  const base = (n: string) => n.replace(/\.md$/, '');
  const routeText = route.kind === 'continue' ? `${base(route.target!.agentName)} v${route.target!.version + 1} 로 이어집니다. 제출하면 바로 서류전형부터 다시 봅니다.`
    : route.kind === 'blocked' ? `${base(route.target!.agentName)} 은(는) 오늘 기회를 모두 썼습니다. 자정(한국 시간)이 지나면 다시 낼 수 있습니다.`
    : route.kind === 'sealed' ? `${base(route.target!.agentName)} 의 결과가 도착해 있습니다. 지난 지원 이력에서 결과를 먼저 확인해 주세요.`
    : route.kind === 'similar' ? `새 지원서로 접수됩니다. ${route.target!.agentName} 를 고친 것이라면 파일 이름을 똑같이 하거나 그 지원서 화면에서 내면 v${route.target!.version + 1} 로 이어집니다.`
    : '새 지원서로 접수됩니다. 제출하면 바로 서류전형이 시작됩니다.';
  // 같은 .md 를 같은 분기에 다시 내면 서버가 이전 지원서를 돌려주고 티켓을 쓰지 않는다. 그 밖에는 1장
  const noTicket = route.kind !== 'sealed' && ticketsLeft === 0;
  return (
    <section className="apply" id="apply">
      <h2>온라인 지원</h2>
      <fieldset className="divisions">
        <legend>체급</legend>
        {divisions.map(d => {
          const left = Math.max(0, d.ticketsPerDay - d.used);
          return (
            <label key={d.key} className={`division${division === d.key ? ' on' : ''}${d.open ? '' : ' closed'}`}>
              <input type="radio" name="division" value={d.key} checked={division === d.key} disabled={!d.open} onChange={() => { setDivision(d.key); setEffort(''); }} />
              <b>{d.label}</b>
              <span>{d.engine}{d.byok ? ' · 내 API 키' : ''}</span>
              <span className="muted">{d.open ? `오늘 티켓 ${left}/${d.ticketsPerDay}` : d.closedReason}</span>
            </label>
          );
        })}
      </fieldset>
      <input ref={fileRef} type="file" accept=".md,text/markdown,text/plain" hidden onChange={e => void take(e.target.files?.[0])} />

      {(!attached || pasting) && (
        <div
          className={`dropzone${dragging ? ' over' : ''}`}
          onClick={() => fileRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); void take(e.dataTransfer.files?.[0]); }}
          role="button"
          tabIndex={0}
          onKeyDown={e => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            fileRef.current?.click();
          }}
        >
          <p>
            여기에 에이전트 정의서 <b>.md</b> 를 끌어다 놓거나 눌러서 첨부하세요
            <span className="apply-hint">첨부하면 바로 성격과 하는 일을 살펴 캐릭터를 붙여 드립니다. 떨어진 지원서는 그 지원서 화면에서 바로 고친 .md 를 낼 수 있습니다</span>
          </p>
        </div>
      )}

      {pasting && (
        <>
          <input className="apply-input" placeholder="에이전트 이름 (예: code-reviewer.md)" value={fileName} onChange={e => setFileName(e.target.value)} aria-label="에이전트 이름" />
          <textarea className="apply-input" placeholder=".md 내용을 붙여 넣으세요" value={md} onChange={e => setMd(e.target.value)} aria-label=".md 내용" />
        </>
      )}

      {attached && (
        <div className="preview-card" role="status" aria-live="polite">
          {preview.state === 'judging' && <p className="preview-wait">에이전트를 살펴보는 중…</p>}
          {preview.state === 'error' && <p className="error">캐릭터를 정하지 못했습니다: {preview.message}. 그대로 지원하면 면접장에서 다시 정합니다.</p>}
          {preview.state === 'done' && (
            <div className="preview-body">
              <img className="preview-face" {...px(`agents/${preview.character.job}-${preview.character.tone}`)} alt="" />
              <div>
                <p className="preview-name">{(fileName || '붙여 넣은 .md').replace(/\.md$/, '')}</p>
                <p className="preview-type">{JOB_LABEL[preview.character.job] ?? preview.character.job} · {TONE_LABEL[preview.character.tone] ?? preview.character.tone} 캐릭터</p>
                <p className="muted">{preview.character.reason}</p>
              </div>
            </div>
          )}
          {!pasting && <p className="preview-file">{fileName} · {Math.ceil(new Blob([md]).size / 1024)}KB</p>}
          <p className={`preview-route ${noTicket ? 'blocked' : route.kind}`}>
            {noTicket ? `오늘 ${chosen.label} 티켓 ${chosen.ticketsPerDay}장을 모두 썼습니다. 자정(한국 시간)에 다시 채워집니다.` : routeText}
          </p>
        </div>
      )}

      <EntryOptions efforts={chosen.efforts} byok={chosen.byok} engineLabel={chosen.engine} effort={effort} onEffort={setEffort} apiKey={apiKey} onApiKey={setApiKey} />

      <div className="apply-actions">
        {attached && !pasting
          ? <button type="button" className="secondary" onClick={reattach}>다시 첨부하기</button>
          : pasting ? (
            <button type="button" className="link-button" onClick={() => { setPasting(false); ticket.current++; setMd(''); setFileName(''); setPreview({ state: 'idle' }); }}>
              붙여넣기 대신 파일로 첨부하기
            </button>
          ) : <button type="button" className="link-button" onClick={() => setPasting(true)}>파일 대신 내용을 직접 붙여 넣기</button>}
        <button disabled={sending || !attached || preview.state === 'judging' || route.kind === 'blocked' || route.kind === 'sealed' || noTicket || (chosen.byok && !apiKey.trim())} onClick={submit}>{sending ? '접수 중…' : '지원서 제출'}</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
