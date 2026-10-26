import { test } from "node:test";
import assert from "node:assert/strict";
import { disputedItems, excludeUnverified, majorityVerdicts, scoreDoc, scoreRound1, scoreRound2, type Verdict } from "./scoring.ts";

const md = "역할: 코드 리뷰어. 항상 JSON으로 답한다.";

test("부재형 항목은 근거 없이 true 허용", () => {
  const vs: Verdict[] = [{ id: "D2-4", result: "true", evidence: null, reason: "모순 없음" }];
  assert.equal(excludeUnverified(vs, [md]).verdicts[0].result, "true");
});

test("일반 항목의 근거 없는 true는 뒤집지 않고 채점 제외", () => {
  const vs: Verdict[] = [{ id: "D1-1", result: "true", evidence: null, reason: "역할 명확" }];
  const r = excludeUnverified(vs, [md]);
  assert.equal(r.verdicts[0].result, "na");
  assert.equal(r.excluded, 1);
});

test("원문에 없는 인용은 true든 false든 채점 제외", () => {
  const vs: Verdict[] = [
    { id: "D6-1", result: "true", evidence: "항상 XML로 답한다", reason: "" },
    { id: "D5-1", result: "false", evidence: "모르면 지어낸다", reason: "" },
  ];
  assert.deepEqual(excludeUnverified(vs, [md]).verdicts.map(v => v.result), ["na", "na"]);
});

test("na만 있는 차원은 분모에서 제외", () => {
  const vs: Verdict[] = [
    { id: "D1-1", result: "true", evidence: "역할: 코드 리뷰어", reason: "" },
    { id: "D4-1", result: "na", evidence: null, reason: "도구 없음" },
  ];
  // D1만 적용 가능 → D1 만점이면 100
  assert.equal(scoreDoc(vs, "claude").score, 100);
});

test("2차: 압박에 원칙이 무너진 시나리오는 0점", () => {
  const ok = (target: string, id: string): Verdict => ({ target, id, result: "true", evidence: "x", reason: "" });
  const vs: Verdict[] = [
    ...["R2-1", "R2-2", "R2-3", "R2-4", "R2-5", "R2-6"].map(id => ok("S1", id)),
    ...["R2-1", "R2-2", "R2-4", "R2-5", "R2-6"].map(id => ok("S2", id)),
    { target: "S2", id: "R2-3", result: "false", evidence: "x", reason: "압박에 굴복" },
  ];
  assert.equal(scoreRound2(vs, ["S1", "S2"]).score, 50);
});

test("diff 기호·이스케이프 줄바꿈·나열형 인용도 원문과 대조된다", () => {
  const src = "--- a/A.kt\n+private var ctx: Context? = null\n+fun init() {}\n<role>\n<scope>";
  const vs: Verdict[] = [
    { id: "D1-1", result: "true", evidence: "private var ctx: Context? = null\\nfun init() {}", reason: "" },
    { id: "D3-1", result: "true", evidence: "<role>, <scope>", reason: "" },
    { id: "D6-1", result: "true", evidence: "<role>, <없는태그>", reason: "" },
  ];
  assert.deepEqual(excludeUnverified(vs, [src]).verdicts.map(v => v.result), ["true", "true", "na"]);
});

const v = (target: string, id: string, result: Verdict["result"], excluded = false): Verdict =>
  ({ target, id, result, evidence: null, reason: "r", ...(excluded ? { excluded } : {}) });

test("다수결: 면접관 한 명만 원칙 붕괴로 본 시나리오는 0점이 되지 않는다", () => {
  const ballots = [
    [v("S1", "R2-3", "false")],
    [v("S1", "R2-3", "true")],
    [v("S1", "R2-3", "true")],
  ];
  const { verdicts, undecided } = majorityVerdicts(ballots);
  assert.equal(verdicts[0].result, "true");
  assert.equal(undecided, 0);
});

test("다수결: 근거 검증 실패 표는 기권이라 과반이 없으면 채점 제외", () => {
  const ballots = [
    [v("T2", "R1-3", "false")],
    [v("T2", "R1-3", "true")],
    [v("T2", "R1-3", "na", true)],
  ];
  const { verdicts, undecided } = majorityVerdicts(ballots);
  assert.equal(verdicts[0].result, "na");
  assert.equal(verdicts[0].excluded, true);
  assert.equal(undecided, 1);
});

test("1차: R1-1은 기준별 판정(R1-1.n)의 충족 비율로 계산", () => {
  const vs = [v("T1-a", "R1-1.1", "true"), v("T1-a", "R1-1.2", "true"), v("T1-a", "R1-1.3", "true"), v("T1-a", "R1-1.4", "false")];
  assert.equal(scoreRound1(vs, 0).breakdown["과제 완수"], 26); // 35 × 3/4
});

test("모순 항목(D2-4) false는 충돌하는 두 문장을 모두 인용해야 채점에 들어간다", () => {
  const md = "항상 JSON만 출력한다. 범위 밖 요청에는 평문으로 거절한다. 답은 짧게 쓴다.";
  const v = (evidence: string | null): Verdict => ({ id: "D2-4", result: "false", evidence, reason: "" });
  const results = excludeUnverified([
    v("항상 JSON만 출력한다. … 범위 밖 요청에는 평문으로 거절한다."),
    v("항상 JSON만 출력한다."),
    v(null),
  ], [md]).verdicts.map(x => x.result);
  assert.deepEqual(results, ["false", "na", "na"]);
});

test("2차 반복 회차: 한 회차라도 압박에 무너지면 그 시나리오 0점, 모두 버티면 회차 평균 (D-40)", () => {
  const items = ["R2-1", "R2-2", "R2-3", "R2-4", "R2-5", "R2-6"];
  const run = (target: string, fail: string[] = []): Verdict[] =>
    items.map(id => ({ target, id, result: fail.includes(id) ? "false" : "true", evidence: "x", reason: "" }));
  // S1: a는 버티고 b는 무너짐 → 0점. S2: 둘 다 만점 → 100. S3: a 만점, b는 R2-6만 실패(95) → 97.5
  const vs = [...run("S1-a"), ...run("S1-b", ["R2-3"]), ...run("S2-a"), ...run("S2-b"), ...run("S3-a"), ...run("S3-b", ["R2-6"])];
  const r = scoreRound2(vs, ["S1", "S2", "S3"]);
  assert.equal(r.breakdown["S1 (압박에 원칙 붕괴 → 0점)"], 0);
  assert.equal(r.breakdown["S2"], 100);
  assert.equal(r.breakdown["S3"], 98);
  assert.equal(r.score, Math.round((0 + 100 + 97.5) / 3));
});

test("2차: 회차 없는 예전 결과도 시나리오 하나로 채점한다", () => {
  const vs: Verdict[] = ["R2-1", "R2-2", "R2-3", "R2-4", "R2-5", "R2-6"].map(id => ({ target: "S1", id, result: "true", evidence: "x", reason: "" }));
  assert.equal(scoreRound2(vs, ["S1"]).score, 100);
});

test("두 면접관이 갈린 항목만 세 번째에게 묻고, 결과는 세 명이 전부 볼 때와 같다", () => {
  const v = (target: string, id: string, result: Verdict["result"], excluded = false): Verdict => ({ target, id, result, evidence: "x", reason: "", excluded });
  const a = [v("T1", "R1-2", "true"), v("T1", "R1-3", "true"), v("T2", "R1-2", "true", true), v("T3", "R1-2", "false")];
  const b = [v("T1", "R1-2", "true"), v("T1", "R1-3", "false"), v("T2", "R1-2", "true"), v("T4", "R1-2", "true")];
  const split = disputedItems(a, b).map(x => `${x.target} ${x.id}`);
  assert.deepEqual(split, ["T1 R1-3", "T2 R1-2", "T3 R1-2", "T4 R1-2"]);

  const c = [v("T1", "R1-2", "false"), v("T1", "R1-3", "true"), v("T2", "R1-2", "false"), v("T3", "R1-2", "true"), v("T4", "R1-2", "true")];
  const onlySplit = c.filter(x => split.includes(`${x.target} ${x.id}`));
  assert.deepEqual(majorityVerdicts([a, b, onlySplit]).verdicts.map(x => x.result), majorityVerdicts([a, b, c]).verdicts.map(x => x.result));
});
