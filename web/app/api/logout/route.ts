import { NextResponse } from 'next/server';
import { DEV_COOKIE, supabaseEnabled, supabaseServer } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST() {
  if (supabaseEnabled()) await (await supabaseServer()).auth.signOut();
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(DEV_COOKIE);
  return res;
}
