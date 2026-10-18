# HiveCFM Team Git Workflow — Task, Branch, Commit, PR

Applies to every repo under `dev.azure.com/istnetworksrnd/HiveCFM` (`hivecfm-core`,
`hivecfm-hub`, `hivecfm-dev-hub`).

**Sources.** Sections 3, 4 and the PR contents in 5 restate the team `AGENTS.md`
(**Git Workflow** and **Commit & Pull Request** sections). Items marked *(team practice)* are
additions — the base branch, PR roles, merge policy, the per-task script — and are not in
`AGENTS.md` itself.

> `CONTRIBUTING.md` in `hivecfm-core` still prescribes `ucc-uat` and `feature/…` — out of date.
> Follow `AGENTS.md` and this page.

## 1. One task = one branch = one PR *(team practice)*

Every work item gets its own branch, cut from **`origin/development`**, merged back into
**`development`** by a squash PR. Never branch from `main`, `hivecfm-main`, `dev` or `stg`.

## 2. Start every task with the script *(team practice)*

```bash
cd <your hivecfm-core checkout>
npx -y @genidy/hive-task-workflow start 4821 -Scope sso
```

Or install once (`npm i -g @genidy/hive-task-workflow`) and run `hive-task 4821 -Scope sso`.
Works from PowerShell and Git Bash; the CLI calls PowerShell with `-ExecutionPolicy Bypass` for you.

What it generates per task:

| Output | Example (work item 4821, title "Add the SSO-only login toggle") |
|---|---|
| Branch, created from `origin/development` | `feat/4821-add-sso-only-login-toggle` |
| Commit template (path printed by the script) | `feat(sso): add the SSO-only login toggle` + `AB#4821` footer |
| PR title + PR description files | title line; description with work item, problem, solution, scope audit, commands, migrations, screenshots, reviewer checklist |

The files live inside the git directory (never committed). **Copy the exact paths the script prints**
under "Ready. Next:" — in a worktree they are under `.git/worktrees/<name>/hive-task/`.

Options: `-Scope <module>`, `-Type <type>`, `-Title "…"`, `-Desc two-to-five-words`, `-WhatIf`
(preview, changes nothing). Type comes from the work item: Bug/Issue → `fix`, User Story/Feature
→ `feat`; for a **Task** you must pass `-Type`. Scope comes from the Area Path only when it is a
known module, otherwise pass `-Scope`.

It refuses when: origin is unreachable (dead PAT, wrong URL), tracked files are uncommitted, the
branch already exists, the name would re-cut an existing branch as `-vN`, or the base is anything
other than `development`. It never pushes and never opens a PR.

**Prerequisites:** Node 18+, Git **2.31+**, Windows PowerShell 5.1+ (macOS/Linux: `pwsh` 7).
Check everything with `npx @genidy/hive-task-workflow setup`. For automatic work-item lookup:
Azure CLI logged in (`az login`) — or set `AZURE_DEVOPS_EXT_PAT` to a PAT with *Work Items: Read*.
Without either, pass `-Type` and `-Title`. PR creation needs `az extension add --name azure-devops`.

## 3. Branch names

`<type>/<ticket>-<short-kebab-description>`

- `<type>`: `feat` `fix` `hotfix` `chore` `refactor` `docs` `test` `ci` `release`
- `<ticket>`: Azure Boards work-item id, digits only (`4821`) — or `noref` if there genuinely is none
- description: 2–5 lowercase, hyphen-separated words
- lowercase and hyphens only — no CamelCase, spaces, underscores; no personal names
- one branch = one logical change; never re-cut as `-v2` — rebase or force-push the original
- reserved, never a task branch: `dev`, `main`, `hivecfm-main`, `ucc-uat`, `release/*`, `customer/*`
  — plus *(team practice)* the other long-lived branches `development`, `ucc-main`, `staging`,
  `stg`, `prd`. A release-prep task uses `release/<ticket>-<desc>`.

| Good | Bad | Why bad |
|---|---|---|
| `feat/4821-sso-only-login-toggle` | `feature/4821-sso-toggle` | `feature` is not a type |
| `fix/4790-expire-card` | `feat/AB#4821-sso-toggle` | `AB#` belongs in the commit footer |
| `ci/4612-acr-push-set-e` | `ahmed/sso-toggle` | personal name, no ticket |
| `chore/noref-drop-tracked-migrations` | `fix/4790-expire-card-v2` | re-cut instead of rebase |

## 4. Commit messages

```
<type>(<scope>): <imperative summary ≤72 chars>

<optional body: what changed and why, not how>

AB#4821
```

- same types as branches; scope = module or area (`sso`, `migrator`, `bot-connector`, `contacts`, `db`, `nps`)
- imperative ("add", not "added"), lowercase, no trailing period
- optional footer: `AB#1234`, `BREAKING CHANGE: …` — *(team practice)* always include `AB#<id>`
  when there is a work item; the template pre-fills it
- commit with the template: `git commit -e -F "<path printed by the script>"` — the subject is
  pre-filled from the work-item title; reword it into an imperative if needed
- keep commits scoped and lint-clean; lint the files you touched, not the whole repo
- after rebasing your own pushed branch: `git push --force-with-lease` (never on someone else's)

## 5. Pull requests

Open a PR when the change is ready — a push alone is not a PR.

- **Target `development`** *(team practice)*. Title = squash-commit subject, same
  `<type>(<scope>): …` form.
- **Description** (from the generated `.pr.md`): problem, solution, link to the work item / spec,
  screenshots or gifs for UI work, migrations or env changes, and the output of relevant commands
  (`pnpm test`, `pnpm lint`, `pnpm db:migrate:dev`). *(team practice)* `apps/web` tests are red at
  baseline — paste the before/after on the files you touched. Add a scope audit (one line per
  changed file). Azure DevOps caps descriptions at 4000 characters; attach long logs.
- Create it with the `az repos pr create …` line the script prints (the `--description "@<path>"`
  argument must stay quoted in PowerShell), or in the web UI from the link `git push` prints.

### Roles *(team practice)*

| Role | Owns | Responsibilities |
|---|---|---|
| **Author** | branch + PR | one task per PR; scope audit; paste commands + output; link the work item; answer every comment; re-request review after new pushes |
| **Reviewer** | quality of the diff | only this task in the diff; commands actually run; migrations/env listed; branch, commits and title follow the rules; approve, or "wait for author" with a reason |
| **Approver / merger** | landing it | required approvals + green build; **squash merge** into `development`; final subject = PR title; delete the source branch |
| **DevOps** | pipelines + branch policies | owns `azure-pipelines*.yml` and branch policies; feature PRs never add or redesign pipelines |

The author never approves their own PR. Required reviewer count = the `development` branch policy.

## 6. Versions and tags

SemVer with a `v` prefix (`v4.6.0`, RCs `v4.6.0-rc.1`), annotated tags only (`git tag -a`), never
move or re-push a tag — ship a new patch. No floating tags (`stable`). Customer/on-prem lines are
namespaced (`ucc/v4.6.0`).

## 7. For Claude Code users

`npx @genidy/hive-task-workflow setup` installs the **`hive-task-workflow`** skill into
`~/.claude/skills/`. Restart Claude Code; the skill then applies all of the above when you say
"start task 4821", "commit this", or "write the PR". It never opens a PR unless you explicitly ask.
