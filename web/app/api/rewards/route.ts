import { NextResponse } from 'next/server';
import { audited } from '@/lib/audited';
import { fail, requireViewer } from '@/lib/http';
import { ADS, GATE } from '@/lib/policy';
import { claimReward } from '@/lib/runner';

export const dynamic = 'force-dynamic';

/**
 * 보상형 광고를 끝까지 본 뒤 관문권 1장을 받는다 (D-51). 화면은 광고의 "보상 지급" 신호를 받은 뒤에만 부른다.
 * 웹 보상형 광고는 서버에서 시청을 확인할 수 없어 하루 상한(lib/runner.ts claimReward)으로 막는다.
 */
async function handlePOST() {
  const auth = await requireViewer();
  if ('error' in auth) return auth.error;
  if (!ADS.rewardedUnit) return fail('보상형 광고를 운영하지 않습니다.', 404);
  if (!GATE.required) return fail('지금은 관문권 없이 모든 관문을 볼 수 있습니다.', 409);
  const claimed = await claimReward(auth.viewer.id);
  if (!claimed.ok) return fail(claimed.message, claimed.status);
  const { balance, rewardsUsed } = claimed.counts;
  return NextResponse.json({ balance, left: Math.max(0, ADS.rewardedPerDay - rewardsUsed) });
}

export const POST = audited('reward_claim', handlePOST);
