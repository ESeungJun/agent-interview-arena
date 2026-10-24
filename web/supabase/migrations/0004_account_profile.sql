-- 계정 정보: 로그인 공급자·이메일·마지막 로그인. 이메일은 운영자 화면(/admin)에서만 쓰고 공개 화면·명예의 전당에는 내보내지 않는다
alter table accounts add column if not exists email text;
alter table accounts add column if not exists provider text;
alter table accounts add column if not exists last_login_at timestamptz;
