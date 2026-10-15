# 🔓 공개 전환 절차 (Public Release)

이 저장소는 나중에 공개한다. 면접관 프롬프트와 레드팀 공격 풀은 계속 비공개로 둔다 (D-34).

## 무엇을 숨기고 무엇을 공개하나

| 구분 | 위치 | 공개 여부 | 이유 |
|---|---|---|---|
| 면접관 프롬프트 원문, 레드팀 공격 풀 | `prompts/` (서브모듈 → `agent-interview-arena-prompts`, 비공개) | 🔒 비공개 | 공격 문구·체크리스트 원문을 알면 거기에만 맞춘 `.md`로 점수를 올릴 수 있다 |
| 프롬프트 내장본 | `core/assets.generated.ts` | 🔒 커밋 안 함 | 프롬프트 원문이 그대로 들어 있다 |
| 채점 원칙·평가 방법론 | `docs/04`, `docs/05` 등 | 공개 | 채점 기준의 방향은 지원자에게 공개하는 것이 공정하다. 숨기는 것은 문구 원문이다 |
| 보안 게이트 정규식 | `core/gate.ts` | 공개 | 코드라 숨길 수 없다. 정규식은 1차 거름망일 뿐이고 웹은 모든 제출을 분류기에 보낸다 (D-33) |
| 출력 스키마 | `schemas/` | 공개 | 형식일 뿐이다 |

## ⚠️ 지금 저장소를 그대로 "공개"로 바꾸면 안 된다

프롬프트는 서브모듈로 옮겼지만 **git 이력에는 `prompts/`와 `core/assets.generated.ts` 원문이 남아 있다.** 이력을 다시 써서 force-push 해도 GitHub는 기존 PR 페이지와 커밋 SHA 링크로 옛 커밋을 한동안 보여 준다. 그래서 **기존 비공개 저장소를 공개로 바꾸지 않고, 정리한 이력으로 새 공개 저장소를 만든다.**

## 절차

1. **준비**
   - 공개할 브랜치(`main` 또는 `develop`)가 최신이고, 비밀값 검사를 통과한다: `git log --all -p | grep -E "sk-ant-|ghp_|eyJhbGciOi"` 결과가 없어야 한다 (가능하면 gitleaks 도 돌린다).
   - `results/`, `calibration/`, `exams/`, `web/.data/`, `.env` 가 커밋되지 않았는지 `git ls-files` 로 확인한다.
2. **이력 정리** (둘 중 하나)
   - **A. 새 이력으로 공개 (권장, 가장 안전)**: 공개할 트리만 단일 커밋으로 만든다.
     ```bash
     git clone --no-recurse-submodules <비공개 저장소> release && cd release
     git checkout --orphan public && git commit -m "Agent Interview Arena 공개"
     ```
   - **B. 이력 보존**: 미러 클론에서 비공개 경로를 이력 전체에서 지운다.
     ```bash
     git clone --mirror <비공개 저장소> release.git && cd release.git
     git filter-repo --invert-paths --path prompts --path core/assets.generated.ts
     ```
     이후 `git log --all --oneline -- prompts core/assets.generated.ts` 결과가 비어야 한다. 커밋 메시지에 공격 문구를 적은 적이 있는지도 `git log --all --format=%B | grep` 으로 확인한다.
3. **새 공개 저장소에 올린다**: `gh repo create <이름> --public` 후 push. `.gitmodules`의 서브모듈 URL은 공개돼도 된다(내용은 권한이 있어야 받는다).
4. **검증**: 권한 없는 계정으로 공개 저장소를 clone 해 다음을 확인한다.
   - `npm install && npm test` 가 통과한다 (프롬프트가 필요한 테스트 3개는 건너뜀).
   - 비공개 공격 풀(`prompts/red_team_attack_pool.json`)에서 공격마다 고유한 단어(가짜 기술명, 강요 문구, URL 등)를 뽑아 `git grep`으로 검색했을 때 하나도 나오지 않는다. 이 문서에 그 단어를 적지 않는다.
5. **운영 배포**는 계속 비공개 저장소 또는 deploy key 로 서브모듈을 받는 빌드에서 한다 (`web/README.md` 배포 절차).

## 공개 뒤에도 남는 노출

프롬프트를 숨겨도 결과 통지서에는 원칙 번호, 심사평, 공격 이름과 방어 여부가 나간다. 여러 번 제출하면 기준을 어느 정도 추측할 수 있다. 그래서 공격 문구를 분기마다 바꾸는 작업(남은 과제)을 함께 해야 효과가 유지된다.
