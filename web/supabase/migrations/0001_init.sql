-- 공개판 스키마. 운영은 Supabase Postgres, 로컬 개발은 PGlite 에서 같은 SQL 을 쓴다.
-- 웹 서버가 DATABASE_URL 로 직접 접속해 읽고 쓴다. Supabase 의 공개 REST(anon 키)로는 아무것도 읽을 수 없게 모든 표에 RLS 를 켜고 정책은 두지 않는다.

-- 계정. id 는 Supabase Auth 사용자 id (로컬 개발은 dev:<이름>)
create table if not exists accounts (
  id text primary key,
  display_name text not null,
  created_at timestamptz not null default now()
);

-- 지원서 = 계정의 에이전트 하나(체급 하나). .md 버전·단계 결과·도전 기록은 doc(jsonb)에 통째로 둔다.
-- 고칠 때는 행을 잠그고(select … for update) 읽고 고쳐 쓴다 (lib/store.ts mutateApplication)
create table if not exists applications (
  id uuid primary key,
  owner_id text not null references accounts(id),
  agent_name text not null,
  division text not null check (division in ('light', 'middle', 'open')),
  doc jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists applications_owner on applications (owner_id, created_at desc);
create index if not exists applications_division on applications (division);

-- 하루 제출 티켓. 새 .md 를 낼 때(새 지원서·새 버전) 1장 쓴다. 한국 시간 자정 기준으로 센다
create table if not exists tickets (
  id bigserial primary key,
  account_id text not null references accounts(id),
  division text not null,
  application_id uuid,
  used_at timestamptz not null default now()
);
create index if not exists tickets_account on tickets (account_id, used_at);

-- 보안 실격 경고. 90일 안에 3번이면 30일 동안 제출할 수 없다 (docs/08 4번)
create table if not exists warnings (
  id bigserial primary key,
  account_id text not null references accounts(id),
  application_id uuid,
  rule text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index if not exists warnings_account on warnings (account_id, created_at);

-- 면접 대기열. 단계 하나가 한 행이고, 끝나면 지운다. 무제한급(BYOK) 키는 암호문으로만 잠깐 담겼다가 행과 함께 지워진다
create table if not exists jobs (
  id bigserial primary key,
  application_id uuid not null references applications(id) on delete cascade,
  version int not null,
  challenge text not null,
  byok_cipher text,
  created_at timestamptz not null default now(),
  claimed_at timestamptz
);
create index if not exists jobs_waiting on jobs (claimed_at, id);

-- 분기 고정 출제분 (core/exam.ts ExamStore)
create table if not exists exams (
  quarter text not null,
  md_hash text not null,
  data jsonb not null,
  primary key (quarter, md_hash)
);

alter table accounts enable row level security;
alter table applications enable row level security;
alter table tickets enable row level security;
alter table warnings enable row level security;
alter table jobs enable row level security;
alter table exams enable row level security;
