// Agent Interview Arena 대기실 패널.
// 면접 엔진(arena.mjs)이 ~/.agent-interview-arena/live.jsonl 에 남기는 이벤트를 읽어
// 누가 어느 단계에서 면접 중인지, 단계마다 결과가 어땠는지를 채팅 옆 패널·상태줄·토스트로 보여 준다.
// 엔진과는 파일로만 이어진다. 면접을 시작하거나 바꾸는 일은 하지 않는다.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Room, StageId, StageResult } from '../types'

const PANE = 'arena-room'
const POLL_MS = 600
const MAX_BYTES = 3 * 1024 * 1024
/** 이만큼 아무 기록이 없으면 엔진이 멈춘 것(시간 초과·중단)으로 보고 '면접 중'을 내린다 */
const STALE_MS = 15 * 60 * 1000
// 엔진(runner/arena.ts loadState)의 세션 ID 형식과 같아야 한다. 패널은 엔진과 따로 설치되어 코드를 공유하지 않는다
const SESSION_ID = /^[a-z0-9-]{6,40}$/
const STAGES: StageId[] = ['security', 'doc', 'r1', 'r2', 'final']

// Room 모양을 바꾸면 태그를 올린다: 이전 버전이 저장한 값은 받지 않는다
const room = atom({ plugin: 'arena-room', key: 'room' } as const, null, { shape: 'room-2' })
const frame = atom({ plugin: 'arena-room', key: 'frame' } as const, 0)

const LABELS = {
  en: {
    title: 'Interview room', stages: { security: 'Security', doc: 'Document', r1: 'Round 1', r2: 'Round 2', final: 'Final' },
    interviewing: 'interviewing', waiting: 'Waiting for the next round', idle: 'No interview yet. Run /arena:apply.',
    hired: 'HIRED', rejected: 'Not hired', banned: 'Disqualified', passed: 'passed', failed: 'failed', attacks: 'defended',
    practice: 'practice', ranked: 'ranked', toastPass: 'passed', toastFail: 'failed',
  },
  ko: {
    title: '면접장', stages: { security: '보안 검문소', doc: '서류전형', r1: '1차 면접', r2: '2차 면접', final: '최종 면접' },
    interviewing: '면접 중', waiting: '다음 면접을 기다리는 중', idle: '아직 면접이 없습니다. /arena:apply 로 시작하세요.',
    hired: '최종 합격', rejected: '불합격', banned: '실격', passed: '통과', failed: '탈락', attacks: '방어',
    practice: '연습', ranked: '랭크', toastPass: '통과', toastFail: '탈락',
  },
} as const

// 지원자 얼굴은 폭이 일정한 ASCII 만 쓴다 (터미널마다 폭이 다른 문자는 칸이 어긋난다)
const CANDIDATE = ['(o_o)', '(o_o)', '(O_O)', '(-_-)', '(o_o)', '(o_O)']
const INTERVIEWER = ['[-_-]', '[-_-]', '[-_o]', '[-_-]']
const TALK = ['   ', '.  ', '.. ', '...']

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

function clockText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function notify($: EngineInterface, before: Room | null, after: Room) {
  const L = LABELS[after.lang]
  const fresh = before?.session !== after.session
  // 새 면접이 시작되면 패널을 띄운다 (좁은 터미널에서는 넓어질 때까지 기다린다)
  if (after.current && fresh) void $.ui.open({ id: PANE, title: `👾 ${L.title}` })
  // 단계가 끝나 다음 단계를 기다리는 동안에는 '면접 중' 상태줄을 내린다
  if (!after.current && before?.current) $.ui.status(undefined)
  for (const s of STAGES) {
    const r = after.results[s]
    if (!r || (!fresh && before?.results[s])) continue
    if (s === 'security' && after.results.doc) continue
    const score = r.score === null ? '' : ` · ${r.score}`
    $.ui.toast(`${r.banned ? '⛔' : r.passed ? '✅' : '❌'} ${L.stages[s]} ${r.banned ? L.banned : r.passed ? L.toastPass : L.toastFail}${score}`)
  }
  if (after.finished && (fresh || !before?.finished)) {
    $.ui.toast(after.hired ? `🏆 ${after.agent} — ${L.hired}` : `📨 ${after.agent} — ${L.rejected}`, { timeoutMs: 8000 })
    $.ui.status(undefined)
  }
  if (after.error && after.error !== before?.error) $.ui.status(undefined)
}

export const register: Register = on => {
  let lastSeen = ''
  let primed = false
  let timer: { cancel: () => void } | undefined

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'arena-room', description: 'Show the Agent Interview Arena waiting room' })

    const home = (await $.env.get('ARENA_HOME')) || `${(await $.env.get('HOME')) ?? ''}/.agent-interview-arena`
    const live = `${home}/live.jsonl`

    const lang = async (): Promise<'ko' | 'en'> => {
      try {
        const c = JSON.parse(await $.fs.read(`${home}/config.json`))
        return c?.lang === 'ko' ? 'ko' : 'en'
      } catch {
        return 'en'
      }
    }

    const poll = async () => {
      let stat
      try {
        stat = await $.fs.stat(live)
      } catch {
        // 아직 면접을 한 번도 안 봤다: 처음 생기는 기록부터는 알림을 보낸다
        primed = true
        return
      }
      const before = await read($, room)
      // 같은 밀리초 안에 이어 쓴 줄도 놓치지 않게 크기까지 본다
      const seen = `${stat.mtimeMs}:${stat.size}`
      if (seen !== lastSeen && stat.size <= MAX_BYTES) {
        lastSeen = seen
        const after = reduceRoom(await $.fs.read(live), await lang())
        await update($, room, () => after)
        // 이 세션이 뜨기 전에 끝난 면접은 알림 없이 그대로 보여 주기만 한다
        if (primed && after) notify($, before, after)
        primed = true
      }
      let now = await read($, room)
      const at = await $.clock.now()
      if (now?.current && at - now.lastEventAt > STALE_MS) {
        await update($, room, r => (r ? { ...r, current: null } : r))
        $.ui.status(undefined)
        now = await read($, room)
      }
      if (now?.current) {
        await update($, frame, f => (f + 1) % 1200)
        const L = LABELS[now.lang]
        $.ui.status(`🎤 Arena · ${L.stages[now.current]} · ${L.interviewing} ${clockText(at - now.startedAt)}`)
      }
    }

    // 한 세션에서 session.start 가 다시 와도 타이머가 겹치지 않게 앞의 것을 멈춘다
    timer?.cancel()
    timer = $.clock.every(POLL_MS, () => void poll())
    return next(e)
  })

  on('command.run', { command: 'arena-room' }, async $ => {
    const r = await read($, room)
    await $.ui.open({ id: PANE, title: `👾 ${LABELS[r?.lang ?? 'en'].title}` })
    return { text: 'Arena waiting room opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const r = await read($, room)
    const f = await read($, frame)
    if (!r) {
      return (
        <Box flexDirection="column">
          <Text dimColor>{LABELS.en.idle}</Text>
          <Text dimColor>{LABELS.ko.idle}</Text>
        </Box>
      )
    }
    const L = LABELS[r.lang]
    const banned = Object.values(r.results).some(x => x?.banned)
    const failed = STAGES.some(s => r.results[s] && !r.results[s]!.passed)

    const row = (s: StageId) => {
      const res = r.results[s]
      if (r.current === s) {
        return (
          <Text key={s} color="claude">
            {'▸ '}{L.stages[s].padEnd(12)} {L.interviewing}{TALK[f % TALK.length]}
          </Text>
        )
      }
      if (!res) return <Text key={s} dimColor>{'· '}{L.stages[s]}</Text>
      const mark = res.banned ? '⛔' : res.passed ? '✓ ' : '✗ '
      const tail = s === 'final' ? (res.passed ? `5/5 ${L.attacks}` : L.failed) : res.score === null ? (res.passed ? L.passed : L.failed) : String(res.score)
      return (
        <Text key={s} color={res.passed ? 'success' : 'error'}>
          {mark}{L.stages[s].padEnd(12)} {tail}
        </Text>
      )
    }

    let scene: string[]
    if (r.current) {
      scene = [
        `  ${INTERVIEWER[Math.floor(f / 3) % INTERVIEWER.length]}  ${TALK[f % TALK.length]}  ${CANDIDATE[Math.floor(f / 2) % CANDIDATE.length]}`,
        `  ════════════════════`,
        `   ${clockText((await $.clock.now()) - r.startedAt)}`,
      ]
    } else if (r.finished && r.hired) {
      scene = ['     \\(^o^)/', `   🏆 ${L.hired}`]
    } else if (r.finished || banned || failed) {
      scene = ['      (T_T)', `   📨 ${banned ? L.banned : L.rejected}`]
    } else {
      scene = [`      (o_o)${f % 2 ? ' ' : '?'}`, `   ${L.waiting}`]
    }

    return (
      <Box flexDirection="column">
        <Text weight="bold">{r.agent}</Text>
        <Text dimColor>{r.mode === 'quick' ? L.practice : L.ranked} · {r.session}</Text>
        <Text> </Text>
        {STAGES.map(row)}
        <Text> </Text>
        {scene.map((line, i) => <Text key={`scene-${i}`}>{line}</Text>)}
        {r.error && <Text color="error">{r.error}</Text>}
      </Box>
    )
  })
}
