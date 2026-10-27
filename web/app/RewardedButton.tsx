'use client';

import { useState } from 'react';
import { BASE } from './pixel/cast';

/** 쓰는 부분만 적은 Google Publisher Tag 타입 */
type Slot = { addService(s: PubAds): Slot };
type PubAds = {
  addEventListener(name: string, fn: (e: { slot: Slot; isEmpty?: boolean; makeRewardedVisible?: () => void }) => void): void;
  removeEventListener(name: string, fn: (e: never) => void): void;
};
type Googletag = {
  cmd: (() => void)[];
  enums: { OutOfPageFormat: { REWARDED: unknown } };
  defineOutOfPageSlot(unit: string, format: unknown): Slot | null;
  pubads(): PubAds;
  enableServices(): void;
  display(slot: Slot): void;
  destroySlots(slots: Slot[]): void;
};
declare global {
  interface Window { googletag?: Googletag }
}

const GPT_SRC = 'https://securepubads.g.doubleclick.net/tag/js/gpt.js';

/** gpt.js 는 이 버튼을 처음 누를 때만 불러온다 (모든 화면에 광고 스크립트를 싣지 않게) */
function loadGpt(): Googletag {
  window.googletag = window.googletag || ({ cmd: [] } as unknown as Googletag);
  if (!document.querySelector(`script[src="${GPT_SRC}"]`)) {
    const s = document.createElement('script');
    s.src = GPT_SRC;
    s.async = true;
    s.crossOrigin = 'anonymous';
    document.head.appendChild(s);
  }
  return window.googletag;
}

type Phase = 'idle' | 'loading' | 'watching' | 'claiming';

/**
 * "광고 보고 관문권 받기" (D-51). 누르면 보상형 광고를 띄우고, 끝까지 보면(보상 지급 신호) 서버에 관문권을 받는다.
 * 보상형 광고는 휴대폰 화면처럼 확대 없이 맞춘 페이지에서만 나온다. 못 띄우면 이유를 알리고 상점으로 안내한다.
 */
export default function RewardedButton({ unit, left, onGranted }: { unit: string; left: number; onGranted: (balance: number, left: number) => void }) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [note, setNote] = useState<string | null>(null);

  const claim = async () => {
    setPhase('claiming');
    try {
      const res = await fetch(`${BASE}/api/rewards`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `받지 못했습니다 (${res.status})`);
      setNote('관문권 1장을 받았습니다.');
      onGranted(body.balance, body.left);
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setPhase('idle');
    }
  };

  const watch = () => {
    setNote(null);
    setPhase('loading');
    const gt = loadGpt();
    gt.cmd.push(() => {
      const slot = gt.defineOutOfPageSlot(unit, gt.enums.OutOfPageFormat.REWARDED);
      if (!slot) {
        setPhase('idle');
        setNote('이 화면에서는 보상형 광고를 볼 수 없습니다. 휴대폰에서 다시 시도하거나 관문권 상점을 이용해 주세요.');
        return;
      }
      const pubads = gt.pubads();
      let granted = false;
      const done = () => {
        pubads.removeEventListener('rewardedSlotReady', ready);
        pubads.removeEventListener('rewardedSlotGranted', grant);
        pubads.removeEventListener('rewardedSlotClosed', closed);
        pubads.removeEventListener('slotRenderEnded', empty);
        gt.destroySlots([slot]);
      };
      // 사용자가 이미 "광고 보기"를 눌렀으니 준비되는 대로 바로 띄운다
      const ready = (e: { slot: Slot; makeRewardedVisible?: () => void }) => {
        if (e.slot !== slot) return;
        setPhase('watching');
        e.makeRewardedVisible?.();
      };
      const grant = (e: { slot: Slot }) => {
        if (e.slot === slot) granted = true;
      };
      const closed = (e: { slot: Slot }) => {
        if (e.slot !== slot) return;
        done();
        if (granted) void claim();
        else {
          setPhase('idle');
          setNote('광고를 끝까지 보지 않아 관문권을 받지 못했습니다.');
        }
      };
      const empty = (e: { slot: Slot; isEmpty?: boolean }) => {
        if (e.slot !== slot || !e.isEmpty) return;
        done();
        setPhase('idle');
        setNote('지금은 보여 줄 광고가 없습니다. 잠시 뒤 다시 시도해 주세요.');
      };
      pubads.addEventListener('rewardedSlotReady', ready);
      pubads.addEventListener('rewardedSlotGranted', grant);
      pubads.addEventListener('rewardedSlotClosed', closed);
      pubads.addEventListener('slotRenderEnded', empty);
      slot.addService(pubads);
      gt.enableServices();
      gt.display(slot);
    });
  };

  return (
    <div className="rewarded">
      <button type="button" className="secondary" disabled={left <= 0 || phase !== 'idle'} onClick={watch}>
        {phase === 'loading' ? '광고 불러오는 중…' : phase === 'watching' ? '광고 보는 중…' : phase === 'claiming' ? '관문권 받는 중…'
          : left > 0 ? `📺 광고 보고 관문권 1장 받기 (오늘 ${left}번 남음)` : '오늘 광고로 받을 수 있는 관문권을 다 받았습니다'}
      </button>
      {note && <p className="muted small" role="status">{note}</p>}
    </div>
  );
}
