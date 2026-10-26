/** 바탕화면 등으로 넘어가는 동안 바로 보이는 화면 (누르자마자 반응하게). 면접장은 a/[id]/loading.tsx 를 쓴다 */
export default function Loading() {
  return (
    <main className="interview-page">
      <div className="loading-screen">
        <p className="dialog-name">이동하는 중…</p>
        <div className="bar"><div className="bar-indeterminate" /></div>
      </div>
    </main>
  );
}
