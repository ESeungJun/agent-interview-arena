import { auditPage } from '@/lib/audited';
import { devLoginEnabled, getViewer, SUPABASE, supabaseEnabled } from '@/lib/auth';
import { adSlot, DIVISIONS, GATE, INTERVIEWER, MODEL_LABEL, type Division } from '@/lib/policy';
import { challengeState, sealedChallenge, statusLabel, ticketsUsedToday } from '@/lib/runner';
import { currentVersion, listByOwner } from '@/lib/store';
import Desktop, { type HistoryItem } from './Desktop';
import { agentSprite } from './pixel/cast';
import type { DivisionInfo, LoginMode } from './types';

export const dynamic = 'force-dynamic';
// 레이아웃의 제목 틀(%s · …)은 하위 경로에만 붙어 홈은 전체 제목을 직접 쓴다
export const metadata = { title: { absolute: '에이전트 채용 · Agent Interview Arena' } };

export default async function Page() {
  await auditPage('/');
  const viewer = await getViewer();
  // DB 가 컨테이너와 다른 지역에 있어 왕복 한 번이 비싸다. 서로 기다릴 필요 없는 조회는 함께 보낸다
  const [mine, used] = viewer
    ? await Promise.all([listByOwner(viewer.id), ticketsUsedToday(viewer.id)])
    : [[], { light: 0, middle: 0, open: 0 }];

  const history: HistoryItem[] = mine.map(a => {
    const v = currentVersion(a);
    const sealed = sealedChallenge(a);
    return {
      id: a.id,
      name: a.agentName.replace(/\.md$/, ''),
      version: v.n,
      face: agentSprite(a.character),
      chances: `${DIVISIONS[a.division].label} · ${MODEL_LABEL[DIVISIONS[a.division].engine]}`,
      status: statusLabel(a),
      // 결과를 열지 않은 단계는 합격 여부를 내려 주지 않는다
      attempts: Object.fromEntries(Object.entries(v.attempts).map(([k, x]) => [k, { status: x!.status, passed: k === sealed ? undefined : x!.passed, revealedAt: x!.revealedAt }])),
      next: challengeState(a).next,
      trashedAt: a.trashedAt ?? null,
    };
  });

  // 같은 파일 이름·체급으로 내면 새 버전으로 이어지는 지원서 (지원 폼이 첨부한 파일 이름과 맞춰 미리 알려 준다)
  const revisable = mine.flatMap(a => {
    if (a.trashedAt) return [];
    const base = { agentName: a.agentName, division: a.division, version: currentVersion(a).n, outToday: false };
    if (sealedChallenge(a)) return [{ ...base, sealed: true }];
    return challengeState(a).canRevise ? [{ ...base, sealed: false }] : [];
  });

  const divisions: DivisionInfo[] = (Object.keys(DIVISIONS) as Division[]).map(key => {
    const d = DIVISIONS[key];
    return { key, label: d.label, engine: MODEL_LABEL[d.engine], ticketsPerDay: d.ticketsPerDay, used: used[key], efforts: d.efforts, byok: d.byok, open: d.open, closedReason: d.closedReason };
  });
  const loginMode: LoginMode = supabaseEnabled() ? 'supabase' : devLoginEnabled() ? 'dev' : 'none';

  return <Desktop viewer={viewer ? { name: viewer.name } : null} loginMode={loginMode} supabase={loginMode === 'supabase' ? SUPABASE : undefined} history={history} revisable={revisable} divisions={divisions} interviewer={MODEL_LABEL[INTERVIEWER]} passesRequired={GATE.required} hallAd={adSlot('hall')} />;
}
