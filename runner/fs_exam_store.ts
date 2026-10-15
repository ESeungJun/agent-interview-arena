// 로컬 실행기의 출제분 저장소: exams/<분기>/<해시>.json (git 제외)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExamRecord, ExamStore } from "../core/exam.ts";

const DEFAULT_DIR = join(fileURLToPath(new URL("..", import.meta.url)), "exams");

export function fsExamStore(dir = DEFAULT_DIR): ExamStore {
  const file = (quarter: string, hash: string) => join(dir, quarter, `${hash}.json`);
  return {
    load: async (quarter, hash) => {
      const f = file(quarter, hash);
      return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as ExamRecord) : undefined;
    },
    save: async record => {
      const f = file(record.quarter, record.mdHash);
      mkdirSync(join(f, ".."), { recursive: true });
      writeFileSync(f, JSON.stringify(record, null, 2));
    },
  };
}
