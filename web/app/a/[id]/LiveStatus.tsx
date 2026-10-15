'use client';

import { useEffect, useState } from 'react';
import type { Challenge } from '../../pixel/cast';

type Attempt = { status: 'queued' | 'running' | 'done' | 'error'; logs: string[]; startedAt: string };
export type Estimate = { seconds: number; samples: number };

const HEADLINE: Record<Challenge, { queued: string; running: string }> = {
  doc: { queued: '서류 접수가 완료되었습니다. 검토 순서를 기다리고 있습니다.', running: '서류 접수가 완료되었습니다. 면접관이 서류를 검토하고 있습니다.' },
  r1: { queued: '1차 면접 접수가 완료되었습니다. 면접 순서를 기다리고 있습니다.', running: '1차 면접(실무)이 진행 중입니다.' },
  r2: { queued: '2차 면접 접수가 완료되었습니다. 면접 순서를 기다리고 있습니다.', running: '2차 면접(압박)이 진행 중입니다.' },
  final: { queued: '최종 면접 접수가 완료되었습니다. 면접 순서를 기다리고 있습니다.', running: '최종 면접(레드팀)이 진행 중입니다.' },
};

/** 진행 기록에서 지금 하고 있는 일을 읽는다 */
function currentStep(challenge: Challenge, logs: string[]): string {
  const has = (s: string) => logs.some(l => l.includes(s));
  switch (challenge) {
    case 'doc':
      if (has('재확인')) return '결과를 정리하고 있습니다';
      if (has('재채점')) return '면접관이 근거를 원문과 다시 맞춰 보며 재검토하고 있습니다';
      if (has('서류전형')) return '면접관이 원칙별 체크리스트로 서류를 검토하고 있습니다';
      return '보안 검문소에서 문서를 확인하고 있습니다';
    case 'r1':
      if (has('과제')) return '에이전트가 과제를 수행하고, 면접관 3명이 각자 채점하고 있습니다';
      return '면접관이 이 에이전트에 맞는 실무 과제를 준비하고 있습니다';
    case 'r2':
      if (has('시나리오')) return '에이전트가 함정 시나리오와 꼬리 압박에 답하고, 면접관 3명이 각자 채점하고 있습니다';
      return '면접관이 압박 시나리오를 준비하고 있습니다';
    case 'final':
      // 화면에 내려 주는 로그는 공격 ID 를 지워 '공격 N개 편성' 으로 바뀐다 (lib/view-logs.ts redactLogs)
      if (has('공격 편성') || has('개 편성')) return '레드팀이 공격 5개를 차례로 시도하고 있습니다';
      return '레드팀이 공격을 편성하고 있습니다';
  }
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m > 0 ? `${m}분 ${s}초` : `${s}초`;
}

function fmtEstimate(sec: number): string {
  return sec < 90 ? `약 ${Math.max(1, Math.round(sec / 60))}분` : `약 ${Math.round(sec / 60)}분`;
}

export default function LiveStatus({ challenge, attempt, estimate }: { challenge: Challenge; attempt: Attempt; estimate?: Estimate }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const elapsed = Math.max(0, (now - Date.parse(attempt.startedAt)) / 1000);
  const queued = attempt.status === 'queued';
  const expected = estimate?.seconds ?? 0;
  // 예상 시간을 넘겨도 끝나기 전까지는 95%에서 멈춘다
  const progress = expected > 0 ? Math.min(95, Math.round((elapsed / expected) * 100)) : 0;
  const slow = expected > 0 && elapsed > expected * 1.5;

  return (
    <div className="progress">
      {/* 상태 문구만 화면 낭독기에 알린다 (1초마다 바뀌는 경과 시간은 알리지 않는다) */}
      <div role="status" aria-live="polite">
        <p className="live-head">{queued ? HEADLINE[challenge].queued : HEADLINE[challenge].running}</p>
        {!queued && <p className="live-step">{currentStep(challenge, attempt.logs)}…</p>}
      </div>
      {expected > 0 && (
        <>
          <div className="bar" role="progressbar" aria-label="예상 진행도" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><div style={{ transform: `scaleX(${progress / 100})` }} /></div>
          <p className="muted">
            예상 소요 시간 {fmtEstimate(expected)}
            {estimate && estimate.samples >= 3 ? ` (최근 ${estimate.samples}건 기준)` : ''} · 경과 {fmt(elapsed)}
          </p>
        </>
      )}
      {slow && <p className="muted">예상보다 오래 걸리고 있습니다. 문서가 길거나 면접관이 근거를 다시 확인하는 중일 수 있습니다.</p>}
      <p className="muted">창을 닫거나 다른 화면으로 가도 면접은 계속 진행됩니다. 결과는 내 지원서에서 확인할 수 있습니다.</p>
    </div>
  );
}
