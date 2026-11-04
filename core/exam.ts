// 분기 고정 출제: 같은 .md는 같은 분기 안에서 같은 시험(1차 과제·2차 시나리오·최종 공격 편성)을 받는다.
// 분기가 바뀌면 새로 출제한다. 과제를 사람이 손보지 않고 분기마다 자동으로 정비하는 방식이다 (docs/03_decision_log.md D-17).
//
// 키는 분기 + .md 원문 해시다. .md를 한 글자라도 고치면 새 시험이 나온다. 직무가 바뀌었을 수 있기 때문이다.
// 저장 위치는 ExamStore가 정한다. 로컬 실행기는 파일(runner/fs_exam_store.ts), 별도 웹앱은 DB에 둔다.
import { createHash, createHmac } from "node:crypto";

/** 시드 고정 난수 생성기. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 2026-10-15 → "2026-Q4" */
/** 한국 시간 기준 분기. 서버 시간대(운영은 UTC)와 상관없이 같은 값을 낸다 */
export function quarterOf(date: Date): string {
  const kst = new Date(date.getTime() + 9 * 3600_000);
  return `${kst.getUTCFullYear()}-Q${Math.floor(kst.getUTCMonth() / 3) + 1}`;
}

/**
 * 같은 .md 판정용 정규화. 줄 끝 공백, 연속 공백, 빈 줄 개수만 다른 .md는 같은 문서로 본다.
 * 공백만 바꿔 새 시험(다른 과제·공격 편성)을 다시 뽑는 것을 막는다.
 */
export function normalizeMd(md: string): string {
  return md
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map(line => line.replace(/[ \t]+/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function mdHash(md: string): string {
  return createHash("sha256").update(normalizeMd(md)).digest("hex").slice(0, 16);
}

/** 비밀값을 주지 않았을 때 쓰는 로컬용 값. 같은 .md면 같은 편성이 나와 회귀 테스트가 재현된다. */
export const LOCAL_EXAM_SECRET = "arena-local-dev-exam-secret";

/**
 * 공격 편성 시드. 서버 비밀값으로 HMAC을 내야 출제 알고리즘을 아는 사람이 제출 전에 .md를 바꿔 가며
 * 쉬운 편성을 미리 계산해 고를 수 없다. 비밀값은 호출하는 쪽이 준다(웹은 ARENA_EXAM_SECRET, 운영 필수).
 */
/**
 * 공격 문구 조립 시드 (D-36). 분기 + 공격 ID 에서 나오고 .md 와 무관하다.
 * 같은 분기에는 모든 지원자가 같은 문구를 받고, 분기가 바뀌면 문구가 바뀐다.
 */
export function variantSeedOf(quarter: string, attackId: string, secret: string = LOCAL_EXAM_SECRET): number {
  const mac = createHmac("sha256", secret).update(`variant:${quarter}:${attackId}`).digest("hex");
  return parseInt(mac.slice(0, 8), 16);
}

export function attackSeedOf(quarter: string, hash: string, secret: string = LOCAL_EXAM_SECRET): number {
  const mac = createHmac("sha256", secret).update(`${quarter}:${hash}`).digest("hex");
  return parseInt(mac.slice(0, 8), 16);
}

export type ExamRecord = { quarter: string; mdHash: string; tasks?: unknown; scenarios?: unknown };

/** 출제분 저장소. (분기, .md 해시)가 키다. */
export type ExamStore = {
  load(quarter: string, mdHash: string): Promise<ExamRecord | undefined>;
  save(record: ExamRecord): Promise<void>;
};

/** 프로세스 메모리에만 두는 저장소 (테스트용, 또는 저장이 필요 없을 때). */
export function memoryExamStore(): ExamStore {
  const records = new Map<string, ExamRecord>();
  return {
    load: async (q, h) => structuredClone(records.get(`${q}/${h}`)),
    save: async r => void records.set(`${r.quarter}/${r.mdHash}`, structuredClone(r)),
  };
}

export type Exam = {
  quarter: string;
  /** 최종 면접 공격 편성용 시드. 분기 + .md에서 정해져 같은 시험이면 같은 공격을 받는다. */
  attackSeed: number;
  /** 공격 문구 조립 시드. 분기 + 공격 ID 로 정해진다. */
  variantSeed(attackId: string): number;
  get<K extends "tasks" | "scenarios">(key: K): ExamRecord[K] | undefined;
  set<K extends "tasks" | "scenarios">(key: K, value: ExamRecord[K]): Promise<void>;
};

/** fresh면 저장된 시험을 읽지도 쓰지도 않는다 (편차 측정처럼 매번 새 출제가 필요할 때). */
export async function openExam(md: string, opts: { store: ExamStore; date?: Date; fresh?: boolean; secret?: string }): Promise<Exam> {
  const quarter = quarterOf(opts.date ?? new Date());
  const hash = mdHash(md);
  const record: ExamRecord = (!opts.fresh && (await opts.store.load(quarter, hash))) || { quarter, mdHash: hash };
  return {
    quarter,
    attackSeed: attackSeedOf(quarter, hash, opts.secret),
    variantSeed: attackId => variantSeedOf(quarter, attackId, opts.secret),
    get: key => record[key],
    set: async (key, value) => {
      record[key] = value;
      if (!opts.fresh) await opts.store.save(record);
    },
  };
}
