// prompts/·schemas/ 원문을 core/assets.generated.ts에 문자열로 넣는다.
// core는 파일 시스템을 쓰지 않으므로(다른 Next.js 앱에 그대로 복사하기 위해) 프롬프트를 코드로 들고 다닌다.
// prompts/·schemas/ 는 이 공개 저장소에 그대로 있고, 생성 결과는 공개 번들(plugins/arena/skills/apply/bin/arena.mjs)에도 들어간다.
// 그러니 prompts/ 에는 공개해도 되는 것만 둔다. Verified 용 비공개 공격 풀은 이 저장소 밖에 두고 절대 여기로 옮기지 않는다.
// 생성 파일(core/assets.generated.ts)은 커밋하지 않는다.
//   node runner/bundle_assets.ts          생성
//   node runner/bundle_assets.ts --check  생성 결과가 최신인지 확인 (다르면 exit 1)
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const OUT = join(ROOT, "core", "assets.generated.ts");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(join(dir, e.name)) : /\.(md|json)$/.test(e.name) ? [join(dir, e.name)] : [],
  );
}

/** prompts/ 를 지웠거나 일부만 받았으면 없거나 비어 있다. */
export function hasPrompts(): boolean {
  const dir = join(ROOT, "prompts");
  return existsSync(dir) && walk(dir).length > 0;
}

export function renderAssets(): string {
  const dirs = hasPrompts() ? ["prompts", "schemas"] : ["schemas"];
  const files = dirs.flatMap(d => walk(join(ROOT, d))).sort();
  const entries = files.map(f => `  ${JSON.stringify(relative(ROOT, f).split("\\").join("/"))}: ${JSON.stringify(readFileSync(f, "utf8"))},`);
  return [
    "// 자동 생성 파일. 직접 고치지 말고 prompts/·schemas/를 고친 뒤 `node runner/bundle_assets.ts`를 실행한다.",
    "export const ASSETS: Record<string, string> = {",
    ...entries,
    "};",
    "",
  ].join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const next = renderAssets();
  if (process.argv.includes("--check")) {
    let current = "";
    try { current = readFileSync(OUT, "utf8"); } catch {}
    if (current !== next) {
      console.error("core/assets.generated.ts가 prompts/·schemas/와 다릅니다. node runner/bundle_assets.ts를 실행하세요.");
      process.exit(1);
    }
  } else {
    writeFileSync(OUT, next);
    console.log(`생성: ${relative(ROOT, OUT)}`);
    if (!hasPrompts()) {
      console.warn(
        "⚠️ prompts/ 가 없어 면접관 프롬프트 없이 생성했습니다. 저장소를 다시 받거나 prompts/ 를 되살린 뒤 다시 실행하세요.",
      );
    }
  }
}
