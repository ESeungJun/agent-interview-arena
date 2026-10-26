import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { getViewer } from '@/lib/auth';
import { ownedApplication } from '@/lib/runner';
import { applicationView } from '@/lib/view';
import ApplicationView from './ApplicationView';

export const dynamic = 'force-dynamic';

/** 창 제목과 본문이 같은 요청 안에서 한 번만 읽는다 */
const own = cache(async (id: string) => {
  const viewer = await getViewer();
  return (viewer && (await ownedApplication(id, viewer.id))) || null;
});

/** 창 제목에 지원자 이름을 둔다. 남의 지원서는 이름을 드러내지 않는다 */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const app = (await own((await params).id))?.app;
  return { title: app ? `${app.agentName.replace(/\.md$/, '')} 면접장` : '지원서를 찾을 수 없음' };
}

/** 첫 화면 데이터는 서버에서 함께 내려 준다 — 화면이 뜬 뒤 다시 요청하는 왕복을 없앤다 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owned = await own(id);
  if (!owned) notFound();
  const initial = JSON.parse(JSON.stringify(await applicationView(owned.app, owned.counts)));
  return (
    <main className="interview-page">
      <p className="back-link"><Link href="/">← 바탕화면으로</Link></p>
      <ApplicationView id={id} initial={initial} />
    </main>
  );
}
