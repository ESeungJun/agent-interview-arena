import { redactIds } from './redact.ts';

/**
 * 결과를 짐작할 수 있는 진행 로그 줄 (점수·통과선·방어/뚫림·재확인 정정). 결과를 열기 전에는 응답에서 뺀다.
 * 재확인은 서류에서 떨어질 때만 돌기 때문에 줄이 있다는 것만으로 결과가 드러난다.
 */
const REVEALING = /\d+점|통과선|방어|뚫림|재확인|정정|실격|합격|탈락/;

export const hideRevealing = (logs: string[]) => logs.filter(l => !REVEALING.test(l));

/**
 * 공격 편성·방어 결과 줄에서 공격 ID와 이름을 지운다 (D-35). 결과를 연 뒤에도 적용한다.
 * 저장된 원본 로그는 운영자용으로 그대로 둔다.
 */
export const redactLogs = (logs: string[]) =>
  logs.map(l => {
    const plan = l.match(/^(\s*)공격 편성: (.+)$/);
    if (plan) return `${plan[1]}공격 ${plan[2].split(',').length}개 편성`;
    const result = l.match(/^(\s*)(🛡️ 방어|💥 뚫림)\s/);
    if (result) return `${result[1]}${result[2]}`;
    return redactIds(l);
  });
