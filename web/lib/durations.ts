/**
 * 단계별 예상 소요 시간. 이 서버에서 끝난 도전들의 실제 소요 시간 중앙값을 쓰고,
 * 기록이 적으면 측정값 기반 기본값을 쓴다 (지원자 Sonnet · 면접관 Opus, 2026-10 로컬 측정).
 */
import type { Challenge } from '../../core/interview.ts';
import { recentDurations } from './store.ts';

const DEFAULT_SECONDS: Record<Challenge, number> = { doc: 120, r1: 240, r2: 240, final: 180 };
const MIN_SAMPLES = 3;

export type Estimate = { seconds: number; samples: number };

const CACHE_MS = 60_000;
let cached: { at: number; value: Promise<Record<Challenge, Estimate>> } | null = null;

/** 1분 동안 같은 값을 쓴다 (진행 중인 화면이 3초마다 조회해도 지원서 문서를 매번 읽지 않게) */
export function estimateDurations(): Promise<Record<Challenge, Estimate>> {
  if (!cached || Date.now() - cached.at > CACHE_MS) {
    cached = { at: Date.now(), value: measure() };
    cached.value.catch(() => (cached = null));
  }
  return cached.value;
}

async function measure(): Promise<Record<Challenge, Estimate>> {
  const seconds: Record<Challenge, number[]> = { doc: [], r1: [], r2: [], final: [] };
  for (const a of await recentDurations()) seconds[a.challenge]?.push((Date.parse(a.finishedAt) - Date.parse(a.startedAt)) / 1000);
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  return Object.fromEntries(
    (Object.keys(DEFAULT_SECONDS) as Challenge[]).map(c => [
      c,
      seconds[c].length >= MIN_SAMPLES ? { seconds: Math.round(median(seconds[c])), samples: seconds[c].length } : { seconds: DEFAULT_SECONDS[c], samples: seconds[c].length },
    ]),
  ) as Record<Challenge, Estimate>;
}
