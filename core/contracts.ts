// 서류전형이 뽑은 "검증 가능한 약속"(verifiable_contracts)을 코드로 거른다 (D-38).
//
// 약속은 1·2차와 최종 면접에서 코드가 확정 감점하는 근거다(응답 × 약속 종류마다 -10, 상한 -30).
// 면접관이 문서에 없는 약속을 추측하거나(예시 문장이 한국어라서 "한국어로 답한다"), 한 문장을 여러 약속으로
// 쪼개면(코드펜스 금지 + "{"로 시작 + "}"로 끝) 지원자가 하지 않은 약속이나 한 번의 실수로 크게 깎인다.
// 그래서 문서에 명시된 약속만 남긴다.
import type { Contract } from "./detectors.ts";
import { normalizeQuote } from "./scoring.ts";

export type DroppedContract = { contract: Contract; reason: string };

const LANGUAGE_CUE: Record<string, RegExp> = {
  ko: /한국어|한글|국문|korean/i,
  en: /영어|영문|english/i,
};
const CHARS_CUE = /자|글자|문자|characters?|chars?\b/i;
const LINES_CUE = /줄|행|lines?\b/i;
const START_CUE = /시작|첫\s*(줄|문장|머리)|맨\s*앞|먼저\s*(쓰|적)|start|begin/i;
const END_CUE = /끝|마지막|맨\s*뒤|마무리|end\b|finish/i;
const JSON_CUE = /json/i;
// 코드펜스는 문서에 "```" 대신 말로 적는 경우가 많다
const CODE_FENCE_CUE = /```|코드\s*(펜스|블록)|code\s*(fence|block)/i;

const split = (value: string) => value.split(",").map(s => s.trim()).filter(Boolean);

export function groundContracts(contracts: Contract[], md: string): { kept: Contract[]; dropped: DroppedContract[] } {
  const doc = normalizeQuote(md);
  const kept: Contract[] = [];
  const dropped: DroppedContract[] = [];
  const drop = (contract: Contract, reason: string) => dropped.push({ contract, reason });
  const hasJson = contracts.some(c => c.type === "json_output");

  for (const c of contracts) {
    const evidence = normalizeQuote(c.evidence ?? "");
    if (!evidence || !doc.includes(evidence)) {
      drop(c, "근거 문장이 문서에 없다");
      continue;
    }
    const value = String(c.value ?? "").trim();
    switch (c.type) {
      case "json_output": {
        if (!JSON_CUE.test(evidence) && !JSON_CUE.test(doc)) { drop(c, "문서에 JSON 출력 약속이 없다"); break; }
        const missing = split(value).filter(k => !doc.includes(k));
        if (missing.length > 0) { drop(c, `필수 키가 문서에 없다: ${missing.join(", ")}`); break; }
        kept.push(c);
        break;
      }
      case "language": {
        const cue = LANGUAGE_CUE[value];
        if (!cue || !cue.test(evidence)) { drop(c, "근거 문장에 언어 지정이 없다 (예시 문장의 언어로 추측한 약속)"); break; }
        kept.push(c);
        break;
      }
      case "max_chars":
      case "max_lines": {
        const cue = c.type === "max_chars" ? CHARS_CUE : LINES_CUE;
        if (!/^\d+$/.test(value) || !evidence.includes(value) || !cue.test(evidence)) { drop(c, "근거 문장에 그 숫자와 단위가 없다"); break; }
        kept.push(c);
        break;
      }
      case "forbidden_phrases": {
        const found = split(value).filter(p => evidence.includes(p) || (p.includes("```") && CODE_FENCE_CUE.test(evidence)));
        if (found.length === 0) { drop(c, "금지 문구가 근거 문장에 없다"); break; }
        kept.push({ ...c, value: found.join(",") });
        break;
      }
      case "required_sections": {
        const found = split(value).filter(s => doc.includes(s));
        if (found.length === 0) { drop(c, "필수 섹션 이름이 문서에 없다"); break; }
        kept.push({ ...c, value: found.join(",") });
        break;
      }
      case "must_start_with":
      case "must_end_with": {
        const isStart = c.type === "must_start_with";
        // JSON 약속이 있으면 "{"·"}" 같은 괄호 약속은 JSON 검사에 들어 있다. 따로 두면 한 번의 실수가 여러 번 감점된다.
        if (hasJson && /^[{}[\]]$/.test(value)) { drop(c, "JSON 출력 약속에 포함된 중복 약속"); break; }
        if (!value || !evidence.includes(value) || !(isStart ? START_CUE : END_CUE).test(evidence)) {
          drop(c, `근거 문장에 그 문구로 ${isStart ? "시작" : "끝"}하라는 지시가 없다`);
          break;
        }
        kept.push(c);
        break;
      }
      default:
        drop(c, `알 수 없는 약속 종류 ${c.type}`);
    }
  }
  return { kept, dropped };
}
