'use client';

import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { BASE } from './pixel/cast';
import type { LoginMode } from './types';

/**
 * 지원 영역 자리의 로그인. 운영은 Google 로그인(Supabase Auth), 로컬 개발은 닉네임만 넣는 개발용 로그인.
 * 지원 이력·티켓·리더보드 이름이 계정에 묶이므로 지원하려면 로그인해야 한다.
 */
export default function Login({ mode }: { mode: LoginMode }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function google() {
    setBusy(true);
    setError(null);
    const supabase = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${location.origin}${BASE}/auth/callback` } });
    if (error) {
      setError(error.message);
      setBusy(false);
    }
  }

  async function devLogin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/dev-login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `로그인하지 못했습니다 (${res.status})`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="apply" id="apply">
      <h2>온라인 지원</h2>
      <div className="login-card">
        <p>지원하려면 로그인해 주세요. 지원 이력과 하루 티켓, 명예의 전당 이름이 계정에 묶입니다.</p>
        {mode === 'supabase' && <button disabled={busy} onClick={() => void google()}>Google 로 로그인</button>}
        {mode === 'dev' && (
          <form className="row" onSubmit={devLogin}>
            <input className="apply-input inline" placeholder="개발용 닉네임" value={name} onChange={e => setName(e.target.value)} aria-label="개발용 닉네임" />
            <button disabled={busy || !name.trim()}>개발용 로그인</button>
          </form>
        )}
        {mode === 'none' && <p className="error">로그인이 설정되지 않았습니다 (NEXT_PUBLIC_SUPABASE_URL·ANON_KEY).</p>}
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </section>
  );
}
