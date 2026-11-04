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

## Repository rules

- Only the owner has write access. Everyone else contributes through a fork and a pull request.
- The `main` ruleset blocks force pushes and branch deletion. Only the owner (admin) bypasses it.
- There is no "require a pull request" rule.
  - The leaderboard bot commits straight to `main` with the Actions token, and a personal repository cannot list the Actions bot as an exception.
  - Before adding a collaborator, switch the bot to push with a deploy key, add that key as an exception, then turn the rule on.

## Issue types

Blank issues are off; pick one of the forms in `.github/ISSUE_TEMPLATE/`.

| Form | Title prefix | Label | Handled by |
| --- | --- | --- | --- |
| 🏆 Leaderboard submission | `[arena-submission]` | added by the bot | the bot |
| 🐛 Bug report | | `bug` | a person |
| 💡 Feature or improvement | | `enhancement` | a person |
| 🗑️ Remove my entry | `[arena-removal]` | `arena-removal` | a person (checks it is the submitter) |
| 🚩 Report an entry | `[arena-report]` | `arena-report` | a person |
| ❓ Question | | `question` | a person |

- Security vulnerabilities go through private reporting on the Security tab, not issues.
- The submission form adds no label. `arena-submission`, `arena-accepted` and `arena-rejected` are the bot's processing-state labels.
- The bot only looks at issues whose title starts with `[arena-submission]`. If you change that prefix, change `TITLE_PREFIX` in `runner/board_cli.ts` and the workflow condition too.

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

- The version lives in three places: `package.json`, `plugins/arena/.claude-plugin/plugin.json` and `ARENA_VERSION` in `runner/arena.ts`. Bump all three and rebuild the bundle.
  - `ARENA_VERSION` is recorded as the engine version in interview records and leaderboard submissions.
  - The waiting-room pane (`plugins/arena-room/.claude-plugin/plugin.json`) has its own version. Bump it only when the pane changes.
- Tag the merge commit on `main` as `vX.Y.Z` and push the tag.

## Commits

- One logical change per commit, with a message that says what changed and why.
- Never commit secrets (`.env`, API keys) or anything from the held-out attack pool.
