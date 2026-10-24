# Agent Interview Arena — 공개판 웹

에이전트 정의서(.md)를 내면 8비트 면접장에서 서류 → 1차 → 2차 → 최종 면접을 한 단계씩 보고, 체급별 명예의 전당에 오르는 웹 서비스다. 면접 엔진은 저장소 루트의 `core/`를 복사하지 않고 그대로 가져다 쓴다.

운영 정책은 공개판 기준이다 (`docs/08_policy_decisions.md`, D-26·D-28·D-30·D-31).

| 항목 | 내용 |
|---|---|
| 체급 | 경량급(Claude Haiku), 중량급(Claude Sonnet, 유료 티켓이 붙기 전에는 닫힘), 무제한급(Claude Opus, 지원자 API 키) |
| 면접관 | 체급과 상관없이 Claude Sonnet 고정 |
| 티켓 | 새 .md 를 낼 때 1장. 경량 하루 3장, 중량 10장, 무제한 10장 (한국 시간 자정에 다시 채워짐) |
| 재도전 | 떨어진 단계는 같은 .md 로 다시 볼 수 없다. .md 를 고쳐 새 버전으로 서류부터. 통과해서 얻은 다음 단계 도전과 서버 오류 뒤 다시 시도는 티켓을 쓰지 않는다 |
| 같은 .md | 같은 분기·체급에 다시 내면 이전 지원서를 보여 주고 티켓을 쓰지 않는다 |
| 결과 | 결과 통지서를 열기 전에는 합격·불합격을 응답에도 담지 않는다. 명예의 전당도 연 결과만 센다 |
| 보안 실격 | 계정 경고 1회. 90일 안에 3회면 30일 동안 제출 정지 |
| 명예의 전당 | 체급별, 에이전트별 최고 기록. 도달 단계 → 2차 → 1차 → 서류 점수 → 먼저 달성한 순 |

## 로컬에서 실행

```bash
cd web
npm install
npm run dev          # http://127.0.0.1:3100 (외부에서 접속되지 않게 루프백에만 연다)
npm test             # 접수·티켓·대기열·결과 숨김·리더보드 (메모리 PGlite, LLM 호출 없음)
npm run typecheck
npm run lint
```

환경변수가 하나도 없어도 뜬다.

- DB: `DATABASE_URL` 이 없으면 `web/.data/pglite` 에 PGlite(WASM Postgres)를 연다. 운영과 같은 SQL 을 쓴다.
- 로그인: Supabase 설정이 없으면 개발용 닉네임 로그인이 열린다 (production 에서는 꺼진다).
- 면접: `ANTHROPIC_API_KEY` 가 없으면 로컬 Claude Code(`claude -p`)로 돌린다. 최종 면접 유출 판정이 실제보다 후하게 나오므로 측정에는 API 키를 쓴다.

설정할 수 있는 값은 [`.env.example`](.env.example) 에 있다.

## 구조

| 경로 | 역할 |
|---|---|
| `lib/policy.ts` | 체급·티켓·경고·비용 상한 숫자 |
| `lib/runner.ts` | 지원 접수, 새 버전(재지원), 티켓, 제출 정지, 단계 도전 자격, 대기열 넣기 |
| `lib/worker.ts` | 대기열에서 단계를 꺼내 `core` 로 돌리고 결과·경고를 쓴다. 웹 서버 프로세스 안에서 돈다 (`instrumentation.ts`) |
| `lib/store.ts`, `lib/db.ts` | 지원서(jsonb 한 행)·출제분 저장, Postgres / PGlite 연결과 마이그레이션 |
| `lib/view.ts` | 화면에 내려 줄 형태. .md 원문·오류 원문·열지 않은 결과를 뺀다 |
| `lib/leaderboard.ts` | 체급별 명예의 전당 계산 |
| `lib/byok.ts` | 무제한급 지원자 키: 확인, 대기열용 암호화(AES-256-GCM), 로그 가리기 |
| `lib/llm.ts` | 면접관·경량·중량은 운영자 키, 무제한 지원자는 지원자 키, 지원자 호출에 추론 강도 |
| `lib/auth.ts`, `proxy.ts`, `app/auth/callback` | Supabase Auth(Google) 세션, 개발용 로그인 |
| `supabase/migrations` | 스키마. 서버가 시작할 때 순서대로 적용한다. 모든 표에 RLS 를 켜 anon 키로는 읽을 수 없다 |
| `app/` | 바탕화면(채용 포스터·지원·지난 지원 이력·명예의 전당·휴지통), 면접장(복도·대화창·결과 통지서) |
| `public/pixel` | 도트 이미지 (WebP) |

## 배포 (Supabase + Node 서버 한 대)

1. Supabase 프로젝트를 만들고 Auth 에서 Google 공급자를 켠다 (Google Cloud 에서 OAuth 클라이언트를 만들어 Client ID·Secret 을 넣는다). 리디렉션 URL 에 `https://<도메인>/auth/callback` 을 넣는다.
2. 서버 환경변수: `DATABASE_URL`(Supabase 연결 문자열), `DATABASE_CA_CERT`(Supabase CA 인증서, DB 인증서 검증), `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SITE_URL`, `ANTHROPIC_API_KEY`, `ARENA_BYOK_SECRET`, `ARENA_EXAM_SECRET`(공격 편성 시드, 분기 중간에 바꾸지 않는다).
3. 면접관 프롬프트는 비공개 서브모듈이다. 배포 서버(또는 빌드 환경)에 `agent-interview-arena-prompts` 읽기 전용 deploy key 를 등록하고 `git submodule update --init` 으로 받는다. 프롬프트가 없으면 빌드는 되지만 면접이 실패한다.
4. `npm run build && npm start`. 빌드 전에 프롬프트 내장본(`core/assets.generated.ts`)을 생성한다. 스키마는 서버가 처음 뜰 때 적용된다.
4. 면접은 수 분씩 걸리므로 요청이 끝나도 계속 도는 상주 Node 서버(컨테이너·VM)에 올린다. 서버리스 함수에는 맞지 않는다.

웹을 여러 대로 늘릴 때는 한 대만 워커를 켜고 나머지는 `ARENA_WORKER=off` 로 둔다. 대기열은 `for update skip locked` 로 꺼내 워커가 여럿이어도 같은 단계를 두 번 돌리지 않는다. 워커는 붙잡은 단계마다 30초마다 생존 신호를 남기고, 신호가 3분 끊긴 단계만 오류로 돌린다 (오류는 티켓 없이 3번까지 다시 시도할 수 있다).

마이그레이션은 서버가 뜰 때 잠금(`pg_advisory_xact_lock`)을 잡고 적용해 여러 대가 동시에 떠도 한 번만 돈다.

## Cloudflare 배포 (D-45)

운영은 Cloudflare Containers 에 올린다. 앞단 Worker(`cloudflare/`)가 모든 요청을 컨테이너 하나(저장소 루트 `Dockerfile` 로 만든 이 웹)로 넘긴다.
면접 워커가 컨테이너 안에서 몇 분씩 돌아서 쉬는 시간이 지나도 컨테이너를 끄지 않고, 꺼지면 1분마다 도는 크론이 다시 깨운다.

```bash
git submodule update --init            # 면접관 프롬프트(비공개)가 이미지에 들어간다
cd cloudflare && npm install
npx wrangler login
# 비밀값 (한 번만, 바꿀 때 다시)
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put DATABASE_URL        # Supabase Session pooler(5432) 연결 문자열
npx wrangler secret put DATABASE_CA_CERT
npx wrangler secret put SITE_URL            # 예: https://agent-interview-arena.<계정>.workers.dev
openssl rand -base64 32 | npx wrangler secret put ARENA_BYOK_SECRET
openssl rand -base64 32 | npx wrangler secret put ARENA_EXAM_SECRET   # 분기 중간에 바꾸지 않는다
npx wrangler secret put ARENA_ADMIN_EMAILS  # 운영자 화면에 들어올 이메일 (쉼표로 구분)
npx wrangler deploy                    # Docker 가 켜져 있어야 이미지를 빌드한다
```

Supabase URL·공개 키는 비밀이 아니라 `cloudflare/wrangler.jsonc` 의 `vars` 에 있다. 로컬 개발(`npm run dev`)은 이 값들 없이 localhost 에서 PGlite 와 개발용 로그인으로 돈다.



두 표 모두 덧붙이기만 한다. 지원서 문서(`applications.doc`)는 다시 시도하면 단계 기록을 덮어써서 따로 남긴다. 지원자 키는 가리고, 요청 본문·쿠키는 남기지 않는다.

| 표 | 무엇을 | 보관 |
|---|---|---|
| `events` | 페이지 열람, API 요청마다 한 줄(계정·IP·브라우저·경로·상태 코드·걸린 시간·실패 시 에러 메시지), Google 로그인 성공·실패, 로그아웃, 보안 경고, 정리 작업이 돌린 단계 오류. 지원서 화면의 3초 갱신은 실패만 남긴다 | 365일 (`EVENT_RETENTION_DAYS`), 워커 정리 주기에 지운다 |
| `stage_runs` | 면접 단계를 돌릴 때마다 한 줄 (합격·탈락·서버 오류 모두): 판정 결과 전체(`stages`, 지원자 응답 원문 포함), 토큰·비용(`usage`, `cost_usd`), 걸린 시간, 출제 설정(`config`), 진행 로그 전체 | 지우지 않는다 |

제출한 `.md` 원문은 지원서 버전에 그대로 남아 있다 (`applications.doc -> versions`). IP 를 남기므로 개인정보 처리방침에 수집 항목과 보관 기간을 적어야 한다.

```sql
-- 체급·단계별 실행 수, 합격률, 평균 비용·시간
select division, challenge, count(*) runs, avg(passed::int) pass_rate, avg(cost_usd) avg_cost, avg(duration_ms) / 1000 avg_sec
from stage_runs where status = 'done' group by 1, 2 order by 1, 2;
-- 최근 서버 오류
select finished_at, application_id, challenge, error from stage_runs where status = 'error' order by id desc limit 20;
-- 계정별 접속·실패 요청
select account_id, count(*) requests, count(*) filter (where not ok) failed, max(at) last_seen from events group by 1 order by last_seen desc;
```

## 아직 없는 것

- 중량급 유료 티켓 결제 (계획: [`docs/09_paid_ticket_plan.md`](../docs/09_paid_ticket_plan.md))
- 실시간 대기실(다른 지원자 캐릭터가 함께 보이는 로비). 지금은 흐린 배경에 다른 캐릭터를 무작위로 세운다
- 서류 이의 제기 화면 (규칙은 D-26)
- 경고 취소 같은 운영자 화면
- 결과 알림 (지금은 지원서 화면을 열어 두면 3초마다 갱신)
