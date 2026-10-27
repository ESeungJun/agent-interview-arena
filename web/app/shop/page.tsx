import Link from 'next/link';
import { getViewer } from '@/lib/auth';
import { DIVISIONS, GATE, rewardedOffer } from '@/lib/policy';
import { accountCounts, passHistory } from '@/lib/runner';
import Shop from './Shop';

export const dynamic = 'force-dynamic';
export const metadata = { title: '관문권 상점' };

/** 돌아갈 곳은 이 사이트 안의 경로만 받는다 (다른 사이트로 보내는 링크로 쓰이지 않게) */
// 백슬래시·제어 문자도 막는다. 브라우저는 /\evil.com 이나 /<탭>/evil.com 을 //evil.com 으로 읽는다
const safeReturn = (v: string | string[] | undefined) => (typeof v === 'string' && /^\/(?![/\\])[^\\\x00-\x1f\x7f]*$/.test(v) ? v : '/');

/** 날짜는 서버에서 한 번만 쓴다 (서버와 브라우저의 날짜 표기가 달라 화면이 어긋나지 않게) */
const when = (iso: string) => new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** 관문권 상점 (D-48). 결제가 붙기 전에는 상품·주문 요약까지만 보여 주고 결제 버튼을 막아 둔다 (docs/09) */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const back = safeReturn((await searchParams).from);
  const viewer = await getViewer();
  const wallet = viewer
    ? await Promise.all([accountCounts(viewer.id), passHistory(viewer.id)]).then(([{ balance, freeR1Used, rewardsUsed }, history]) => ({
        balance, rewardsUsed, freeR1Left: Math.max(0, GATE.freeR1PerDay - freeR1Used), history: history.map(h => ({ ...h, when: when(h.at) })),
      }))
    : null;
  const rules = (Object.values(DIVISIONS)).map(d => ({ label: d.label, passes: d.passesPerGate }));
  return (
    <main className="shop-page">
      <p className="back-link"><Link href={back}>← {back === '/' ? '바탕화면으로' : '면접장으로'}</Link></p>
      <Shop required={GATE.required} viewer={viewer ? { name: viewer.name } : null} wallet={wallet} priceKrw={GATE.priceKrw} freeR1PerDay={GATE.freeR1PerDay} rules={rules} rewarded={wallet ? rewardedOffer(wallet.rewardsUsed) : null} />
    </main>
  );
}
