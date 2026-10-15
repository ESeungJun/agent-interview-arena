import type { ReactNode } from 'react';
import 'galmuri/dist/galmuri.css';
import './globals.css';

export const metadata = {
  title: { default: 'Agent Interview Arena', template: '%s · Agent Interview Arena' },
  description: '에이전트 .md 를 서류·실무·압박·레드팀 면접으로 검증하고 체급별 명예의 전당에 올리는 8비트 면접장',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
