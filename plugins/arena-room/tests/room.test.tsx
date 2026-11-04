import { expect, mock, test } from 'claude-code/testing'

import { reduceRoom } from '../hooks/register.tsx'

const PANE = {
  plugin: 'arena-room',
  component: 'Pane',
  requestId: 'arena-room',
  props: {
    title: 'Interview room',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const line = (e: Record<string, unknown>) => JSON.stringify({ ts: '2026-11-03T08:50:00.000Z', session: '2026-11-03-aaaa1111', agent: 'reviewer.md', ...e })

const LOG = [
  line({ event: 'stage_start', stage: 'doc', mode: 'quick' }),
  line({ event: 'log', stage: 'doc', message: 'anything' }),
  line({ event: 'stage_end', stage: 'doc', passed: true, score: 95, banned: false }),
  line({ event: 'stage_start', stage: 'r1', mode: 'quick' }),
  '{"broken json',
].join('\n')

test('the log of the last session becomes the room', async () => {
  const room = reduceRoom(LOG, 'en')
  expect(room?.agent).toBe('reviewer.md')
  expect(room?.mode).toBe('quick')
  expect(room?.current).toBe('r1')
  expect(room?.results.doc?.score).toBe(95)
  expect(room?.results.security?.passed).toBe(true)
  expect(room?.finished).toBe(false)
})

test('only the newest session counts, and the end is read', async () => {
  const older = line({ event: 'stage_end', stage: 'doc', passed: false, score: 10, banned: false })
  const newer = [
    JSON.stringify({ ts: '2026-11-03T09:00:00.000Z', event: 'stage_end', session: '2026-11-03-bbbb2222', agent: 'b.md', stage: 'final', passed: true, score: null, banned: false }),
    JSON.stringify({ ts: '2026-11-03T09:00:00.000Z', event: 'session_end', session: '2026-11-03-bbbb2222', agent: 'b.md', hired: true }),
  ].join('\n')
  const room = reduceRoom(`${older}\n${newer}`, 'ko')
  expect(room?.session).toBe('2026-11-03-bbbb2222')
  expect(room?.results.doc).toBe(undefined)
  expect(room?.finished).toBe(true)
  expect(room?.hired).toBe(true)
  expect(room?.lang).toBe('ko')
})

test('an empty log has no room', async () => {
  expect(reduceRoom('', 'en')).toBe(null)
})

test('the pane shows the idle hint before any interview, on every surface', async ($, on) => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const hint = await ui.find({ type: 'Text', text: /arena:apply/ })
    expect(hint?.text).toContain('/arena:apply')
    await ui.unmount()
  }
})

test('a new round opens the pane, pins the status and toasts the result', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-11-03T08:50:30.000Z') })
  mock.env(on, { HOME: '/home/me' })
  let log = ''
  let mtime = 1
  const toasts: string[] = []
  const statuses: (string | undefined)[] = []
  const opened: string[] = []
  on('command.register', () => ({ value: { command: 'arena-room' } }))
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', (_, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('fs.stat', (_, e) => {
    // 처음엔 기록 파일이 없다 (처음 쓰는 사용자의 첫 면접)
    if (e.path !== '/home/me/.agent-interview-arena/live.jsonl' || log === '') throw new Error('ENOENT')
    return { value: { kind: 'file', size: log.length, mtimeMs: mtime, isLink: false } }
  })
  on('fs.read', (_, e) => {
    if (e.path.endsWith('config.json')) return { value: '{"lang":"en"}' }
    return { value: log }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(600)
  expect(opened.length).toBe(0)

  log = [
    line({ event: 'stage_start', stage: 'doc', mode: 'ranked' }),
    line({ event: 'stage_end', stage: 'doc', passed: true, score: 95, banned: false }),
    line({ event: 'stage_start', stage: 'r1', mode: 'ranked' }),
  ].join('\n')
  mtime = 2
  await clock.advance(600)

  expect(opened).toEqual(['arena-room'])
  expect(toasts).toEqual(['✅ Document passed · 95'])
  expect(statuses.at(-1)).toBe('🎤 Arena · Round 1 · interviewing 0:31')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /Round 1/ }))?.text).toContain('interviewing')
  expect((await ui.find({ type: 'Text', text: /Document/ }))?.text).toContain('95')
  await ui.unmount()

  // 같은 밀리초에 이어 쓴 줄(크기만 바뀜)도 읽고, 단계가 끝나면 상태줄을 내린다
  log += '\n' + line({ event: 'stage_end', stage: 'r1', passed: true, score: 80, banned: false })
  await clock.advance(600)
  expect(toasts.at(-1)).toBe('✅ Round 1 passed · 80')
  expect(statuses.at(-1)).toBe(undefined)

  // 다음 단계가 시작된 뒤 15분 넘게 기록이 없으면 엔진이 멈춘 것으로 보고 상태줄을 내린다
  log += '\n' + line({ event: 'stage_start', stage: 'r2', mode: 'ranked' })
  mtime = 3
  await clock.advance(600)
  expect(statuses.at(-1)).toContain('Round 2')
  await clock.advance(16 * 60 * 1000)
  expect(statuses.at(-1)).toBe(undefined)
})

test('control characters from the log never reach the screen', async () => {
  const room = reduceRoom(line({ event: 'error', agent: 'x\u001b]52;c;Zm9v\u0007.md', message: 'bad\u001b[2J' }), 'en')
  expect(room?.agent).toBe('x]52;c;Zm9v.md')
  expect(room?.error).toBe('bad[2J')
  expect(reduceRoom(JSON.stringify({ event: 'stage_start', session: '../../etc', stage: 'doc' }), 'en')).toBe(null)
})
