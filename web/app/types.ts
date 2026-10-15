/** 홈 화면에 내려 주는 체급 정보 (lib/policy.ts DIVISIONS + 오늘 쓴 티켓) */
export type DivisionInfo = {
  key: 'light' | 'middle' | 'open';
  label: string;
  engine: string;
  ticketsPerDay: number;
  used: number;
  efforts: string[];
  byok: boolean;
  open: boolean;
  closedReason?: string;
};

export type LoginMode = 'supabase' | 'dev' | 'none';
