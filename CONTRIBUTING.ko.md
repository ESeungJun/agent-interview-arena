# 기여 안내

[English](CONTRIBUTING.md) · 한국어

## 브랜치

- `main` 은 언제나 배포할 수 있는 상태로 둔다. 마켓플레이스, skills.sh, 순위표 페이지가 모두 `main` 을 읽는다.
- 작업은 짧게 쓰고 지우는 브랜치에서 하고, 풀 리퀘스트로 `main` 에 합친다.
  - `feat/<주제>`: 새 기능
  - `fix/<주제>`: 버그 수정
  - `docs/<주제>`: 문서만 고칠 때
- 브랜치 하나에는 주제 하나만 담고, 합친 뒤에는 브랜치를 지운다.
- 순위표 봇은 `main` 에 바로 커밋한다 (`docs/leaderboard.json`, `docs/submissions/` 만).
  - 이 파일들은 손으로 고치지 않는다.
  - 합치기 전에 브랜치를 `main` 위로 rebase 한다.

## 풀 리퀘스트를 열기 전에

```bash
npm ci
npm test          # 번들을 먼저 빌드하고, 모델 호출 없이 모든 테스트를 돌린다
npm run typecheck
```

- `npm test` 는 `plugins/arena/skills/apply/bin/arena.mjs` 를 다시 빌드한다.
  - 다시 빌드한 번들을 소스 변경과 함께 커밋한다.
  - 빠뜨리면 설치된 스킬이 예전 코드로 돈다.
- `prompts/` 나 `schemas/` 를 고쳤으면 프롬프트 해시가 바뀌고, 순위표는 이전 버전으로 만든 결과를 더는 받지 않는다.
  - 풀 리퀘스트 설명에 이 사실을 적는다.
  - 이전 버전도 계속 받으려면(채점이 바뀌지 않는 문구 수정 등) 이전 해시를 같은 풀 리퀘스트에서 `leaderboard/accepted_prompts.json` 에 넣는다.

## 릴리스

- 버전은 `package.json` 과 `plugins/arena/.claude-plugin/plugin.json` 에 있다. 둘 다 올린다.
- `main` 의 합친 커밋에 `vX.Y.Z` 태그를 붙이고 태그를 push 한다.

## 커밋

- 커밋 하나에는 논리적인 변경 하나를 담는다.
- 메시지에는 무엇을 왜 바꿨는지 쓴다.
- 비밀값(`.env`, API 키)과 비공개 공격 풀의 내용은 절대 커밋하지 않는다.
