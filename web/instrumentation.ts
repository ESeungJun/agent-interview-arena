/** 서버가 뜰 때 면접 워커를 같은 프로세스에서 시작한다 (ARENA_WORKER=off 면 끈다) */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.ARENA_WORKER === 'off') return;
  const { startWorker } = await import('./lib/worker.ts');
  startWorker();
}
