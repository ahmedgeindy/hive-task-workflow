---
name: hive-task-workflow
description: Use for any task in a HiveCFM Azure DevOps repo (hivecfm-core, hivecfm-hub, hivecfm-dev-hub) — the whole arc from work item to merged PR. Fires on "start task 4821", "pick up AB#1234", "work on ticket 4821", "new task", "cut a branch for", "commit this" or "write the commit message" in a HiveCFM repo, "push my branch", "open/raise/create a PR", "write the PR description", "who reviews / approves / merges". Runs scripts/hive-task.ps1 to generate the branch name, cut it from origin/development, and pre-fill the commit template and PR draft; enforces Conventional Commits; never opens a PR unless explicitly asked.
---

# Hive Task Workflow

One work item = one branch = one PR into `development`.

**Sources.** Branch, commit and PR-content rules are the team `AGENTS.md` **Git Workflow** and
**Commit & Pull Request** sections. Rules marked *(team practice)* are standing team additions,
not in `AGENTS.md` itself. Full human guide: `docs/TEAM-GIT-WORKFLOW.md` next to this file.

## Step 1 — get the work item id

If the request doesn't already carry it, ask for the **Azure Boards work-item id**. One question,
then wait. `noref` only if there genuinely is none — ask first; the ticket is the field that gets skipped.

## Step 2 — start the task (automated, per task)

From inside the repo checkout (works from PowerShell and Git Bash):

```bash
powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "<this skill's dir>/scripts/hive-task.ps1" <id> -Scope <module>
```

(`pwsh` instead of `powershell` on macOS/Linux.) Equivalent when installed globally:
`hive-task <id> -Scope <module>`. The bundled copy is the version `setup` installed — prefer it
over an unpinned `npx`.

The script:
1. `git ls-remote origin` — proves the PAT/credential is live before anything else.
2. Reads the work item over the Azure DevOps REST API (your `az login`, or `AZURE_DEVOPS_EXT_PAT`)
   → type, title, area. Not logged in? Pass `-Type <type> -Title "<summary>"`.
3. Generates `<type>/<id>-<2-5-word-desc>` and validates it (branch grammar + the 2–5 word rule).
4. Refuses on: uncommitted tracked changes; a branch that already exists; a `-vN` re-cut of an
   existing branch; any base other than `development` when origin has one *(team practice)*;
   no commit scope.
5. Fetches `origin/development` and creates the branch from it with **no upstream**, so a bare
   `git push` can never hit `development`.
6. Writes `<key>.commit.txt`, `<key>.pr-title.txt`, `<key>.pr.md` under
   `$(git rev-parse --git-path hive-task)` (inside the git dir — never committed; in a worktree
   that is `.git/worktrees/<name>/hive-task`). **Use the absolute paths the script prints.**

`-WhatIf` previews without changing anything. If the script cannot run, apply the same rules by
hand (guide §3). Org/project come from the origin URL; override with `-Org` / `-Project`.

Type mapping: Bug/Issue → `fix`; User Story/PBI/Feature → `feat`; tag `hotfix` → `hotfix`.
**Task and Epic have no default** — pass `-Type`. Scope comes from the work item's Area Path only
when it is a known module (`sso`, `migrator`, `bot-connector`, `contacts`, `db`, `nps`); otherwise
pass `-Scope`.

## Step 3 — commit

```bash
git commit -e -F "<printed path>.commit.txt"
```

- `<type>(<scope>): <imperative summary ≤72 chars>` — imperative ("add", not "added"), lowercase,
  no trailing period. The script pre-fills the subject from the work-item title (lowercased,
  acronyms kept, cut on a word boundary); **edit it into an imperative** if the title isn't one.
- Body: what and why, not how. Footer: `AB#<id>` (AGENTS.md lists it as optional; the script
  pre-fills it as team convention *(team practice)*), plus `BREAKING CHANGE: …` when relevant.
- As an agent with no editor, write the final message to a file and `git commit -F <file>`.
  Never inline multi-line messages (shell quoting mangles them, especially on Windows).
- Scope audit before each commit: for every file in `git diff --stat`, one line on why it must
  change for this task; revert drift/formatting hunks. Lint only touched files
  (`npx eslint <paths>`), never `eslint --fix` repo-wide.

## Step 4 — push

```bash
git push -u origin <branch>
```

After rebasing **your own** pushed branch: `git push --force-with-lease`. Never force-push or amend
a commit you did not create. Never push to a long-lived branch: `development`, `dev`, `main`,
`hivecfm-main`, `ucc-main`, `ucc-uat`, `staging`, `stg`, `prd`, `release/*` lines, `customer/*`.

## Step 5 — STOP *(team practice)*

**Never open a pull request unless the user explicitly asks.** Report branch + last commit and stop.
A push is not permission to open a PR.

## Step 6 — PR (only when asked)

- Target `development`. Title = the squash-commit subject, same `<type>(<scope>): …` form (AGENTS.md).
- Description = the printed `.pr.md` (description only; title is in `.pr-title.txt`): work item /
  spec link, problem, solution, scope audit, commands run with output, migrations/env changes,
  screenshots/gifs for UI (AGENTS.md). 4000-character limit — attach long logs.
- Use the `az repos pr create …` line the script printed (the `@path` is quoted so PowerShell
  parses it). Not `gh` — the repos are on Azure DevOps.
- No "Generated with Claude Code" footer in PR bodies.

## PR roles *(team practice)*

| Role | Owns | Must do |
|---|---|---|
| **Author** | branch + PR | one task per PR; scope audit; paste commands + output; link the work item; answer every comment; re-request review after pushes |
| **Reviewer** | quality of the diff | only this task in the diff; commands actually run; migrations/env listed; branch, commits and title follow the rules; approve or "wait for author" with a reason |
| **Approver / merger** | landing it | required approvals + green build; **squash** into `development` (PR title = final subject); delete the source branch |
| **DevOps** | pipelines + branch policies | owns `azure-pipelines*.yml` and policies — feature PRs never add or redesign pipelines |

Author never approves their own PR. Required reviewer count = the `development` branch policy.

## Red flags — stop

| Thought | Reality |
|---|---|
| "I'll branch from my current branch" | Always `origin/development`, explicit. |
| "`feature/…` is fine" | Not a valid type. Use `feat`. |
| "I'll put `AB#` in the branch" | Digits only in the branch; `AB#` goes in the commit footer. |
| "Pushed, so I'll open the PR" | Only when explicitly asked. |
| "Quick fix, skip the ticket" | Ask for the id; `noref` is the exception. |
| "Re-cut as `-v2`" | Rebase the original, then `--force-with-lease`. |
