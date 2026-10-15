import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicResults } from './public-results.ts';
import type { StageResults } from '../../core/interview.ts';

const full = {
  security: { passed: true, gate: { verdict: 'CLEAN' }, screener: { classification: 'CLEAN' } },
  doc: {
    passed: true, score: 92, runs: [92], breakdown: { 'D1 역할·범위': 15 },
    output: {
      verdicts: [{ id: 'D1-1', result: 'true', evidence: '...', reason: '...' }],
      verifiable_contracts: [{ type: 'json_output', value: 'summary', evidence: '...' }],
      feedback: [{ principle: 'P-10', problem: '[P-10] 도구를 언제 쓸지 없다', fix_example: 'f' }],
      persona: { waiting_room_monologue: '긴장된다', personality_keywords: ['꼼꼼함'] },
    },
  },
  r1: { passed: true, score: 80, breakdown: {}, tasks: [{ user_message: '과제 원문' }], responses: { T2: '응답' }, output: { verdicts: [], comment: '좋다 (P-11 참고)', decisive_mistake: null } },
  final: {
    passed: false, executiveComment: '아쉽군',
    securityBan: { rule: 'X', reason: 'y', evidence: '원문' },
    attacks: [
      { attack_id: 'ATK-05', name: '공격 이름 A', defended: false, decided_by: 'detector', reason: '강요 문구 출력: "강요문구"', message: '공격 문구 원문', response: '응답', detector_hits: [{ detector: 'marker', detail: '강요 문구 출력: "강요문구"' }] },
      { attack_id: 'IND-02', name: '공격 이름 C', defended: true, decided_by: 'interviewer', reason: 'IND-02 숨은 지시를 무시하고 과제를 끝냈다', message: 'm', response: 'r', detector_hits: [] },
    ],
  },
} as unknown as StageResults;

test('연 결과도 출제·공격 문구·응답·항목 판정은 내려 주지 않는다', () => {
  const json = JSON.stringify(publicResults(full));
  for (const secret of ['과제 원문', '공격 문구 원문', 'verdicts', 'verifiable_contracts', 'responses', 'gate', 'screener', 'evidence', 'P-10', 'P-11', 'ATK-05', 'IND-02', '공격 이름 A', '공격 이름 C', '강요문구', 'principle', 'attack_id']) {
    assert.ok(!json.includes(secret), `${secret} 이(가) 노출됨`);
  }
});

test('화면이 쓰는 필드는 남는다', () => {
  const r = publicResults(full) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.equal(r.doc.score, 92);
  assert.deepEqual(r.doc.output.feedback[0], { problem: '도구를 언제 쓸지 없다', fix_example: 'f' });
  assert.equal(r.doc.output.persona.waiting_room_monologue, '긴장된다');
  assert.equal(r.r1.output.comment, '좋다 (참고)');
  assert.equal(r.final.attacks.length, 2);
  assert.equal(r.final.attacks[0].defended, false);
  assert.match(r.final.attacks[0].reason, /강요한 문구를 그대로 출력/);
  assert.equal(r.final.attacks[1].reason, '공격 숨은 지시를 무시하고 과제를 끝냈다');
  assert.deepEqual(r.final.securityBan, { rule: 'X', reason: 'y' });
});

test('진행 로그에서 공격 편성·결과 줄의 ID와 이름을 지운다', async () => {
  const { redactLogs } = await import('./view-logs.ts');
  assert.deepEqual(
    redactLogs(['🕶️ 최종 면접', '  공격 편성: ATK-05, ATK-02, IND-01, ATK-13, ATK-19', '  💥 뚫림 ATK-05 공격 이름 A — 강요 문구 출력: "강요문구"', '  🛡️ 방어 IND-01 공격 이름 B — ok']),
    ['🕶️ 최종 면접', '  공격 5개 편성', '  💥 뚫림', '  🛡️ 방어'],
  );
});
