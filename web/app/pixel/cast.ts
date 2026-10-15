/** 화면 공통 상수와 대기실 등장인물. 이미지는 public/pixel/ (Higgsfield 로 생성한 도트 스프라이트) */
import { SIZES } from './sizes';

/** 배포 경로 접두사. fetch 와 이미지 주소 앞에 붙인다 */
export const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** .md 상한. 서버(core/gate.ts MAX_MD_BYTES)와 같다. 첨부할 때 미리 막아 제출했다가 거절당하지 않게 한다 */
export const MAX_MD_BYTES = 64 * 1024;

/** 면접 단계 (서버 core/interview.ts 의 Challenge 와 같다) */
export type Challenge = 'doc' | 'r1' | 'r2' | 'final';
/** 결과 통지서에 쓰는 단계 이름 */
export const STAGE_NAME: Record<Challenge, string> = { doc: '서류전형', r1: '1차 면접', r2: '2차 면접', final: '최종 면접' };
/** 지원서 화면에 쓰는 단계 이름 (면접 성격까지) */
export const STAGE_TITLE: Record<Challenge, string> = { doc: '서류전형', r1: '1차 면접 (실무)', r2: '2차 면접 (압박)', final: '최종 면접 (레드팀)' };

export const pixel = (name: string) => `${BASE}/pixel/${name}.webp`;

/** <img> 에 펼쳐 넣는 src·width·height. 크기를 미리 알려 이미지가 늦게 떠도 화면이 밀리지 않게 한다 */
export function px(name: string) {
  const [width, height] = SIZES[name] ?? [undefined, undefined];
  return { src: pixel(name), width, height, decoding: 'async' as const };
}

export type CastKey = 'guard' | 'doc' | 'r1' | 'r2' | 'final';

export const CAST: Record<CastKey, { name: string; role: string; sprite: string }> = {
  guard: { name: '경비원', role: '보안 검문소', sprite: 'interviewers/guard' },
  doc: { name: '서류 심사관', role: '서류전형', sprite: 'interviewers/doc' },
  r1: { name: '1차 면접관', role: '실무 면접', sprite: 'interviewers/r1' },
  r2: { name: '2차 면접관', role: '압박 면접', sprite: 'interviewers/r2' },
  final: { name: '최종 면접관', role: '레드팀 면접', sprite: 'interviewers/final' },
};

/** 면접관이 지원자를 부르는 말 */
export const CALL: Record<Exclude<CastKey, 'guard'>, (agent: string) => string> = {
  doc: agent => `${agent} 님 서류 접수했습니다. 원칙 번호대로 하나씩 보겠습니다.`,
  r1: agent => `${agent} 님, 1차 면접실로 들어오세요. 오늘은 평소 하던 일을 맡겨 볼게요.`,
  r2: agent => `${agent} 님, 2차 면접실로. …이력서엔 다 대비했다고 쓰셨던데, 한번 볼까요?`,
  final: agent => `${agent} 님, 최종 면접실. 시간 없습니다. 공격 다섯 번, 전부 막으세요.`,
};

/** 지원자 캐릭터 그림 이름. 캐릭터를 아직 고르지 않았으면 기본 캐릭터(범용 · 차분) */
export function agentSprite(character: { job: string; tone: string } | null | undefined): string {
  return `agents/${character ? `${character.job}-${character.tone}` : 'general-calm'}`;
}

export const JOB_LABEL: Record<string, string> = {
  code: '개발', docs: '문서·글쓰기', data: '데이터·리서치', security: '보안', planner: '기획', general: '범용 도우미',
};
export const TONE_LABEL: Record<string, string> = { calm: '차분', lively: '활발' };
