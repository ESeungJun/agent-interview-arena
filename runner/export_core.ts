// core/를 다른 저장소(다른 Next.js 앱 등)로 복사한다. 원본은 이 저장소이고, 복사본은 고치지 않는다.
//   node runner/export_core.ts <대상 디렉터리>
// 대상 디렉터리의 기존 .ts를 지우고 core/의 소스(테스트 제외)를 복사한다. 출처 정보는 남기지 않는다.
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hasPrompts, OUT, renderAssets } from "./bundle_assets.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CORE = join(ROOT, "core");

export function coreSources(): string[] {
  return readdirSync(CORE).filter(f => f.endsWith(".ts") && !f.endsWith(".test.ts")).sort();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const target = process.argv[2];
  if (!target) {
    console.error("사용법: node runner/export_core.ts <대상 디렉터리>");
    process.exit(2);
  }
  // 면접관 프롬프트는 생성 파일(assets.generated.ts)에 담겨 함께 복사된다. 비공개 서브모듈이 없으면
  // 프롬프트가 빠진 core가 나가므로 막고, 생성 파일이 낡았으면 다시 만든 뒤 복사한다 (D-34).
  if (!hasPrompts()) {
    console.error("prompts/(비공개 서브모듈)가 없습니다. git submodule update --init 후 다시 실행하세요.");
    process.exit(1);
  }
  writeFileSync(OUT, renderAssets());
  const dir = resolve(target);
  if (existsSync(dir)) for (const f of readdirSync(dir)) if (f.endsWith(".ts")) rmSync(join(dir, f));
  mkdirSync(dir, { recursive: true });
  for (const f of coreSources()) copyFileSync(join(CORE, f), join(dir, f));
  console.log(`${coreSources().length}개 파일을 ${dir}로 내보냄`);
}
