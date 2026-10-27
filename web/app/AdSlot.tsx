'use client';

import { useEffect, useRef } from 'react';
import type { AdSlotConfig } from '@/lib/policy';

declare global {
  interface Window { adsbygoogle?: unknown[] }
}

/**
 * 애드센스 광고 한 칸 (D-51). 위에 "광고" 표시를 붙여 화면 내용과 헷갈리지 않게 한다.
 * 설정이 없으면 아무것도 그리지 않고, 점검용 설정(preview)이면 점선 상자만 그린다.
 */
export default function AdSlot({ ad, label }: { ad: AdSlotConfig; label: string }) {
  const ref = useRef<HTMLModElement>(null);
  useEffect(() => {
    const el = ref.current;
    // 개발 모드는 효과를 두 번 돌린다. 이미 채운 칸에 다시 요청하면 애드센스가 오류를 낸다
    if (!el || el.dataset.adsbygoogleStatus) return;
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {
      // 광고 차단기 등으로 못 불러와도 화면은 그대로 둔다
    }
  }, []);
  if (!ad) return null;
  return (
    <aside className="ad-slot" aria-label="광고">
      <span className="ad-label">광고</span>
      {'preview' in ad ? (
        <div className="ad-preview">광고 자리 · {label}</div>
      ) : (
        <ins ref={ref} className="adsbygoogle" style={{ display: 'block' }} data-ad-client={ad.client} data-ad-slot={ad.slot} data-ad-format="auto" data-full-width-responsive="true" />
      )}
    </aside>
  );
}
