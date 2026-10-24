-- 운영 기록. 둘 다 덧붙이기만 하고 고치지 않는다 (지원서 문서는 다시 시도하면 단계 기록을 덮어쓰기 때문에 따로 남긴다)

-- 접속·요청 기록: 페이지 열람, API 요청(성공·실패), 로그인·로그아웃, 보안 경고
create table if not exists events (
  id bigserial primary key,
  at timestamptz not null default now(),
  kind text not null,
  account_id text,
  application_id uuid,
  version int,
  challenge text,
  method text,
  path text,
  status int,
  ok boolean not null,
  duration_ms int,
  ip text,
  user_agent text,
  -- 요청별 요약 (에러 메시지 등). 지원자 키·쿠키·요청 본문 원문은 넣지 않는다
  data jsonb not null default '{}'::jsonb
);
create index if not exists events_at on events (at);
create index if not exists events_account on events (account_id, at);
create index if not exists events_application on events (application_id, at);
alter table events enable row level security;

-- 면접 단계 실행 기록: 단계를 돌릴 때마다 한 줄 (성공·탈락·서버 오류 모두). 측정값(토큰·비용·시간)과 결과·로그 원문
create table if not exists stage_runs (
  id bigserial primary key,
  application_id uuid not null,
  version int not null,
  challenge text not null,
  account_id text not null,
  division text not null,
  md_hash text not null,
  quarter text not null,
  status text not null check (status in ('done', 'error')),
  passed boolean,
  security_ban text,
  result text,
  error text,
  backend text,
  worker_id text,
  started_at timestamptz not null,
  finished_at timestamptz not null default now(),
  duration_ms int not null,
  cost_usd numeric(12, 6),
  config jsonb,
  usage jsonb,
  stages jsonb,
  logs jsonb not null default '[]'::jsonb
);
create index if not exists stage_runs_application on stage_runs (application_id, version, challenge);
create index if not exists stage_runs_finished on stage_runs (finished_at);
alter table stage_runs enable row level security;
