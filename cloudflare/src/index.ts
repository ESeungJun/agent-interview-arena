/**
 * Cloudflare 배포 진입점. 웹(web/, Next.js + 면접 워커)을 컨테이너 하나로 띄우고 모든 요청을 그쪽으로 넘긴다.
 *
 * - 면접 워커가 컨테이너 안에서 몇 분씩 돌지만 Cloudflare 는 그것을 활동으로 치지 않는다. 그래서 쉬는 시간이 지나도 끄지 않는다 (항상 켜 둠).
 * - 호스트 재시작 등으로 꺼지면 1분마다 도는 크론이 다시 깨운다. 끊긴 단계는 웹 워커의 정리 작업이 오류로 돌려 다시 시도할 수 있게 한다.
 * - 접속자 IP·원래 주소를 x-forwarded-* 로 넘긴다 (접속 기록, 다른 사이트 요청 차단, 로그인 리디렉션이 쓴다).
 */
import { Container, getContainer } from '@cloudflare/containers';

type Env = {
  ARENA: DurableObjectNamespace<Arena>;
  ANTHROPIC_API_KEY: string;
  DATABASE_URL: string;
  DATABASE_CA_CERT?: string;
  NEXT_PUBLIC_SUPABASE_URL: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY: string;
  SITE_URL: string;
  ARENA_BYOK_SECRET: string;
  ARENA_EXAM_SECRET: string;
  ARENA_ADMIN_EMAILS?: string;
};

/** 컨테이너에 넘길 변수 (wrangler secret / vars 에서 읽는다) */
const PASSED = [
  'ANTHROPIC_API_KEY', 'DATABASE_URL', 'DATABASE_CA_CERT', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SITE_URL', 'ARENA_BYOK_SECRET', 'ARENA_EXAM_SECRET', 'ARENA_ADMIN_EMAILS',
] as const;

export class Arena extends Container<Env> {
  defaultPort = 3100;
  sleepAfter = '10m';
  pingEndpoint = 'localhost/api/health';

  constructor(ctx: ConstructorParameters<typeof Container>[0], env: Env) {
    super(ctx, env);
    const vars: Record<string, string> = { NODE_ENV: 'production', PORT: '3100', HOSTNAME: '0.0.0.0' };
    for (const key of PASSED) if (env[key]) vars[key] = env[key] as string;
    this.envVars = vars;
  }

  /** 대기열의 면접이 도는 중일 수 있어 쉬는 시간이 지나도 끄지 않는다 */
  override async onActivityExpired(): Promise<void> {}
}

/** 웹은 컨테이너 하나로 돈다 (대기열 워커가 한 프로세스에 있다) */
const arena = (env: Env) => getContainer(env.ARENA, 'main');

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const forwarded = new Request(request);
    forwarded.headers.set('x-forwarded-for', request.headers.get('cf-connecting-ip') ?? '');
    forwarded.headers.set('x-forwarded-host', url.host);
    forwarded.headers.set('x-forwarded-proto', url.protocol.replace(':', ''));
    return arena(env).fetch(forwarded);
  },

  /** 컨테이너가 꺼져 있으면 다시 깨워 대기열을 이어서 처리하게 한다 */
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    await arena(env).fetch(new Request('https://arena.internal/api/health'));
  },
} satisfies ExportedHandler<Env>;
