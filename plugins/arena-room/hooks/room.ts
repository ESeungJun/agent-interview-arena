// 대기실 패널의 순수 부분: live.jsonl 텍스트를 방 상태로 바꾼다.
// claude-code 모듈에 기대지 않아 node --test 로도 돌릴 수 있다 (runner/room.test.ts, CI 에서 실행).
import type { Room, StageId, StageResult } from '../types/index.d.ts'

// 엔진(runner/arena.ts loadState)의 세션 ID 형식과 같아야 한다. 패널은 엔진과 따로 설치되어 코드를 공유하지 않는다
const SESSION_ID = /^[a-z0-9-]{6,40}$/
export const STAGES: StageId[] = ['security', 'doc', 'r1', 'r2', 'final']

type Event = {
  ts?: string; event?: string; session?: string; agent?: string; stage?: string; mode?: string
  passed?: boolean; score?: number | null; banned?: boolean; hired?: boolean; message?: string
}

const isStage = (s: unknown): s is StageId => typeof s === 'string' && (STAGES as string[]).includes(s)

/** 파일 이름·오류 문장은 기록 파일에서 온 값이다. 터미널 제어 문자를 지운다 */
const clean = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').slice(0, max)

/** live.jsonl 의 마지막 세션만 골라 방 상태를 만든다. 깨진 줄은 건너뛴다. */
export function reduceRoom(text: string, lang: 'ko' | 'en'): Room | null {
  const events: Event[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const e = JSON.parse(line)
      if (e && typeof e === 'object') events.push(e as Event)
    } catch {
      // 쓰는 도중의 줄은 다음 번에 다시 읽는다
    }
  }
  const last = [...events].reverse().find(e => typeof e.session === 'string' && SESSION_ID.test(e.session))
  if (!last?.session) return null
  const mine = events.filter(e => e.session === last.session || (e.event === 'error' && !e.session))
  const r: Room = {
    session: last.session, agent: '', mode: 'ranked', lang, current: null, startedAt: 0,
    results: {}, finished: false, hired: false, error: null, lastEventAt: 0,
  }
  for (const e of mine) {
    if (typeof e.agent === 'string') r.agent = clean(e.agent, 60)
    r.lastEventAt = Math.max(r.lastEventAt, Date.parse(e.ts ?? '') || 0)
    if (e.event === 'stage_start' && isStage(e.stage)) {
      r.current = e.stage
      r.startedAt = Date.parse(e.ts ?? '') || 0
      if (typeof e.mode === 'string') r.mode = e.mode
      r.error = null
    } else if (e.event === 'stage_end' && isStage(e.stage)) {
      const result: StageResult = { passed: !!e.passed, score: typeof e.score === 'number' ? e.score : null, banned: !!e.banned }
      r.results[e.stage] = result
      // 서류전형 한 번에 보안 검문소까지 함께 돈다
      if (e.stage === 'doc' && !r.results.security) r.results.security = { passed: !e.banned, score: null, banned: !!e.banned }
      r.current = null
    } else if (e.event === 'session_end') {
      r.finished = true
      r.hired = !!e.hired
      r.current = null
    } else if (e.event === 'error') {
      r.error = clean(e.message, 120)
      r.current = null
    }
  }
  return r
}
