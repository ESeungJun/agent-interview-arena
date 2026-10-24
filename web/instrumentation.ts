/** 서버가 뜰 때 면접 워커를 같은 프로세스에서 시작한다 (ARENA_WORKER=off 면 끈다). 잡히지 않은 서버 오류는 운영 기록(events)에 남긴다 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { watchServerErrors } = await import('./lib/audit.ts');
  watchServerErrors();
  if (process.env.ARENA_WORKER === 'off') return;
  const { startWorker } = await import('./lib/worker.ts');
  startWorker();
}
