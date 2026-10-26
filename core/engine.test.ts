import { test } from "node:test";
import assert from "node:assert/strict";
import { costUsd } from "./engine.ts";

const usage = (input: number, output: number, write = 0, read = 0) =>
  ({ input_tokens: input, output_tokens: output, cache_creation_input_tokens: write, cache_read_input_tokens: read }) as never;

test("비용: 입력·출력·캐시 쓰기(1.25배)·캐시 읽기를 모델 가격으로 센다", () => {
  // Sonnet 5.5: 입력 $2, 출력 $10, 캐시 읽기 $0.2 (백만 토큰당)
  assert.equal(costUsd("claude-sonnet-5-5", usage(1_000_000, 100_000, 1_000_000, 1_000_000)), 2 + 1 + 2.5 + 0.2);
});

test("비용: Haiku 5.5는 프롬프트가 10만 토큰을 넘으면 비싼 가격", () => {
  assert.equal(costUsd("claude-haiku-5-5", usage(100_000, 0)), 0.01);
  assert.equal(costUsd("claude-haiku-5-5", usage(100_001, 0)), (100_001 * 0.5) / 1e6);
});

test("비용: 모르는 모델은 null (0으로 적지 않는다)", () => {
  assert.equal(costUsd("claude-unknown-1", usage(10, 10)), null);
  assert.ok(costUsd("claude-sonnet-5-5-20261001", usage(10, 10))! > 0);
});
