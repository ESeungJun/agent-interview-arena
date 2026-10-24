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
/** 브라우저 Supabase 클라이언트 설정. NEXT_PUBLIC_ 값은 빌드할 때 박히므로 컨테이너가 실행할 때 받은 값을 서버가 넘겨준다 */
export type SupabasePublic = { url: string; anonKey: string };
