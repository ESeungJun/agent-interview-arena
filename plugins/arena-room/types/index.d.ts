export type StageId = 'security' | 'doc' | 'r1' | 'r2' | 'final'

export type StageResult = { passed: boolean; score: number | null; banned: boolean }

export type Room = {
  session: string
  agent: string
  mode: string
  lang: 'ko' | 'en'
  /** 지금 진행 중인 단계. 없으면 다음 단계를 기다리는 중 */
  current: StageId | null
  startedAt: number
  results: Partial<Record<StageId, StageResult>>
  finished: boolean
  hired: boolean
  error: string | null
  /** 마지막 기록 시각. 오래 조용하면 엔진이 멈춘 것으로 본다 */
  lastEventAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'arena-room': { room: Shaped<Room | null>; frame: number }
  }
}
