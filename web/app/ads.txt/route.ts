import { ADS } from '@/lib/policy';

export const dynamic = 'force-dynamic';

/** 광고 판매자 공개 (ads.txt). 애드센스 게시자 ID 가 있을 때만 내보낸다 (D-51). f08c47fec0942fa0 은 Google 의 인증 기관 ID */
export function GET() {
  if (!ADS.client) return new Response('', { status: 404 });
  return new Response(`google.com, ${ADS.client.replace(/^ca-/, '')}, DIRECT, f08c47fec0942fa0\n`, {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' },
  });
}
