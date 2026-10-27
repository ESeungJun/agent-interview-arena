/**
 * Cloudflare 배포 진입점. 웹(web/, Next.js + 면접 워커)을 컨테이너 하나로 띄우고 모든 요청을 그쪽으로 넘긴다.
 *
 * - 면접 워커가 컨테이너 안에서 몇 분씩 돌지만 Cloudflare 는 그것을 활동으로 치지 않는다. 그래서 쉬는 시간이 지나도 끄지 않는다 (항상 켜 둠).
 * - 호스트 재시작 등으로 꺼지면 1분마다 도는 크론이 다시 깨운다. 끊긴 단계는 웹 워커의 정리 작업이 오류로 돌려 다시 시도할 수 있게 한다.
 * - 접속자 IP·원래 주소를 x-forwarded-* 로 넘긴다 (접속 기록, 다른 사이트 요청 차단, 로그인 리디렉션이 쓴다).
 * - 비밀값을 바꾸면(wrangler secret put) 떠 있는 컨테이너는 옛 값을 그대로 쓴다. Durable Object 도 다시 만들어지지 않아 옛 env 를 들고 있으므로,
 *   Worker 가 받은 최신 값을 넘기고(sync) 지문이 바뀌었으면 컨테이너를 다시 띄운다. 넘기는 것은 isolate 마다 처음 한 번이다.
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
  /** 면접관 모델 (haiku·sonnet·opus). 없으면 sonnet (D-49) */
  ARENA_INTERVIEWER?: string;
  /** 출제 면접관 모델. 없으면 ARENA_INTERVIEWER (D-49) */
  ARENA_GENERATOR?: string;
  /** 1 이면 서류 다음 관문에 관문권을 받는다 (D-48) */
  ARENA_PASSES_REQUIRED?: string;
  /** 광고 (D-51): 애드센스 게시자 ID·자리별 광고 단위, 보상형 광고 단위, 하루 보상 상한, 자리 점검용 점선 상자 */
  ARENA_ADSENSE_CLIENT?: string;
  ARENA_AD_SLOT_HALL?: string;
  ARENA_AD_SLOT_WAITING?: string;
  ARENA_AD_REWARDED_UNIT?: string;
  ARENA_REWARDED_PER_DAY?: string;
  ARENA_ADS_PREVIEW?: string;
  /** 개인정보 처리방침의 문의처 */
  ARENA_CONTACT_EMAIL?: string;
};

/** 컨테이너에 넘길 변수 (wrangler secret / vars 에서 읽는다) */
const PASSED = [
  'ANTHROPIC_API_KEY', 'DATABASE_URL', 'DATABASE_CA_CERT', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SITE_URL', 'ARENA_BYOK_SECRET', 'ARENA_EXAM_SECRET', 'ARENA_ADMIN_EMAILS', 'ARENA_INTERVIEWER', 'ARENA_GENERATOR',
  'ARENA_PASSES_REQUIRED', 'ARENA_ADSENSE_CLIENT', 'ARENA_AD_SLOT_HALL', 'ARENA_AD_SLOT_WAITING', 'ARENA_AD_REWARDED_UNIT',
  'ARENA_REWARDED_PER_DAY', 'ARENA_ADS_PREVIEW', 'ARENA_CONTACT_EMAIL',
] as const;

export class Arena extends Container<Env> {
  defaultPort = 3100;
  sleepAfter = '10m';
  pingEndpoint = 'localhost/api/health';

  constructor(ctx: ConstructorParameters<typeof Container>[0], env: Env) {
    super(ctx, env);
    this.envVars = containerVars(env);
  }

  /** 대기열의 면접이 도는 중일 수 있어 쉬는 시간이 지나도 끄지 않는다 */
  override async onActivityExpired(): Promise<void> {}

  /** Worker 가 받은 최신 값을 쓴다. 떠 있는 컨테이너가 다른 값으로 떠 있으면 멈추고, 다음 fetch 가 새 값으로 띄운다 */
  async sync(vars: Record<string, string>): Promise<void> {
    this.envVars = vars;
    const current = await signature(vars);
    const live = async () => ['running', 'healthy', 'stopping'].includes((await this.getState()).status);
    // 지문은 컨테이너를 띄우기 직전에만 적는다 (떠 있는 동안 적으면 옛 컨테이너를 새 값으로 적어 버린다)
    if ((await live()) && (await this.ctx.storage.get<string>('envSignature')) !== current) {
      await this.stop();
      // 완전히 멈춘 뒤에 새 값으로 띄운다 (멈추는 중에 넘기면 옛 컨테이너가 받을 수 있다)
      for (let i = 0; i < 60 && (await live()); i++) await scheduler.wait(500);
    }
    if (!(await live())) await this.ctx.storage.put('envSignature', current);
  }
}

function containerVars(env: Env): Record<string, string> {
  const vars: Record<string, string> = { NODE_ENV: 'production', PORT: '3100', HOSTNAME: '0.0.0.0' };
  for (const key of PASSED) if (env[key]) vars[key] = env[key] as string;
  return vars;
}

/** 넘긴 변수의 지문 (값 자체는 저장하지 않는다) */
async function signature(vars: Record<string, string>): Promise<string> {
  const text = Object.keys(vars).sort().map(k => `${k}=${vars[k]}`).join('\n');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 이 isolate 가 이미 넘긴 값의 지문. 비밀값을 바꾸면 Worker 새 버전이 떠 isolate 도 새로 생기므로 isolate 마다 처음 한 번만 넘기면 된다.
 * 요청마다 sync 를 부르면 Durable Object 왕복과 컨테이너 상태 조회로 요청마다 0.2초 넘게 늘었다.
 */
let syncedSignature: string | null = null;

/** 웹은 컨테이너 하나로 돈다 (대기열 워커가 한 프로세스에 있다) */
async function arena(env: Env) {
  const stub = getContainer(env.ARENA, 'main');
  const vars = containerVars(env);
  const current = await signature(vars);
  if (current !== syncedSignature) {
    await stub.sync(vars);
    syncedSignature = current;
  }
  return stub;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const forwarded = new Request(request);
    forwarded.headers.set('x-forwarded-for', request.headers.get('cf-connecting-ip') ?? '');
    forwarded.headers.set('x-forwarded-host', url.host);
    forwarded.headers.set('x-forwarded-proto', url.protocol.replace(':', ''));
    return (await arena(env)).fetch(forwarded);
  },

  /** 컨테이너가 꺼져 있으면 다시 깨워 대기열을 이어서 처리하게 한다 */
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    await (await arena(env)).fetch(new Request('https://arena.internal/api/health'));
  },
} satisfies ExportedHandler<Env>;
