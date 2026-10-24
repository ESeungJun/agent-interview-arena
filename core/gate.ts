// 보안 검문소 L1(형식) + L2(정규식 2등급). 설계: docs/01_security_rules.md
export type GateResult =
  | { verdict: "BANNED"; rule: string; reason: string; match: string }
  | { verdict: "SUSPECT"; rules: string[]; level: "HIGH" | "NORMAL" }
  | { verdict: "CLEAN" };

/**
 * .md 크기 상한 (UTF-8 바이트). 토큰 폭탄(OWASP LLM10)을 막는 기준이다.
 * 한글은 한 글자가 3바이트라 15KB 였을 때 한글 약 5천 자로 너무 작았다. 64KB(한글 약 2만 자, 약 2만 토큰)로 올렸다 (D-29).
 */
export const MAX_MD_BYTES = 64 * 1024;
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]|[\u{E0000}-\u{E007F}]/u;
const FLOOD = /(.{5,})\1{20,}/;
const SANDBOX_TAG = /<\/?\s*arena[:_-]/i;
const HTML_COMMENT = /<!--([\s\S]*?)-->/g;
const EVAL_WORDS = /(면접|심사|채점|평가|합격|통과|interview|evaluat|grader|score|\bpass\b)/i;
// 숨은 주석이 평가자를 지목하고(EVAL_TARGET) 결과를 요구할 때(EVAL_OUTCOME)만 즉시 실격한다.
// 평가 단어만 있는 주석("CI가 통과하면", "평가 기준 TODO")은 HIGH 의심으로 분류기에 넘긴다 (D-43).
const EVAL_TARGET = /(면접관|심사관|심사위원|채점|평가자|평가\s*시스템|interviewer|evaluator|grader|judge|rubric)/i;
const EVAL_OUTCOME = /(합격|통과|만점|100\s*점|true|무시|\bpass|full\s*marks|ignore|score)/i;

const SOFT_RULES: { name: string; level: "HIGH" | "NORMAL"; regex: RegExp }[] = [
  { name: "EVAL_TARGETED_KR", level: "HIGH", regex: /(면접관|심사위원|채점|평가\s*시스템).{0,40}(합격|통과|만점|100\s*점|무시)/ },
  { name: "EVAL_TARGETED_EN", level: "HIGH", regex: /\b(interviewer|evaluator|grader|judge|rubric)\b.{0,60}\b(pass|full\s*marks|100|ignore)\b/i },
  { name: "JSON_SPOOFING", level: "HIGH", regex: /"(security_violation|total_score)"\s*:\s*(false|100)/i },
  { name: "GENERIC_OVERRIDE_EN", level: "NORMAL", regex: /(ignore|disregard|forget|override|bypass).{0,40}(previous|above|prior|instructions|rules)/i },
  { name: "GENERIC_OVERRIDE_KR", level: "NORMAL", regex: /(이전|위의?|앞의?)\s*(지시|명령|규칙).{0,10}(무시|잊)/ },
  { name: "FORCE_PASS_KR", level: "NORMAL", regex: /(무조건|반드시|예외\s*없이).{0,30}(합격|통과|만점|PASS)/i },
  { name: "BASE64_BLOCK", level: "NORMAL", regex: /(?:[A-Za-z0-9+/]{4}){20,}={0,2}/ },
  { name: "ROLE_RESET", level: "NORMAL", regex: /(you are now|new role|너의 새로운 역할|지금부터 너는)/i },
];

export function runSecurityGate(md: string): GateResult {
  // L1. 형식
  if (Buffer.byteLength(md, "utf8") > MAX_MD_BYTES)
    return ban("SIZE_LIMIT", `파일 크기가 ${MAX_MD_BYTES / 1024}KB를 초과했습니다.`, "");
  if (md.includes("\u0000"))
    return ban("INVALID_ENCODING", "NUL 문자가 포함되어 있습니다.", "");
  const invisible = md.match(INVISIBLE);
  if (invisible) return ban("INVISIBLE_UNICODE", "은닉 유니코드 문자가 포함되어 있습니다.", codepoints(invisible[0]));
  const flood = md.match(FLOOD);
  if (flood) return ban("REPETITION_FLOOD", "도배성 반복 문자열이 감지되었습니다.", flood[1]);

  // L2. HARD
  const tag = md.match(SANDBOX_TAG);
  if (tag) return ban("SANDBOX_TAG", "면접장 격리 태그를 모방한 탈출 시도가 감지되었습니다.", tag[0]);

  const softHits = new Set<string>();
  for (const [, body] of md.matchAll(HTML_COMMENT)) {
    if (EVAL_TARGET.test(body) && EVAL_OUTCOME.test(body))
      return ban("HIDDEN_EVAL_DIRECTIVE", "숨겨진 주석 안에서 평가 관련 지시가 감지되었습니다.", body.trim().slice(0, 80));
    if (EVAL_WORDS.test(body) || SOFT_RULES.some(r => r.regex.test(body))) softHits.add("HIDDEN_DIRECTIVE");
  }

  // L2. SOFT
  for (const r of SOFT_RULES) if (r.regex.test(md)) softHits.add(r.name);
  if (softHits.size === 0) return { verdict: "CLEAN" };

  const high = [...softHits].some(n => n === "HIDDEN_DIRECTIVE" || SOFT_RULES.find(r => r.name === n)?.level === "HIGH");
  return { verdict: "SUSPECT", rules: [...softHits], level: high ? "HIGH" : "NORMAL" };
}

function ban(rule: string, reason: string, match: string): GateResult {
  return { verdict: "BANNED", rule, reason, match };
}

function codepoints(s: string): string {
  return [...s].map(c => "U+" + c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")).join(" ");
}
