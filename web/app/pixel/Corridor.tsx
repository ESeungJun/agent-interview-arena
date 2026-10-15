'use client';

import { useEffect, useRef, useState } from 'react';

import { CAST, pixel, px, type Challenge } from './cast';

type AttemptLike = { status: string; passed?: boolean; revealedAt?: string } | undefined;

export const DOORS: { key: Challenge; label: string }[] = [
  { key: 'doc', label: '서류' },
  { key: 'r1', label: '1차' },
  { key: 'r2', label: '2차' },
  { key: 'final', label: '최종' },
];
/** 복도 배경(public/pixel/scenes/corridor.png)의 문 자리 가로 중심(%). 그림에서 잰 값이라 배경을 바꾸면 다시 잰다 */
const DOOR_X = [10.1, 35.1, 70.8, 90.5];

export type DoorState = 'passed' | 'failed' | 'sealed' | 'running' | 'open-to-try' | 'error' | 'locked';

export function doorState(attempt: AttemptLike, isNext: boolean): DoorState {
  if (attempt?.status === 'queued' || attempt?.status === 'running') return 'running';
  // 결과 통지서를 열기 전에는 합격·불합격을 드러내지 않는다
  if (attempt?.status === 'done') return !attempt.revealedAt ? 'sealed' : attempt.passed ? 'passed' : 'failed';
  if (attempt?.status === 'error') return 'error';
  return isNext ? 'open-to-try' : 'locked';
}

/** 결과를 열지 않은 문 뒤의 문은 잠김으로 보인다. 다음 단계에 결과가 있다는 것만으로 앞 단계 합격이 드러나기 때문이다 */
export function maskedState(attempts: Partial<Record<Challenge, AttemptLike>>, next: Challenge | null, i: number): DoorState {
  const sealedBefore = DOORS.slice(0, i).some(d => doorState(attempts[d.key], false) === 'sealed');
  return sealedBefore ? 'locked' : doorState(attempts[DOORS[i].key], next === DOORS[i].key);
}

const STATE_LABEL: Record<DoorState, string> = {
  passed: '합격', failed: '불합격', sealed: '결과 도착', running: '면접 중', 'open-to-try': '도전 가능', error: '오류 · 다시 시도', locked: '잠김',
};

/**
 * 가로로 늘어선 면접실 문 네 개. 통과한 문은 열리고, 지원자 캐릭터는 지금 서 있는 문 앞에 선다.
 * 문을 누르면 onSelect 로 그 단계를 고른다.
 */
export default function Corridor({
  attempts, next, here, selected, onSelect, characterImg, agentName, hired,
}: {
  attempts: Partial<Record<Challenge, AttemptLike>>;
  next: Challenge | null;
  /** 캐릭터가 서 있을 문 */
  here: Challenge;
  selected: Challenge | null;
  onSelect?: (c: Challenge) => void;
  characterImg: string;
  agentName: string;
  hired?: boolean;
}) {
  const index = hired ? DOORS.length : DOORS.findIndex(d => d.key === here);
  // 좁은 화면에서는 복도가 가로로 스크롤된다. 지금 서 있는 문이 가운데 오도록 맞춘다
  const scroller = useRef<HTMLDivElement>(null);
  /** 복도가 화면보다 넓어 옆으로 밀어야 다른 문이 보이는지 (안내 문구를 띄운다) */
  const [scrollable, setScrollable] = useState(false);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const check = () => setScrollable(el.scrollWidth > el.clientWidth + 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const el = scroller.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    const x = (hired ? 97 : DOOR_X[Math.max(0, Math.min(index, DOORS.length - 1))]) / 100;
    el.scrollLeft = x * el.scrollWidth - el.clientWidth / 2;
  }, [index, hired]);
  return (
    <>
    {scrollable && <p className="corridor-hint">← 복도를 옆으로 밀면 다른 면접실이 보입니다 →</p>}
    <div className="corridor-scroll" ref={scroller}>
      <div className="corridor" style={{ backgroundImage: `url(${pixel('scenes/corridor')})` }}>
        {DOORS.map((d, i) => {
          const st = maskedState(attempts, next, i);
          return (
            <button
              key={d.key}
              type="button"
              className={`door-col ${st}${selected === d.key ? ' selected' : ''}`}
              aria-pressed={selected === d.key}
              style={{ left: `${DOOR_X[i]}%` }}
              onClick={() => onSelect?.(d.key)}
              aria-label={`${d.label} 면접실 · ${STATE_LABEL[st]}`}
            >
              <span className="door-plate">
                <img {...px(CAST[d.key].sprite)} alt="" />
                {d.label}
              </span>
              <span className={`door-state ${st}`}>{STATE_LABEL[st]}</span>
              <span className="door-frame">
                <img className="door-img" {...px(st === 'passed' ? 'props/door-open' : 'props/door-closed')} alt="" />
                {st === 'failed' && <span className="door-x" aria-hidden />}
                {st === 'sealed' && <span className="envelope" aria-hidden />}
                {st === 'running' && <span className="door-glow" />}
              </span>
            </button>
          );
        })}
        {/* 캐릭터는 지금 서 있는 문 앞 바닥에 선다. 최종 합격이면 마지막 문을 지나 오른쪽 끝으로.
            위치는 transform 으로 옮겨 레이아웃을 다시 계산하지 않는다 (트랙 폭 기준 cqw) */}
        <div className="walker-track">
          <div className={`walker${hired ? ' hired' : ''}`} style={{ ['--x' as string]: hired ? 97 : DOOR_X[Math.max(0, Math.min(index, DOORS.length - 1))] }}>
            <img {...px(characterImg)} alt={agentName} />
          </div>
        </div>
      </div>
    </div>
    </>
  );
}

/** 목록용 작은 진행 표시: 문 네 개만 */
export function MiniDoors({ attempts, next }: { attempts: Partial<Record<Challenge, AttemptLike>>; next: Challenge | null }) {
  return (
    <span className="mini-doors" role="img" aria-label={`진행 상황: ${DOORS.map((d, i) => `${d.label} ${STATE_LABEL[maskedState(attempts, next, i)]}`).join(', ')}`}>
      {DOORS.map((d, i) => {
        const st = maskedState(attempts, next, i);
        return (
          <span key={d.key} className={`mini-door ${st}`} title={`${d.label} · ${STATE_LABEL[st]}`}>
            <span className="mini-frame">
              <img {...px(st === 'passed' ? 'props/door-open' : 'props/door-closed')} alt="" />
              {st === 'failed' && <span className="door-x" aria-hidden />}
            </span>
            <em>{d.label}</em>
          </span>
        );
      })}
    </span>
  );
}
