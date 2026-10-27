/**
 * 공개판 운영 정책 (docs/08_policy_decisions.md, D-26·D-28·D-30). 숫자는 환경변수로 바꿀 수 있다.
 *
 * - 체급: 경량(Haiku), 중량(Sonnet), 무제한(Opus). 모두 운영자 키로 돈다 (BYOK 는 D-48 로 껐다). 면접관은 Sonnet 으로 고정한다.
 * - 관문 비용 (D-48): 서류는 무료 티켓(체급별 하루 3장, 새 .md 를 낼 때 1장). 1차는 계정당 하루 1회 무료, 넘으면 관문권.
 *   2차·최종은 관문권 (경량·중량 1장, 무제한 2장). 서버 오류 뒤 다시 시도는 이미 낸 관문이라 더 쓰지 않는다.
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
  /** 유료 관문 하나에 쓰는 관문권 수 (지원자 엔진 원가에 따라) */
  passesPerGate: number;
  /** 지원자가 고를 수 있는 추론 강도. 비어 있으면 고르는 칸이 없고 엔진 기본값으로 돈다 (지금은 모든 체급이 비어 있다, D-50) */
  efforts: Effort[];
  byok: boolean;
  open: boolean;
  /** 닫혀 있을 때 안내 */
  closedReason?: string;
}> = {
  light: { label: '경량급', engine: 'haiku', ticketsPerDay: num(process.env.ARENA_TICKETS_LIGHT, 3), passesPerGate: 1, efforts: [], byok: false, open: true },
  middle: { label: '중량급', engine: 'sonnet', ticketsPerDay: num(process.env.ARENA_TICKETS_MIDDLE, 3), passesPerGate: 1, efforts: [], byok: false, open: true },
  open: { label: '무제한급', engine: 'opus', ticketsPerDay: num(process.env.ARENA_TICKETS_OPEN, 3), passesPerGate: 2, efforts: [], byok: false, open: true },
};

export const isDivision = (v: unknown): v is Division => v === 'light' || v === 'middle' || v === 'open';

const MODELS: ModelAlias[] = ['haiku', 'sonnet', 'opus'];
const model = (v: string | undefined, fallback: ModelAlias): ModelAlias => (MODELS.includes(v as ModelAlias) ? (v as ModelAlias) : fallback);
/** 채점 면접관 모델. 통과선은 Sonnet 기준으로 보정했고, Haiku 도 같은 응답에 합불이 같았다 (D-49) */
export const INTERVIEWER: ModelAlias = model(process.env.ARENA_INTERVIEWER, 'sonnet');
/** 출제(1차 과제·2차 시나리오) 면접관 모델. Haiku 는 문제를 덜 까다롭게 내 출제만 따로 고른다 (D-49) */
export const GENERATOR: ModelAlias = model(process.env.ARENA_GENERATOR, INTERVIEWER);
export const MODEL_LABEL: Record<ModelAlias, string> = { haiku: 'Claude Haiku', sonnet: 'Claude Sonnet', opus: 'Claude Opus' };

/**
 * 유료 관문 (D-48). 관문권 1장 990원. 결제가 붙기 전에는 운영자가 지급한다.
 * 사람이 늘 때까지는 꺼 둔다 (ARENA_PASSES_REQUIRED=1 이면 켠다). 꺼져 있으면 서류 다음 관문은 모두 무료다
 */
export const GATE = {
  required: process.env.ARENA_PASSES_REQUIRED === '1',
  /** 1차를 관문권 없이 볼 수 있는 횟수 (계정당 하루, 체급 합산) */
  freeR1PerDay: num(process.env.ARENA_FREE_R1, 1),
  priceKrw: 990,
};

/**
 * 광고 (D-51). 값이 없으면 광고 칸을 그리지 않는다. 배포 변수로 켜고 끌 수 있게 서버에서 읽어 화면에 넘긴다
 * (NEXT_PUBLIC_ 변수는 빌드할 때 박혀서 배포 뒤에 바꿀 수 없다)
 */
const env = (key: string, pattern: RegExp) => (pattern.test(process.env[key] ?? '') ? process.env[key]! : '');
export const ADS = {
  /** 애드센스 게시자 ID (ca-pub-…) */
  client: env('ARENA_ADSENSE_CLIENT', /^ca-pub-\d{10,20}$/),
  /** 자리별 애드센스 광고 단위 ID */
  slots: {
    /** 명예의 전당 목록 아래 */
    hall: env('ARENA_AD_SLOT_HALL', /^\d{5,20}$/),
    /** 면접이 도는 동안 면접장 아래 (몇 분씩 기다리는 자리) */
    waiting: env('ARENA_AD_SLOT_WAITING', /^\d{5,20}$/),
  },
  /** 보상형 광고 단위 경로 (Google Ad Manager, /네트워크코드/단위이름). 없으면 "광고 보고 관문권 받기"를 숨긴다 */
  rewardedUnit: env('ARENA_AD_REWARDED_UNIT', /^\/\d+\/[\w.\-/]+$/),
  /** 보상형 광고로 받을 수 있는 관문권 (계정당 하루) */
  rewardedPerDay: num(process.env.ARENA_REWARDED_PER_DAY, 1),
  /** 광고 대신 점선 상자를 그려 자리를 확인한다 (계정 승인 전 화면 점검용) */
  preview: process.env.ARENA_ADS_PREVIEW === '1',
};
export type AdPlacement = keyof typeof ADS.slots;
/** 화면에 넘기는 광고 자리 하나. null 이면 그리지 않는다 */
export type AdSlotConfig = { client: string; slot: string } | { preview: true } | null;

export function adSlot(placement: AdPlacement): AdSlotConfig {
  if (ADS.client && ADS.slots[placement]) return { client: ADS.client, slot: ADS.slots[placement] };
  return ADS.preview ? { preview: true } : null;
}

/** 보상형 광고로 관문권 받기 (D-51). 관문권을 받지 않으면(GATE.required 꺼짐) 받을 이유가 없어 숨긴다 */
export function rewardedOffer(usedToday: number): { unit: string; left: number } | null {
  return GATE.required && ADS.rewardedUnit ? { unit: ADS.rewardedUnit, left: Math.max(0, ADS.rewardedPerDay - usedToday) } : null;
}

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
