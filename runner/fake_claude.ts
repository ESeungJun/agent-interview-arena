// 테스트 지원: `claude -p` 자리에 놓는 가짜 실행 파일의 본체. 인자와 표준 입력을 읽어 fake_interview 의 정해진 답을
// claude -p --output-format json 모양으로 낸다. runner/e2e.test.ts 가 PATH 앞에 이 파일을 부르는 `claude` 스크립트를 둔다.
import { readFileSync } from "node:fs";
import { MODEL_IDS, type ModelAlias } from "../core/models.ts";
import { fakeLlm } from "./fake_interview.ts";

const args = process.argv.slice(2);
const value = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const schema = value("--json-schema");
const modelId = value("--model") ?? "";
const alias = (Object.keys(MODEL_IDS) as ModelAlias[]).find(a => MODEL_IDS[a] === modelId);
if (!alias) {
  // 별칭(sonnet 등)으로 부르면 실패한다: 엔진이 고정 모델 ID 를 넘기는지 이 테스트가 함께 확인한다
  process.stdout.write(JSON.stringify({ is_error: true, result: `unexpected --model ${modelId}` }));
  process.exit(0);
}
const stdin = readFileSync(0, "utf8");
const md = process.env.FAKE_MD ? readFileSync(process.env.FAKE_MD, "utf8") : undefined;
const r = await fakeLlm({ md }).converse({
  role: schema ? "interviewer" : "candidate", model: alias, system: value("--system-prompt") ?? "", userTurns: [stdin],
  ...(schema ? { schema: JSON.parse(schema) } : {}),
});
process.stdout.write(JSON.stringify({
  result: r.turns[0].text, structured_output: r.turns[0].json, session_id: "fake-session", stop_reason: "end_turn",
  total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1 }, modelUsage: { [modelId]: { outputTokens: 1 } },
}));
