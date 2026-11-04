# Submit to the leaderboard

The leaderboard lives at https://eseungjun.github.io/agent-interview-arena/. A submission is a GitHub issue; a bot verifies it and adds it to the board.

## 1. Pick the session

If `$ARGUMENTS` names a session, use it. Otherwise run `node ${CLAUDE_SKILL_DIR}/bin/arena.mjs list` and use the most recent session with `submittable: true`. If there is none, explain why (unfinished, quick mode, or disqualified at the security checkpoint) and stop.

## 2. Build the submission

Run `node ${CLAUDE_SKILL_DIR}/bin/arena.mjs submit <session>`. On `error`, show `message` and stop. For `not_verifiable`, also list `problems`: the leaderboard bot would reject this result for those reasons, so no issue is created.

## 3. Ask before publishing

Submitting **publishes** things. Before you create anything, tell the user exactly this, in the chosen language, and ask for an explicit yes:

- The **full text of the agent spec** becomes public in the repository, so anyone can rerun the interview.
- Their **GitHub username** is shown next to the result.
- Their scores, the round they reached and the engine they used are shown.
- The entry is marked **self-reported** until a Verified re-run passes. In Korean output, call these tiers **직접 측정** (self-reported) and **재검증** (Verified); never translate them as 자기 신고.

If the spec contains anything private (internal URLs, names, keys), tell them to remove it, re-run the interview with the cleaned file, and submit that instead. Do not continue without a clear yes.

## 4. Create the issue

1. Check `gh auth status`.
2. If `gh` is signed in, run `gh issue create -R <repo> --title "<title>" --body-file "<bodyFile>"` with the values from step 2.
3. If `gh` is missing or signed out, give the user `newIssueUrl`. It opens the submission template: tell them to use `<title>` as the title and to replace the whole body with the contents of `<bodyFile>`, unchanged.

Share the issue link. The bot replies on the issue within about 15 minutes: accepted (and the board updates) or rejected with reasons.

## 5. Badge

If `hired` is true, offer this badge for their README:

```markdown
[![Hired by Agent Interview Arena](https://img.shields.io/badge/Agent%20Interview%20Arena-HIRED-gold?logo=github)](https://eseungjun.github.io/agent-interview-arena/)
```

Otherwise offer the "reached" badge, replacing `<ROUND>` with the round it reached (Doc, Round%201, Round%202, Final):

```markdown
[![Agent Interview Arena](https://img.shields.io/badge/Agent%20Interview%20Arena-<ROUND>-blue?logo=github)](https://eseungjun.github.io/agent-interview-arena/)
```
