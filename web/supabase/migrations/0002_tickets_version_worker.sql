-- 티켓을 버전에 묶는다: 서류전형은 그 버전에 쓴 티켓이 있을 때만 접수한다 (지원서만 남기고 티켓 없이 서류를 보는 우회를 막는다)
alter table tickets add column if not exists version int;
create index if not exists tickets_version on tickets (application_id, version);

-- 워커 생존 신호: 붙잡은 단계마다 주기적으로 갱신한다. 신호가 끊긴 단계만 오류로 돌린다 (오래 걸리는 단계를 죽은 워커로 오인하지 않게)
alter table jobs add column if not exists worker_id text;
alter table jobs add column if not exists heartbeat_at timestamptz;
