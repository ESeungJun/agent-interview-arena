/**
 * 체급별 리더보드 (docs/08 4·5번).
 * - 에이전트(계정 + 이름)별 최고 기록을 남긴다. 다시 도전해서 떨어져도 기록이 내려가지 않는다.
 * - 순위: 도달 단계 → 2차 점수 → 1차 점수 → 서류 점수 → 먼저 달성한 시각.
 * - 응시자가 결과 통지서를 연 단계만 센다 (연출보다 순위가 먼저 결과를 알려 주지 않게). 보안 실격된 버전과 휴지통의 지원서는 뺀다.
 * 시즌 1 규모에서는 요청마다 계산한다. 응시자가 늘면 기록 표를 따로 두고 결과가 날 때 갱신한다.
 */
import { CHALLENGES, type Challenge } from '../../core/interview.ts';
import { getDb } from './db.ts';
import type { Division } from './policy.ts';
import { securityBanOf } from './runner.ts';
import { listByDivision } from './store.ts';

export type Entry = {
  rank: number;
  agentName: string;
  owner: string;
  character: { job: string; tone: string } | null;
  reached: Challenge;
  scores: { doc: number | null; r1: number | null; r2: number | null };
  achievedAt: string;
  version: number;
};

const ORDER: Record<Challenge, number> = { doc: 1, r1: 2, r2: 3, final: 4 };

function compare(a: Omit<Entry, 'rank'>, b: Omit<Entry, 'rank'>): number {
  return (
    ORDER[b.reached] - ORDER[a.reached] ||
    (b.scores.r2 ?? -1) - (a.scores.r2 ?? -1) ||
    (b.scores.r1 ?? -1) - (a.scores.r1 ?? -1) ||
    (b.scores.doc ?? -1) - (a.scores.doc ?? -1) ||
    a.achievedAt.localeCompare(b.achievedAt)
  );
}

const CACHE_MS = 30_000;
const cache = new Map<Division, { at: number; value: Promise<Entry[]> }>();

/** 30초 동안 같은 순위를 쓴다 (로그인 없이 부를 수 있어 요청마다 계산하면 부하가 커진다) */
export function leaderboard(division: Division, opts: { fresh?: boolean; limit?: number } = {}): Promise<Entry[]> {
  const limit = opts.limit ?? 100;
  const hit = cache.get(division);
  if (!opts.fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = compute(division, limit);
  cache.set(division, { at: Date.now(), value });
  value.catch(() => cache.delete(division));
  return value;
}

async function compute(division: Division, limit: number): Promise<Entry[]> {
  const apps = (await listByDivision(division)).filter(a => !a.trashedAt);
  const owners = [...new Set(apps.map(a => a.ownerId))];
  const names = new Map(
    owners.length === 0 ? [] : (await (await getDb()).query<{ id: string; display_name: string }>('select id, display_name from accounts where id = any($1)', [owners])).map(r => [r.id, r.display_name]),
  );
  const best = new Map<string, Omit<Entry, 'rank'>>();
  for (const app of apps) {
    for (const v of app.versions) {
      if (securityBanOf(v.results)) continue;
      let reached: Challenge | null = null;
      for (const c of CHALLENGES) {
        const a = v.attempts[c];
        if (!a?.revealedAt || !a.passed) break;
        reached = c;
      }
      if (!reached) continue;
      const entry = {
        agentName: app.agentName.replace(/\.md$/, ''),
        owner: names.get(app.ownerId) ?? '익명',
        character: app.character ? { job: app.character.job, tone: app.character.tone } : null,
        reached,
        scores: {
          doc: v.results.doc?.score ?? null,
          r1: v.results.r1?.score ?? null,
          r2: v.results.r2?.score ?? null,
        },
        achievedAt: v.attempts[reached]!.finishedAt ?? v.createdAt,
        version: v.n,
      };
      const key = `${app.ownerId}\u0000${app.agentName}`;
      const prev = best.get(key);
      if (!prev || compare(entry, prev) < 0) best.set(key, entry);
    }
  }
  return [...best.values()].sort(compare).slice(0, limit).map((e, i) => ({ ...e, rank: i + 1 }));
}
