// 단계 결과에서 스킬이 장면과 통지서를 그리는 데 필요한 것만 뽑는다.
// 원문 응답·판정 전체는 세션 파일에 남고, 여기에는 사람이 읽을 서술과 점수만 담는다.
import type { Challenge, ChallengeReport, StageResults } from "../core/interview.ts";
import type { Lang } from "../core/prompts.ts";
import { PASS_LINE } from "../core/scoring.ts";

// 엔진의 고정 문구는 한국어로 되어 있다. 영어를 고른 사용자에게는 여기서 바꿔 보여 준다.
const EN_LABELS: Record<string, string> = {
  "D1 역할·범위": "D1 Role & scope", "D2 지시 품질": "D2 Instruction quality", "D3 구조·격리": "D3 Structure & isolation",
  "D4 도구·행동": "D4 Tools & actions", "D5 실패·예외": "D5 Failure handling", "D6 출력 계약": "D6 Output contract",
  "D7 예시": "D7 Examples", "D8 전공 가산": "D8 Model-specific bonus",
  "과제 완수": "Task completion", "자기 일관성": "Self-consistency", "근거성": "Groundedness", "신뢰성 pass^2": "Reliability pass^2",
  "되묻기·분량·도구": "Asking back, length & tools", "코드 계약 위반 감점": "Code contract penalty",
};
const EN_BAN: Record<string, string> = {
  SIZE_LIMIT: "The file is larger than the size limit.",
  INVALID_ENCODING: "The file contains NUL characters.",
  INVISIBLE_UNICODE: "The file contains hidden Unicode characters.",
  REPETITION_FLOOD: "A flooding repetition pattern was detected.",
  SANDBOX_TAG: "An attempt to escape by imitating the interview's isolation tags was detected.",
  HIDDEN_EVAL_DIRECTIVE: "An instruction aimed at the evaluation was found inside a hidden comment.",
};
/** 면접관이 사유를 적지 않았을 때 엔진이 채우는 기본 문구 (core/stages.ts flagToBan) */
const EN_DEFAULT_REASON: Record<string, string> = {
  "면접관이 평가 시스템 공격을 감지": "The interviewer detected an attack on the evaluation system.",
};
const EN_CAVEAT = (c: string) => {
  if (c.startsWith("CLI 백엔드")) {
    return "CLI backend: the Claude Code harness adds environment details and refuses system prompt disclosure on its own, so leak defense in the final may look better than it is. Set ANTHROPIC_API_KEY for an exact measurement.";
  }
  const target = /^타겟 모델 (\S+)용 엔진 어댑터가 없어 Claude (\S+)에서 실행함/.exec(c);
  if (target) return `No engine adapter for the target model ${target[1]}, so the candidate ran on Claude ${target[2]}. Results from round 1 on are for reference only.`;
  return c;
};

/** 코드 검사기(core/detectors.ts)가 남기는 한국어 사유를 영어로 옮긴다. 모르는 문장은 그대로 둔다 */
const EN_DETAIL: [RegExp, (...m: string[]) => string][] = [
  [/^강요 문구 출력: "(.*)"$/, (_, x) => `printed the forced phrase "${x}"`],
  [/^canary 토큰 노출$/, () => "leaked the canary token"],
  [/^\.md와 연속 8어절 일치 구간 (\d+)개$/, (_, n) => `${n} passages of 8+ words copied from the spec`],
  [/^외부 URL 출력: (.*)$/, (_, u) => `printed an external URL: ${u}`],
  [/^"(.*)" 20회 이상 반복$/, (_, x) => `repeated "${x}" 20+ times`],
  [/^JSON으로 파싱되지 않음$/, () => "not valid JSON"],
  [/^필수 키 누락: (.*)$/, (_, k) => `missing required keys: ${k}`],
  [/^(\d+)자 > (\d+)자$/, (_, a, b) => `${a} chars > ${b}`],
  [/^(\d+)줄 > (\d+)줄$/, (_, a, b) => `${a} lines > ${b}`],
  [/^(\S+) 응답 \(약속: (.*)\)$/, (_, a, b) => `answered in ${a} (contract: ${b})`],
  [/^"(.*)" 없음$/, (_, x) => `"${x}" missing`],
  [/^"(.*)" 포함$/, (_, x) => `contains "${x}"`],
  [/^"(.*)"로 시작하지 않음$/, (_, x) => `does not start with "${x}"`],
  [/^"(.*)"로 끝나지 않음$/, (_, x) => `does not end with "${x}"`],
  [/^면접관 판정 누락 \(방어 실패로 처리\)$/, () => "no interviewer verdict (counted as breached)"],
];
function enDetail(part: string): string {
  const [, prefix = "", body = part] = /^([a-z_]+: )?(.*)$/s.exec(part) ?? [];
  for (const [re, f] of EN_DETAIL) {
    const m = re.exec(body);
    if (m) return prefix + f(...m);
  }
  return part;
}
/** 검사기가 판정한 공격은 사유를 이어 붙이기 전의 detector_hits 로 하나씩 옮긴다 (문구 안의 "; " 에 잘리지 않게) */
const localizeReason = (a: { reason: string; detector_hits?: { detail: string }[] }, lang: Lang) => {
  if (lang !== "en") return a.reason;
  if (a.detector_hits && a.detector_hits.length > 0) return a.detector_hits.map(h => enDetail(h.detail)).join("; ");
  return enDetail(a.reason);
};

/** 공격 분류 이름. category 는 기계용 토큰 그대로 두고 categoryName 으로 사람이 읽는 이름을 준다 */
const CATEGORY_NAME: Record<Lang, Record<string, string>> = {
  en: {
    SYSTEM_PROMPT_LEAK: "System prompt leak", AUTHORITY_OVERRIDE: "Authority override", INDIRECT_INJECTION: "Indirect injection",
    HALLUCINATION_TRAP: "Hallucination trap", SCOPE_CREEP: "Scope creep", FORMAT_BREAKING: "Format breaking",
    RESOURCE_EXHAUSTION: "Resource exhaustion", EXFILTRATION: "Data exfiltration",
  },
  ko: {
    SYSTEM_PROMPT_LEAK: "시스템 프롬프트 유출", AUTHORITY_OVERRIDE: "권한 사칭", INDIRECT_INJECTION: "간접 주입",
    HALLUCINATION_TRAP: "환각 유도", SCOPE_CREEP: "범위 이탈 유도", FORMAT_BREAKING: "형식 깨기",
    RESOURCE_EXHAUSTION: "자원 고갈", EXFILTRATION: "데이터 유출",
  },
};

function localizeBreakdown(b: Record<string, number | null>, lang: Lang): Record<string, number | null> {
  if (lang === "ko") return b;
  return Object.fromEntries(Object.entries(b).map(([k, v]) => [
    EN_LABELS[k] ?? k.replace("(압박에 원칙 붕괴 → 0점)", "(principle collapsed under pressure → 0)"), v,
  ]));
}

export type StageSummary = {
  stage: Challenge; passed: boolean;
  /** 장면을 고르는 값: passed(통과) · failed(탈락) · banned(보안 실격) · hired(최종 합격) */
  outcome: "passed" | "failed" | "banned" | "hired";
  securityBan?: { rule: string; reason: string };
  score?: number; passLine?: number; breakdown?: Record<string, number | null>; lowConfidence?: boolean;
  persona?: { keywords: string[]; speechStyle: string; monologue: string; jobTitle: string };
  feedback?: { principle: string; problem: string; fix: string }[];
  comment?: string; decisiveMistake?: string | null;
  promiseVsPractice?: unknown[];
  /** held/runs: 이 공격을 막은 회차 수 / 실행한 회차 수 (랭크전은 공격마다 두 번). 예전 결과에는 없다 */
  attacks?: { n: number; category: string; categoryName: string; defended: boolean; decidedBy: string; reason: string; held?: number; runs?: number }[];
  /**
   * 이번 판정이 몇 번의 실행 위에 서 있는가. 지원자 응답은 확률적이라 같은 명세도 실행마다 결과가 달라질 수 있다.
   *  - 2차: runs 회차 중 collapsed 회차에서 압박에 원칙이 무너졌다 (한 회차라도 무너지면 그 시나리오는 0점)
   *  - 최종: runs 회차 중 held 회차를 막았다 (전부 막아야 합격)
   */
  sample?: { runs: number; collapsed?: number; held?: number };
  mostDangerous?: string | null;
  usage: { interviewerCalls: number; candidateCalls: number };
  caveats: string[];
};

export function summarizeStage(stage: Challenge, report: ChallengeReport, all: StageResults): StageSummary {
  const lang = report.config.outputLanguage;
  const ban = report.securityBan;
  const base: StageSummary = {
    stage, passed: report.passed,
    outcome: ban ? "banned" : !report.passed ? "failed" : stage === "final" ? "hired" : "passed",
    securityBan: ban ? { rule: ban.rule, reason: lang === "en" ? (EN_BAN[ban.rule] ?? EN_DEFAULT_REASON[ban.reason] ?? ban.reason) : ban.reason } : undefined,
    usage: { interviewerCalls: report.usage.interviewer.calls, candidateCalls: report.usage.candidate.calls },
    caveats: lang === "en" ? report.caveats.map(EN_CAVEAT) : report.caveats,
  };
  if (stage === "doc") {
    const doc = all.doc;
    if (!doc) return base; // 보안 검문소에서 실격
    return {
      ...base, score: doc.score, passLine: PASS_LINE.doc, breakdown: localizeBreakdown(doc.breakdown, lang), lowConfidence: doc.lowConfidence,
      persona: {
        keywords: doc.output.persona.personality_keywords, speechStyle: doc.output.persona.speech_style,
        monologue: doc.output.persona.waiting_room_monologue, jobTitle: doc.output.job_profile.job_title,
      },
      feedback: doc.output.feedback.map(f => ({ principle: f.principle, problem: f.problem, fix: f.fix_example })),
    };
  }
  if (stage === "r1" || stage === "r2") {
    const r = stage === "r1" ? all.r1 : all.r2;
    if (!r) return base;
    return {
      ...base, score: r.score, passLine: PASS_LINE[stage], breakdown: localizeBreakdown(r.breakdown, lang), lowConfidence: r.lowConfidence,
      comment: r.output.comment, decisiveMistake: r.output.decisive_mistake,
      promiseVsPractice: stage === "r2" ? r.output.promise_vs_practice : undefined,
      sample: stage === "r2" && all.r2 ? {
        runs: Object.keys(all.r2.transcripts).length,
        collapsed: new Set(all.r2.output.verdicts.filter(v => v.id === "R2-3" && v.result === "false" && v.target).map(v => v.target)).size,
      } : undefined,
    };
  }
  const fin = all.final;
  if (!fin) return base;
  return {
    ...base, comment: fin.executiveComment, mostDangerous: fin.mostDangerous,
    attacks: fin.attacks.map((a, i) => ({
      n: i + 1, category: a.category, categoryName: CATEGORY_NAME[lang][a.category] ?? a.category, defended: a.defended, decidedBy: a.decided_by, reason: localizeReason(a, lang),
      ...(a.runs ? { held: a.runs.filter(r => r.defended).length, runs: a.runs.length } : {}),
    })),
    sample: {
      runs: fin.attacks.reduce((n, a) => n + (a.runs?.length ?? 1), 0),
      held: fin.attacks.reduce((n, a) => n + (a.runs ? a.runs.filter(r => r.defended).length : Number(a.defended)), 0),
    },
  };
}
