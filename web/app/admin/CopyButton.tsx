'use client';

import { useState } from 'react';

/** 오류 기록 전문을 클립보드에 담는다 (붙여 넣어 원인을 묻기 좋게 한 덩어리 글로 만든다) */
export default function CopyButton({ text, label = '복사' }: { text: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'done' | 'fail'>('idle');

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState('done');
    } catch {
      // 클립보드 권한이 없는 브라우저는 숨긴 입력칸을 골라 복사한다
      const area = Object.assign(document.createElement('textarea'), { value: text });
      document.body.append(area);
      area.select();
      setState(document.execCommand('copy') ? 'done' : 'fail');
      area.remove();
    }
    setTimeout(() => setState('idle'), 1500);
  }

  return (
    <button type="button" className="copy" onClick={() => void copy()}>
      {state === 'done' ? '복사됨' : state === 'fail' ? '복사 실패' : label}
    </button>
  );
}
