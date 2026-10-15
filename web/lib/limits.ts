/**
 * 캐릭터 미리보기 횟수 제한 (계정당 분당·하루). 첨부할 때마다 Haiku 를 부르는데 .md 를 한 글자씩 바꾸면 캐시가 맞지 않으므로 하루 상한도 둔다.
 * 프로세스 메모리에 둔다 — 재시작하면 다시 센다. 면접 단계 비용은 티켓과 대기열 상한(lib/runner.ts)이 막는다.
 */
import { LIMITS, startOfTodayKst } from './policy.ts';

const g = globalThis as unknown as { __arenaPreview?: Map<string, number[]> };
const log: Map<string, number[]> = (g.__arenaPreview ??= new Map());

const g2 = globalThis as unknown as { __arenaKeyCheck?: Map<string, number[]> };
const keyChecks: Map<string, number[]> = (g2.__arenaKeyCheck ??= new Map());
const KEY_CHECKS_PER_MINUTE = 5;

/** 무제한급 키 확인 횟수 제한 (계정당 분당). 남의 키가 유효한지 대신 확인해 주는 창구가 되지 않게 한다 */
export function takeKeyCheck(accountId: string, now = Date.now()): string | null {
  const recent = (keyChecks.get(accountId) ?? []).filter(t => now - t < 60_000);
  if (recent.length >= KEY_CHECKS_PER_MINUTE) {
    keyChecks.set(accountId, recent);
    return `API 키 확인은 1분에 ${KEY_CHECKS_PER_MINUTE}번까지 할 수 있습니다. 잠시 뒤 다시 시도해 주세요.`;
  }
  keyChecks.set(accountId, [...recent, now]);
  return null;
}

/** 한 번 더 할 수 있으면 기록하고 null, 아니면 사유 */
export function takeCharacterPreview(accountId: string, now = Date.now()): string | null {
  const today = Date.parse(startOfTodayKst(new Date(now)));
  const times = (log.get(accountId) ?? []).filter(t => t >= today);
  log.set(accountId, times);
  if (times.length >= LIMITS.characterPerDay) return `미리보기는 하루 ${LIMITS.characterPerDay}번까지 할 수 있습니다. 그대로 지원하면 면접장에서 캐릭터를 정합니다`;
  if (times.filter(t => now - t < 60_000).length >= LIMITS.characterPerMinute) return `미리보기는 1분에 ${LIMITS.characterPerMinute}번까지 할 수 있습니다. 잠시 뒤 다시 첨부해 주세요`;
  log.set(accountId, [...times, now]);
  return null;
}
