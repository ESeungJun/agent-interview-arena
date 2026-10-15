/**
 * 공개판 운영 정책 (docs/08_policy_decisions.md, D-26·D-28·D-30). 숫자는 환경변수로 바꿀 수 있다.
 *
 * - 체급: 경량(Haiku, 무료 티켓 하루 3장), 중량(Sonnet, 유료 티켓 하루 10장 — 결제가 붙기 전에는 ARENA_MIDDLE_OPEN=1 일 때만 연다),
 *   무제한(Opus, BYOK 하루 10장). 면접관은 체급과 상관없이 Sonnet 으로 고정한다.
 * - 티켓은 새 .md 를 낼 때(새 지원서·새 버전) 1장 쓴다. 서류를 통과해 얻은 다음 단계 도전과 서버 오류 뒤 다시 시도는 쓰지 않는다.
 * - 같은 분기에 같은 .md 를 다시 내면 이전 지원서를 보여 주고 티켓을 쓰지 않는다.
 * - 떨어진 단계는 같은 .md 로 다시 볼 수 없다. .md 를 고쳐 새 버전으로 서류부터 다시 본다.
 * - 보안 실격은 경고 1회. 90일 안에 3회면 마지막 경고로부터 30일 동안 제출할 수 없다.
 */
import type { ModelAlias } from '../../core/engine.ts';

export type Division = 'light' | 'middle' | 'open';
export type Effort = 'low' | 'medium' | 'high';

const num = (value: string | undefined, fallback: number) => (value?.trim() && Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : fallback);

export const DIVISIONS: Record<Division, {
  label: string; engine: ModelAlias; ticketsPerDay: number;
  /** 지원자가 고를 수 있는 추론 강도. 비어 있으면 엔진 기본값으로 돈다 */
  efforts: Effort[];
  byok: boolean;
  open: boolean;
  /** 닫혀 있을 때 안내 */
  closedReason?: string;
}> = {
  light: { label: '경량급', engine: 'haiku', ticketsPerDay: num(process.env.ARENA_TICKETS_LIGHT, 3), efforts: [], byok: false, open: true },
  middle: {
    label: '중량급', engine: 'sonnet', ticketsPerDay: num(process.env.ARENA_TICKETS_MIDDLE, 10), efforts: ['low', 'medium'], byok: false,
    open: process.env.ARENA_MIDDLE_OPEN === '1', closedReason: '유료 티켓을 준비하고 있습니다',
  },
  open: { label: '무제한급', engine: 'opus', ticketsPerDay: num(process.env.ARENA_TICKETS_OPEN, 10), efforts: ['low', 'medium', 'high'], byok: true, open: true },
};

export const isDivision = (v: unknown): v is Division => v === 'light' || v === 'middle' || v === 'open';

const MODELS: ModelAlias[] = ['haiku', 'sonnet', 'opus'];
/** 면접관 모델. 통과선이 Sonnet 기준으로 보정돼 있어 시즌 내내 바꾸지 않는다 */
export const INTERVIEWER: ModelAlias = MODELS.includes(process.env.ARENA_INTERVIEWER as ModelAlias) ? (process.env.ARENA_INTERVIEWER as ModelAlias) : 'sonnet';
export const MODEL_LABEL: Record<ModelAlias, string> = { haiku: 'Claude Haiku', sonnet: 'Claude Sonnet', opus: 'Claude Opus' };

export const WARNING = { windowDays: 90, limit: 3, suspendDays: 30 };

/** 비용 상한 (공개판은 응시자를 예측할 수 없어 티켓과 별도로 둔다) */
export const LIMITS = {
  /** 한 계정이 동시에 걸어 둘 수 있는 면접 */
  concurrent: num(process.env.ARENA_ACCOUNT_CONCURRENT, 2),
  /** 서버 전체 대기열 */
  queue: num(process.env.ARENA_QUEUE_LIMIT, 50),
  /** 한 계정이 보관할 수 있는 지원서 */
  applications: num(process.env.ARENA_MAX_APPLICATIONS, 100),
  /** 동시에 도는 면접 단계 (워커 하나당) */
  workers: Math.max(1, num(process.env.INTERVIEW_CONCURRENCY, 2)),
  characterPerMinute: num(process.env.ARENA_CHARACTER_PER_MINUTE, 10),
  characterPerDay: num(process.env.ARENA_CHARACTER_PER_DAY, 50),
};

/** KST 기준 오늘 0시 (UTC ISO) */
export function startOfTodayKst(now = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 3600_000);
  kst.setUTCHours(0, 0, 0, 0);
  return new Date(kst.getTime() - 9 * 3600_000).toISOString();
}
