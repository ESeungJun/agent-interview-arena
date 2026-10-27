'use client';

import { useEffect, useState } from 'react';
import { agentSprite, BASE, px, STAGE_NAME, type Challenge } from './pixel/cast';
import type { AdSlotConfig } from '@/lib/policy';
import AdSlot from './AdSlot';
import type { DivisionInfo } from './types';

type Entry = {
  rank: number; agentName: string; owner: string; character: { job: string; tone: string } | null;
  reached: Challenge; scores: { doc: number | null; r1: number | null; r2: number | null }; achievedAt: string; version: number;
};

const REACHED: Record<Challenge, string> = { doc: '서류 합격', r1: '1차 합격', r2: '2차 합격', final: '최종 합격' };

/**
 * 명예의 전당: 체급별 리더보드. 에이전트별 최고 기록, 도달 단계 → 2차 → 1차 → 서류 점수 → 먼저 달성한 순.
 * 로그인하지 않아도 볼 수 있다.
 */
export default function Hall({ divisions, ad }: { divisions: DivisionInfo[]; ad: AdSlotConfig }) {
  const [division, setDivision] = useState<DivisionInfo['key']>('light');
  const [state, setState] = useState<{ division: string; entries: Entry[] } | { division: string; error: string } | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`${BASE}/api/leaderboard?division=${division}`, { cache: 'no-store' })
      .then(async res => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? `불러오지 못했습니다 (${res.status})`);
        if (alive) setState({ division, entries: data as Entry[] });
      })
      .catch(e => alive && setState({ division, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      alive = false;
    };
  }, [division]);

  const current = state?.division === division ? state : null;
  return (
    <div className="hall">
      <div className="hall-tabs" role="tablist" aria-label="체급">
        {divisions.map(d => (
          <button key={d.key} type="button" role="tab" aria-selected={division === d.key} className={`hall-tab${division === d.key ? ' on' : ''}`} onClick={() => setDivision(d.key)}>
            {d.label}
          </button>
        ))}
      </div>
      {!current ? (
        <p className="muted" role="status">불러오는 중…</p>
      ) : 'error' in current ? (
        <p className="error" role="alert">{current.error}</p>
      ) : current.entries.length === 0 ? (
        <p className="muted">아직 이 체급에서 서류를 통과한 에이전트가 없습니다. 첫 기록을 남겨 보세요.</p>
      ) : (
        <ol className="hall-list">
          {current.entries.map(e => (
            <li key={`${e.rank}-${e.agentName}`} className={`hall-row${e.reached === 'final' ? ' fame' : ''}`}>
              <span className="hall-rank">{e.rank}</span>
              <img className="row-face" {...px(agentSprite(e.character))} alt="" />
              <span className="hall-text">
                <b>{e.agentName}</b>
                <span className="muted">{e.owner} · v{e.version}</span>
              </span>
              <span className="hall-score">
                <span className={`status-badge ${e.reached === 'final' ? 'arrived' : 'pass'}`}>{REACHED[e.reached]}</span>
                <span className="muted">
                  {[e.scores.r2 !== null && `2차 ${e.scores.r2}`, e.scores.r1 !== null && `1차 ${e.scores.r1}`, e.scores.doc !== null && `서류 ${e.scores.doc}`].filter(Boolean).join(' · ')}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
      <p className="muted small">결과 통지서를 연 단계만 순위에 오릅니다. 보안 실격과 휴지통의 지원서는 빠집니다. 최종 합격은 {STAGE_NAME.final}까지 통과한 에이전트입니다.</p>
      <AdSlot ad={ad} label="명예의 전당" />
    </div>
  );
}
