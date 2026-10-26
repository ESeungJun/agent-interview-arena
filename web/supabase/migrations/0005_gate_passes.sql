-- 관문 비용 (D-48): 서류는 무료 티켓, 1차는 계정당 하루 1회 무료, 그 밖의 관문은 관문권을 쓴다.
-- 무료 1차도 tickets 에 남긴다. 어느 관문에 쓴 티켓인지 challenge 로 가른다 (예전 행은 모두 서류)
alter table tickets add column if not exists challenge text not null default 'doc';
create index if not exists tickets_challenge on tickets (application_id, version, challenge);

-- 관문권 장부. 잔액은 계정별 delta 합계다. 결제가 붙기 전에는 운영자가 지급(grant)한다
create table if not exists pass_ledger (
  id bigserial primary key,
  account_id text not null references accounts(id),
  delta int not null,
  reason text not null, -- grant · purchase · use · refund
  application_id uuid,
  version int,
  challenge text,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists pass_ledger_account on pass_ledger (account_id);
create index if not exists pass_ledger_gate on pass_ledger (application_id, version, challenge);
alter table pass_ledger enable row level security;
