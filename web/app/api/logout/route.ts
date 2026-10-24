import { NextResponse } from 'next/server';
import { DEV_COOKIE, supabaseEnabled, supabaseServer } from '@/lib/auth';
import { audited } from '@/lib/audited';

export const dynamic = 'force-dynamic';

async function handlePOST() {
  if (supabaseEnabled()) await (await supabaseServer()).auth.signOut();
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(DEV_COOKIE);
  return res;
}

export const POST = audited('logout', handlePOST);
