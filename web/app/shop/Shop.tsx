'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useSyncExternalStore } from 'react';
import type { PassEntry } from '@/lib/runner';
import RewardedButton from '../RewardedButton';

/** 결제 대행사 심사가 끝나면 연다 (docs/09 6번). 그 전에는 주문 요약까지만 보여 준다 */
const PAYMENTS_OPEN = false;

const PRESETS = [1, 3, 5, 10];
const MAX = 20;
const METHODS = [
  { key: 'card', label: '신용·체크카드' },
  { key: 'tosspay', label: '토스페이' },
  { key: 'kakaopay', label: '카카오페이' },
  { key: 'naverpay', label: '네이버페이' },
] as const;
const REASON: Record<string, string> = { grant: '운영자 지급', purchase: '구매', reward: '광고 보상', use: '사용', refund: '돌려받음' };
const STAGE: Record<string, string> = { r1: '1차', r2: '2차', final: '최종' };

const noSubscribe = () => () => {};
const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;

/** 관문권 상점. 바탕화면의 브라우저 창 안에 뜬 쇼핑몰처럼 보인다 */
export default function Shop({ required, viewer, wallet, priceKrw, freeR1PerDay, rules, rewarded }: {
  /** 관문권을 받는지 (D-48). 꺼져 있으면 지금은 필요 없다고 알린다 */
  required: boolean;
  viewer: { name: string } | null;
  wallet: { balance: number; freeR1Left: number; history: (PassEntry & { when: string })[] } | null;
  priceKrw: number; freeR1PerDay: number;
  rules: { label: string; passes: number }[];
  /** 보상형 광고로 관문권 받기 (D-51). 운영하지 않으면 null */
  rewarded: { unit: string; left: number } | null;
}) {
  const router = useRouter();
  /** 주소창: 바탕화면 창과 같이 지금 화면의 실제 주소 (서버 렌더에서는 비워 둔다) */
  const address = useSyncExternalStore(noSubscribe, () => window.location.href, () => '');
  const [qty, setQty] = useState(3);
  const [method, setMethod] = useState<(typeof METHODS)[number]['key']>('card');
  const [agreed, setAgreed] = useState(false);
  const total = qty * priceKrw;
  const supply = Math.round(total / 1.1);
  const set = (n: number) => setQty(Math.min(MAX, Math.max(1, n)));

  return (
    <section className="window shop-window" aria-label="관문권 상점">
      <header className="title-bar">
        <span className="title">🎟️ 관문권 상점 - Agent Interview Arena</span>
      </header>
      <div className="browser-bar">
        <span className="tab">관문권 상점</span>
        <span className="address">{address || ' '}</span>
      </div>

      <div className="window-body page shop">
        <nav className="shop-nav">
          <b className="shop-logo">ARENA<span>STORE</span></b>
          <span className="muted">{viewer ? `${viewer.name} 님` : '로그인이 필요합니다'}</span>
          {wallet && <span className="shop-wallet">보유 <b>{wallet.balance}</b>장</span>}
        </nav>

        {!required && (
          <p className="shop-notice" role="status">
            지금은 관문권 없이 모든 면접 관문을 볼 수 있습니다. 관문권은 나중에 이용자가 많아지면 받습니다.
          </p>
        )}
        {required && !PAYMENTS_OPEN && (
          <p className="shop-notice" role="status">
            지금은 결제를 받지 않습니다. 사업자 등록과 결제 대행사 심사가 끝나면 이 화면에서 바로 살 수 있습니다. 그 전에는 운영자가 시험용 관문권을 지급합니다.
          </p>
        )}

        <div className="shop-grid">
          <article className="shop-product">
            <div className="pass-art" aria-hidden="true">
              <span className="pass-stub">ADMIT ONE</span>
              <span className="pass-main"><b>GATE PASS</b><small>2차 · 최종 · 추가 1차</small></span>
            </div>
            <div className="shop-product-body">
              <h1>관문권</h1>
              <p className="shop-price">{won(priceKrw)} <span className="muted">/ 1장 · 부가세 포함</span></p>
              <p className="muted">서류전형을 통과한 지원서가 다음 관문에 들어갈 때 씁니다.</p>

              <fieldset className="shop-presets">
                <legend>수량</legend>
                {PRESETS.map(n => (
                  <button key={n} type="button" className={qty === n ? 'on' : ''} aria-pressed={qty === n} onClick={() => set(n)}>{n}장</button>
                ))}
                <span className="stepper">
                  <button type="button" aria-label="한 장 빼기" onClick={() => set(qty - 1)} disabled={qty <= 1}>−</button>
                  <input type="number" min={1} max={MAX} value={qty} aria-label="수량" onChange={e => set(Number(e.target.value) || 1)} />
                  <button type="button" aria-label="한 장 더하기" onClick={() => set(qty + 1)} disabled={qty >= MAX}>+</button>
                </span>
              </fieldset>

              <fieldset className="shop-methods">
                <legend>결제 수단</legend>
                {METHODS.map(m => (
                  <label key={m.key} className={method === m.key ? 'on' : ''}>
                    <input type="radio" name="method" value={m.key} checked={method === m.key} onChange={() => setMethod(m.key)} />
                    {m.label}
                  </label>
                ))}
              </fieldset>
            </div>
          </article>

          <aside className="shop-summary" aria-label="주문 요약">
            <h2>주문 요약</h2>
            <dl>
              <dt>관문권 × {qty}</dt><dd>{won(total)}</dd>
              <dt className="muted">공급가액</dt><dd className="muted">{won(supply)}</dd>
              <dt className="muted">부가세</dt><dd className="muted">{won(total - supply)}</dd>
              <dt className="total">결제 금액</dt><dd className="total">{won(total)}</dd>
            </dl>
            {wallet && <p className="muted">결제 후 보유 {wallet.balance + qty}장</p>}
            <label className="shop-agree">
              <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} />
              <span>아래 이용 안내와 환불 규정을 확인했습니다. 사용한 관문권은 청약 철회 대상이 아닙니다.</span>
            </label>
            {viewer ? (
              <button type="button" className="shop-pay" disabled={!PAYMENTS_OPEN || !agreed}>
                {PAYMENTS_OPEN ? `${won(total)} 결제하기` : '결제 준비 중'}
              </button>
            ) : (
              <Link className="button-link shop-pay" href="/">로그인하러 가기</Link>
            )}
            {viewer && rewarded && (
              <>
                <p className="muted small shop-or">또는 광고를 끝까지 보고 하루 한 장씩 받을 수 있습니다.</p>
                <RewardedButton unit={rewarded.unit} left={rewarded.left} onGranted={() => router.refresh()} />
              </>
            )}
          </aside>
        </div>

        <section className="shop-info">
          <div>
            <h2>어디에 쓰나요</h2>
            <ul>
              <li><b>서류전형</b>은 무료입니다. 체급마다 하루 3번 낼 수 있습니다.</li>
              <li><b>1차 면접</b>은 하루 {freeR1PerDay}번 무료이고{wallet ? ` (오늘 ${wallet.freeR1Left}번 남음)` : ''}, 그 뒤로는 관문권을 씁니다.</li>
              <li><b>2차·최종 면접</b>은 관문마다 관문권을 씁니다: {rules.map(r => `${r.label} ${r.passes}장`).join(' · ')}.</li>
              <li>서버 오류로 끝난 관문은 다시 시도해도 관문권을 더 쓰지 않습니다.</li>
            </ul>
          </div>
          <div>
            <h2>환불 규정</h2>
            <ul>
              <li>쓰지 않은 관문권은 구매 후 7일 안에 환불할 수 있습니다.</li>
              <li>쓴 관문권은 환불하지 않습니다. 면접이 접수되지 않았으면 자동으로 돌려받습니다.</li>
              <li>시즌이 바뀌어도 남은 관문권은 그대로 씁니다.</li>
            </ul>
          </div>
        </section>

        {wallet && (
          <section className="shop-history">
            <h2>관문권 내역</h2>
            {wallet.history.length === 0 ? (
              <p className="muted">아직 내역이 없습니다.</p>
            ) : (
              <table>
                <thead><tr><th>일시</th><th>내용</th><th>지원서</th><th className="num">장수</th></tr></thead>
                <tbody>
                  {wallet.history.map(h => (
                    <tr key={h.id}>
                      <td>{h.when}</td>
                      <td>{REASON[h.reason] ?? h.reason}{h.challenge ? ` · ${STAGE[h.challenge] ?? h.challenge}` : ''}</td>
                      <td>{h.agentName?.replace(/\.md$/, '') ?? '—'}</td>
                      <td className={`num ${h.delta > 0 ? 'pass' : 'fail'}`}>{h.delta > 0 ? `+${h.delta}` : h.delta}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}
      </div>
    </section>
  );
}
