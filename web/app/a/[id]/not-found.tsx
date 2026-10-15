import Link from 'next/link';

/** 없는 지원서(완전 삭제했거나 다른 계정의 지원서). 404 상태로 내려 준다 */
export default function NotFound() {
  return (
    <main className="interview-page">
      <section className="card">
        <h2>지원서를 찾을 수 없습니다</h2>
        <p className="muted">휴지통에서 완전히 삭제했거나, 로그인하지 않았거나, 다른 계정으로 낸 지원서일 수 있습니다.</p>
        <div className="row"><Link className="button-link" href="/">바탕화면으로 돌아가기</Link></div>
      </section>
    </main>
  );
}
