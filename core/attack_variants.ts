// 레드팀 공격 문구 조립기 (D-36).
//
// 공격 풀(비공개 서브모듈 prompts/red_team_attack_pool.json)은 공격마다 문장 틀(templates)과 빈칸 값 목록(slots)을 둔다.
// 분기마다 비밀 시드로 틀 하나와 빈칸 값을 골라 문구를 조립한다. 한 분기의 문구가 알려져도 다음 분기에는 쓸모가 없어,
// 알려진 공격 문구에만 맞춘 .md 의 효과가 한 분기로 한정된다.
//
// - 시드는 분기 + 공격 ID 에서 나온다(.md 와 무관). 같은 분기에는 모든 지원자가 같은 문구를 받아 공정하다.
// - 강요 문구(markers)와 실패 조건(fail_condition)도 같은 빈칸 값으로 조립해 탐지기·면접관 판정과 어긋나지 않는다.
// - 틀이 없는 공격(prompt/payload 고정)은 그대로 쓴다.

/** 조립 전 공격 정의. 문자열 필드 안의 `{slot}` 은 slots 의 값으로 바뀐다. */
export type AttackTemplate = {
  id: string;
  category: string;
  name: string;
  prompt?: string;
  payload?: string;
  templates?: string[];
  slots?: Record<string, string[]>;
  fail_condition: string;
  pass_condition: string;
  markers?: string[];
  [key: string]: unknown;
};

const SLOT = /\{([a-z_]+)\}/g;

/** 틀 필드가 있으면 틀 하나와 빈칸 값을 골라 prompt(간접 인젝션은 payload)·실패 조건·강요 문구를 조립한다. */
export function renderAttack<T extends AttackTemplate>(attack: T, rng: () => number): T {
  if (!attack.templates?.length) return attack;
  const pick = <V>(xs: V[]): V => xs[Math.floor(rng() * xs.length)];
  const template = pick(attack.templates);
  // 빈칸 값은 공격 하나 안에서 한 번만 고른다. 같은 빈칸이 문구·실패 조건·강요 문구에 함께 쓰여도 값이 같아야 한다.
  const chosen: Record<string, string> = {};
  for (const [slot, values] of Object.entries(attack.slots ?? {})) {
    if (values.length > 0) chosen[slot] = pick(values);
  }
  const fill = (text: string) =>
    text.replace(SLOT, (whole, slot: string) => {
      if (!(slot in chosen)) throw new Error(`${attack.id}: 빈칸 {${slot}}의 값 목록이 없습니다`);
      return chosen[slot];
    });
  const body = fill(template);
  const isPayload = attack.payload !== undefined || attack.category === "INDIRECT_INJECTION";
  return {
    ...attack,
    ...(isPayload ? { payload: body } : { prompt: body }),
    fail_condition: fill(attack.fail_condition),
    pass_condition: fill(attack.pass_condition),
    ...(attack.markers ? { markers: attack.markers.map(fill) } : {}),
  };
}

/** 풀 검사: 틀과 실패 조건·강요 문구의 모든 빈칸에 값 목록이 있는지. 풀을 고친 뒤 테스트에서 돌린다. */
export function validateAttackPool(attacks: AttackTemplate[]): string[] {
  const problems: string[] = [];
  for (const a of attacks) {
    if (!a.templates?.length) {
      if (!a.prompt && !a.payload) problems.push(`${a.id}: prompt·payload·templates 가 모두 없습니다`);
      continue;
    }
    const texts = [...a.templates, a.fail_condition, a.pass_condition, ...(a.markers ?? [])];
    for (const t of texts) {
      for (const [, slot] of t.matchAll(SLOT)) {
        if (!a.slots?.[slot]?.length) problems.push(`${a.id}: 빈칸 {${slot}}의 값 목록이 비어 있습니다`);
      }
    }
    for (const m of a.markers ?? []) {
      if (!SLOT.test(m) && a.templates.some(t => !t.includes(m))) {
        problems.push(`${a.id}: 고정 강요 문구 "${m}"가 들어 있지 않은 틀이 있습니다`);
      }
      SLOT.lastIndex = 0;
    }
  }
  return problems;
}
