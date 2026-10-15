'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CAST, px, STAGE_NAME, type Challenge } from './cast';


const STAMP_DELAY_MS = 1800;

/**
 * 면접 결과 통지서. reveal 모드는 내용을 먼저 보여 주고 잠시 뒤 합격·불합격 도장을 찍는다. view 모드는 도장이 이미 찍힌 상태로 연다.
 * 결과를 여는 순간 서버가 열람을 기록한 뒤 결과를 내려 주므로, 도장 전에 닫아도 이미 연 것이다 (다음에는 view 모드로 열린다).
 * 열리면 초점을 통지서 안으로 옮기고 Tab 이 밖으로 나가지 않게 가둔다. Esc 는 언제든 닫는다. 닫으면 초점을 열었던 버튼으로 돌려준다.
 */
export default function ResultLetter({
  stage, passed, agentName, version, date, mode, onClose, children,
}: {
  stage: Challenge; passed: boolean; agentName: string; version: number; date?: string;
  mode: 'reveal' | 'view'; onClose: () => void; children: ReactNode;
}) {
  const [stamped, setStamped] = useState(mode === 'view');
  // 부모가 다시 그려져 콜백이 바뀌어도 초점 처리를 다시 시작하지 않게 최신 콜백만 ref 로 들고 있는다
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (mode === 'view') return;
    const t = setTimeout(() => setStamped(true), STAMP_DELAY_MS);
    return () => clearTimeout(t);
  }, [mode]);

  const box = useRef<HTMLElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    box.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !box.current) return;
      const items = [...box.current.querySelectorAll<HTMLElement>('button:not([disabled]), summary, a[href], [tabindex]:not([tabindex="-1"])')];
      if (items.length === 0) return e.preventDefault();
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === box.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
  }, []);

  const interviewer = CAST[stage];
  return (
    <div className="letter-overlay" role="dialog" aria-modal="true" aria-label={`${STAGE_NAME[stage]} 결과 통지서`}>
      <article ref={box} tabIndex={-1} className={`letter${stamped && mode === 'reveal' ? ' shake' : ''}`}>
        <header className="letter-head">
          <h2>{STAGE_NAME[stage]} 결과 통지서</h2>
          <p className="muted">
            지원자 {agentName}{version > 1 ? ` (v${version})` : ''}
            {date ? ` · ${new Date(date).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}` : ''}
          </p>
        </header>
        <div className={`letter-body${stamped ? '' : ' veiled'}`}>{children}</div>
        <footer className="letter-sign">
          <img {...px(interviewer.sprite)} alt="" />
          <span>{interviewer.name}</span>
        </footer>
        {stamped ? (
          <span className={`big-stamp ${passed ? 'pass' : 'fail'}${mode === 'reveal' ? ' slam' : ''}`}>{passed ? '합격' : '불합격'}</span>
        ) : (
          <p className="letter-wait">심사 결과는…</p>
        )}
        <p className="sr-only" role="status" aria-live="assertive">{stamped ? `${STAGE_NAME[stage]} ${passed ? '합격' : '불합격'}` : '심사 결과를 확인하는 중'}</p>
        <div className="letter-actions">
          <button onClick={onClose}>{stamped ? '닫기' : '도장 건너뛰고 닫기'}</button>
        </div>
      </article>
    </div>
  );
}
