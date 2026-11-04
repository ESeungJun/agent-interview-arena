# Contributing

English · [한국어](CONTRIBUTING.ko.md)

## Branches

- `main` is always releasable. The marketplace, skills.sh and the leaderboard page all read from it.
- Work happens on a short-lived branch, merged into `main` through a pull request.
  - `feat/<topic>`: new behaviour
  - `fix/<topic>`: bug fixes
  - `docs/<topic>`: documentation only
- Keep one topic per branch, and delete the branch after it is merged.
- The leaderboard bot commits straight to `main` (only `docs/leaderboard.json` and `docs/submissions/`). Rebase your branch on `main` before merging instead of editing those files by hand.

## Before you open a pull request

```bash
npm ci
npm test          # builds the bundle first, then runs every test without model calls
npm run typecheck
```

- `npm test` rebuilds `plugins/arena/skills/apply/bin/arena.mjs`. Commit the rebuilt bundle together with the source change, or the installed skill runs old code.
- If you changed anything in `prompts/` or `schemas/`, the prompt hash changes and the board stops accepting results made with the previous version. Say so in the pull request.
  - To keep accepting the previous version (a wording fix that does not change grading, for example), add its hash to `leaderboard/accepted_prompts.json` in the same pull request.

## Releases

- The version lives in `package.json` and `plugins/arena/.claude-plugin/plugin.json`. Bump both.
- Tag the merge commit on `main` as `vX.Y.Z` and push the tag.

## Commits

- One logical change per commit, with a message that says what changed and why.
- Never commit secrets (`.env`, API keys) or anything from the held-out attack pool.
