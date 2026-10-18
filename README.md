# @genidy/hive-task-workflow

HiveCFM team git workflow, packaged: **one work item = one branch = one PR into `development`**.

- **Per-task starter** — `hive-task <id>` reads the Azure Boards work item, generates a
  rule-compliant branch name, cuts it from `origin/development`, and writes a commit template and
  PR title/description for that task. Never pushes, never opens a PR.
- **Agent skill** — installs `hive-task-workflow` for Claude Code so the agent applies the same
  branch / commit / PR rules on every task.
- **Team guide** — [docs/TEAM-GIT-WORKFLOW.md](docs/TEAM-GIT-WORKFLOW.md): branch names, commit
  format, PR contents and PR roles (Author / Reviewer / Approver / DevOps).

## Install

```bash
npx @genidy/hive-task-workflow setup
```

Checks Git 2.31+ and PowerShell, installs the skill to `~/.claude/skills/hive-task-workflow`, and
runs the bundled tests. Restart Claude Code afterwards so the skill loads.

Optional global command:

```bash
npm i -g @genidy/hive-task-workflow
```

## Start a task

From inside your repo checkout (`hivecfm-core`, `hivecfm-hub`, `hivecfm-dev-hub`):

```bash
npx @genidy/hive-task-workflow start 4821 -Scope sso
```

or, after a global install, `hive-task 4821 -Scope sso`.

```
Work item AB#4821: [User Story] Add the SSO-only login toggle

  branch : feat/4821-add-sso-only-login-toggle
  base   : origin/development
  commit : feat(sso): add the SSO-only login toggle

Ready. Next:
  commit  : git commit -e -F "<repo>/.git/hive-task/feat__4821-add-sso-only-login-toggle.commit.txt"
  push    : git push -u origin feat/4821-add-sso-only-login-toggle
  PR (only when asked; target = development):
    az repos pr create ... --description "@<repo>/.git/hive-task/feat__4821-add-sso-only-login-toggle.pr.md" ...
```

| Option | Meaning |
|---|---|
| `-Scope <module>` | commit scope: `sso`, `migrator`, `bot-connector`, `contacts`, `db`, `nps`, ... |
| `-Type <type>` | `feat` `fix` `hotfix` `chore` `refactor` `docs` `test` `ci` `release` (required for a Task) |
| `-Title "<summary>"` | use instead of the work-item title (works without Azure login) |
| `-Desc <two-to-five-words>` | explicit branch description |
| `-Base <branch>` | base branch; default `development` (origin's default branch if it has none) |
| `-AllowNonDevelopmentBase` | allow a base other than `development` (only when your lead asks) |
| `-Org <url>` / `-Project <name>` | Azure DevOps org/project; default: read from the origin URL |
| `-WhatIf` | preview only, changes nothing |

Use `noref` instead of an id only when there genuinely is no work item.

It refuses when origin is unreachable, tracked files are uncommitted, the branch already exists,
the name re-cuts an existing branch as `-vN`, or the base is anything other than `development`
when origin has one.

**Work-item lookup** (optional): `az login`, or set `AZURE_DEVOPS_EXT_PAT` to a PAT with
*Work Items: Read*. Without it, pass `-Type` and `-Title`.
**PR creation** with the printed command needs `az extension add --name azure-devops`.

## Other commands

```bash
npx @genidy/hive-task-workflow guide      # print the team guide
npx @genidy/hive-task-workflow selftest   # run the bundled unit tests
```

## Requirements

Node 18+, Git 2.31+, Windows PowerShell 5.1+ (macOS/Linux: PowerShell 7 `pwsh`).
