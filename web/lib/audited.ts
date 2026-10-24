/**
 * 라우트·페이지 접속 기록. 응답을 보낸 뒤(after) events 에 한 줄 남긴다 (lib/audit.ts).
 * 누가(계정), 어디서(IP·브라우저), 무엇을(경로·지원서), 결과(상태 코드·에러 메시지·걸린 시간).
 */
import { headers } from 'next/headers';
import { after } from 'next/server';
import { clientMeta, logEvent } from './audit.ts';
import { getViewer } from './auth.ts';

const APP_PATH = /^\/api\/applications\/([0-9a-f-]{36})/i;

async function viewerId(): Promise<string | null> {
  try {
    return (await getViewer())?.id ?? null;
  } catch {
    return null;
  }
}

/** 응답 본문에서 기록할 것만 뽑는다: 실패면 에러 메시지, 새 지원서면 id */
function summarize(res: Response | undefined): Promise<{ error?: string; id?: string }> {
  if (!res || !res.headers.get('content-type')?.includes('application/json')) return Promise.resolve({});
  return read(res.clone());
}

async function read(copy: Response): Promise<{ error?: string; id?: string }> {
  try {
    const body = (await copy.json()) as { error?: unknown; id?: unknown };
    return {
      ...(typeof body.error === 'string' ? { error: body.error.slice(0, 500) } : {}),
      ...(typeof body.id === 'string' ? { id: body.id } : {}),
    };
  } catch {
    return {};
  }
}

/**
 * 라우트 처리기를 감싸 요청마다 기록한다. 지원서 화면은 3초마다 상태를 다시 읽어서 그 성공 응답은 skipOk 로 뺀다.
 * 요청 본문은 남기지 않는다 (지원자 키가 들어 있을 수 있다).
 */
export function audited<A extends unknown[]>(
  kind: string,
  handler: (req: Request, ...rest: A) => Promise<Response>,
  opts: { skipOk?: boolean } = {},
): (req: Request, ...rest: A) => Promise<Response> {
  return async (req, ...rest) => {
    const started = Date.now();
    let res: Response | undefined;
    let thrown: unknown;
    try {
      res = await handler(req, ...rest);
      return res;
    } catch (e) {
      thrown = e;
      throw e;
    } finally {
      const status = thrown ? 500 : (res?.status ?? 500);
      const ok = status < 400;
      if (!(opts.skipOk && ok)) {
        // 본문은 응답을 보내기 전에 복사해 둔다 (보낸 뒤에는 읽을 수 없다)
        const summarized = summarize(res);
        after(async () => {
          const path = new URL(req.url).pathname;
          const m = path.match(APP_PATH);
          const summary = await summarized;
          const error = thrown ? (thrown instanceof Error ? thrown.message : String(thrown)).slice(0, 500) : summary.error;
          await logEvent({
            kind, ok, status, method: req.method, path, durationMs: Date.now() - started,
            accountId: await viewerId(), applicationId: m?.[1] ?? summary.id,
            ...clientMeta(req.headers),
            data: error ? { error } : {},
          });
        });
      }
    }
  };
}

/** 서버 컴포넌트 페이지 열람 기록 */
export async function auditPage(path: string): Promise<void> {
  const h = await headers();
  after(async () => logEvent({ kind: 'page_view', ok: true, method: 'GET', path, accountId: await viewerId(), ...clientMeta(h) }));
}
