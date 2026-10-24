import { after, NextResponse } from 'next/server';
import { ensureAccount } from '@/lib/auth';
import { assignCharacter, parseCharacter } from '@/lib/character';
import { fail, requireViewer } from '@/lib/http';
import { isDivision, type Effort } from '@/lib/policy';
import { readJson } from '@/lib/request';
import { submitApplication } from '@/lib/runner';
import { getApplication, mutateApplication } from '@/lib/store';
import { audited } from '@/lib/audited';

export const dynamic = 'force-dynamic';

const EFFORTS = ['low', 'medium', 'high'];

/**
 * 채용 페이지 지원. 새 지원서나 같은 이름으로 떨어진 지원서의 새 버전이면 서류전형을 대기열에 넣는다 (티켓 1장).
 * 같은 분기·체급에 이미 낸 .md 면 그 지원서를 돌려준다. 무제한급 지원자 키는 저장하지 않는다.
 */
async function handlePOST(req: Request) {
  const auth = await requireViewer();
  if ('error' in auth) return auth.error;
  const { body, error } = await readJson<{ md?: unknown; agentName?: unknown; character?: unknown; division?: unknown; effort?: unknown; apiKey?: unknown }>(req);
  if (error) return error;
  if (!isDivision(body?.division)) return fail('체급을 골라 주세요.', 400);
  await ensureAccount(auth.viewer);

  const md = typeof body?.md === 'string' ? body.md : '';
  const submitted = await submitApplication({
    ownerId: auth.viewer.id,
    agentName: typeof body?.agentName === 'string' ? body.agentName : 'agent.md',
    md,
    division: body.division,
    effort: EFFORTS.includes(body?.effort as string) ? (body!.effort as Effort) : undefined,
    byokKey: typeof body?.apiKey === 'string' && body.apiKey.trim() ? body.apiKey.trim() : undefined,
  });
  if (!submitted.ok) return fail(submitted.message, submitted.status);
  if (!submitted.reused) {
    // 첨부할 때 미리 판단한 캐릭터가 있으면 그대로 쓴다. 없으면 몇 초 안에 판단한다 (재지원이면 이미 있다)
    const app = await getApplication(submitted.id);
    const previewed = parseCharacter(body?.character);
    if (app && !app.character && previewed) await mutateApplication(app.id, a => void (a.character = previewed));
    else if (app && !app.character) after(() => assignCharacter(app.id, md));
  }
  return NextResponse.json({ id: submitted.id, reused: submitted.reused });
}

export const POST = audited('application_submit', handlePOST);
