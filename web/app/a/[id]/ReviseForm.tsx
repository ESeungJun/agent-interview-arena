'use client';

import { useRef, useState } from 'react';
import EntryOptions from '../../EntryOptions';
import { BASE, MAX_MD_BYTES } from '../../pixel/cast';

/**
 * 떨어진 지원서 화면에서 바로 고친 .md 를 내는 영역. 파일 이름과 상관없이 이 지원서의 다음 버전으로 이어지고, 제출하면 서류전형이 바로 시작된다 (티켓 1장).
 */
export default function ReviseForm({ id, agentName, nextVersion, byok, engineLabel, efforts, onSubmitted }: {
  id: string; agentName: string; nextVersion: number; byok: boolean; engineLabel: string; efforts: string[];
  /** 서버가 돌려준 새 지원서 화면 데이터 */
  onSubmitted: (data: unknown) => void;
}) {
  const [effort, setEffort] = useState('');
  const [apiKey, setApiKey] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [md, setMd] = useState('');
  const [fileName, setFileName] = useState('');
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function take(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (file.size > MAX_MD_BYTES) {
      setMd('');
      setFileName('');
      setError(`${file.name} 은(는) ${Math.ceil(file.size / 1024)}KB 입니다. .md 는 ${MAX_MD_BYTES / 1024}KB 이하만 받습니다.`);
      return;
    }
    setMd(await file.text());
    setFileName(file.name);
  }

  async function submit() {
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/applications/${id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ md, effort: effort || undefined, apiKey: byok ? apiKey : undefined }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `접수하지 못했습니다 (${res.status})`);
      setApiKey('');
      onSubmitted(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  const open = () => fileRef.current?.click();
  return (
    <div className="revise-form">
      <input ref={fileRef} type="file" accept=".md,text/markdown,text/plain" hidden onChange={e => void take(e.target.files?.[0])} />
      <div
        className={`dropzone${dragging ? ' over' : ''}${md ? ' ready' : ''}`}
        role="button"
        tabIndex={0}
        aria-label={md ? `${fileName} 첨부됨. 눌러서 다른 파일 고르기` : '고친 .md 첨부하기'}
        onClick={open}
        onKeyDown={e => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          open();
        }}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); void take(e.dataTransfer.files?.[0]); }}
      >
        {md ? (
          <p>
            {fileName} · {Math.ceil(new Blob([md]).size / 1024)}KB
            <span className="apply-hint">다른 파일로 바꾸려면 다시 누르세요</span>
          </p>
        ) : (
          <p>
            고친 <b>.md</b> 를 눌러서 첨부하거나 끌어다 놓으세요
            <span className="apply-hint">파일 이름이 달라도 {agentName.replace(/\.md$/, '')} v{nextVersion} 로 이어집니다</span>
          </p>
        )}
      </div>
      <EntryOptions efforts={efforts} byok={byok} engineLabel={engineLabel} effort={effort} onEffort={setEffort} apiKey={apiKey} onApiKey={setApiKey} />
      <div className="apply-actions">
        <span className="muted small-inline">제출하면 바로 서류전형부터 다시 봅니다</span>
        <button disabled={sending || !md || (byok && !apiKey.trim())} onClick={submit}>{sending ? '접수 중…' : `v${nextVersion} 제출`}</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
