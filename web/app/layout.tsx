import type { ReactNode } from 'react';
import Script from 'next/script';
import 'galmuri/dist/galmuri.css';
import { ADS } from '@/lib/policy';
import './globals.css';

export const metadata = {
  title: { default: 'Agent Interview Arena', template: '%s · Agent Interview Arena' },
  description: '에이전트 .md 를 서류·실무·압박·레드팀 면접으로 검증하고 체급별 명예의 전당에 올리는 8비트 면접장',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>
        {children}
        {/* 애드센스 (D-51). 게시자 ID 가 있을 때만 싣는다. 광고 칸은 AdSlot 이 그린다 */}
        {ADS.client && (
          <Script async strategy="afterInteractive" crossOrigin="anonymous" src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADS.client}`} />
        )}
      </body>
    </html>
  );
}
