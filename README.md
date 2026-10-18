# @genidy/hive-task-workflow

HiveCFM team git workflow, packaged: **one work item = one branch = one PR into `development`**.

- **Per-task starter** — `hive-task <id>` reads the Azure Boards work item, generates a
  rule-compliant branch name, cuts it from `origin/development`, and writes a commit template and
  PR title/description for that task. Never pushes, never opens a PR.
- **Agent skill** — installs `hive-task-workflow` into the AI agents you pick (Claude Code, Codex,
  Copilot, Cursor, Gemini CLI, Windsurf, OpenCode, Amp, Kiro, Cline) so the agent applies the same
  branch / commit / PR rules on every task.
- **Team guide** — [docs/TEAM-GIT-WORKFLOW.md](docs/TEAM-GIT-WORKFLOW.md): branch names, commit
  format, PR contents and PR roles (Author / Reviewer / Approver / DevOps).

## Install

```bash
npx @genidy/hive-task-workflow setup
```

Asks which AI agents to install the skill into (agents found on your machine are pre-selected),
checks Git 2.31+ and PowerShell, and runs the bundled tests. Restart your agent afterwards.

```
Which AI agents should get the skill?

   1) Claude Code        (detected)
   2) OpenAI Codex CLI
   3) GitHub Copilot     (detected)
   4) Cursor
   ...
   a) all

Numbers, comma-separated [1,3]:
```

Non-interactive: `setup --agent claude,cursor` or `setup --agent all`.
Share with the whole team through the repo instead: `setup --project` (from inside the repo)
writes `.agents/skills/` and `.claude/skills/` — commit them and every teammate's agent picks the
skill up with no install. Uninstall: `remove` (same flags).

### npx or npm?

Both come with Node. **`npm`** installs a package; **`npx`** downloads and runs a package's
command in one step, without installing anything permanently.

| You want | Command |
|---|---|
| Run it once / always the latest | `npx @genidy/hive-task-workflow <command>` |
| A permanent short `hive-task` command | `npm i -g @genidy/hive-task-workflow`, then `hive-task 4821 -Scope sso` |
| Update the global install | `npm i -g @genidy/hive-task-workflow@latest` |

### Supported agents

All of them read the same `SKILL.md` folder format ([agentskills.io](https://agentskills.io/specification)),
so one skill serves every agent. Agents that read the shared `~/.agents/skills` get one copy.

| `--agent` | Agent | Installed to (user level) |
|---|---|---|
| `claude` | Claude Code | `~/.claude/skills/` ([docs](https://code.claude.com/docs/en/skills)) |
| `codex` | OpenAI Codex CLI | `~/.agents/skills/` ([docs](https://learn.chatgpt.com/docs/build-skills)) |
| `copilot` | GitHub Copilot (VS Code, CLI) | `~/.agents/skills/` ([docs](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills)) |
| `cursor` | Cursor | `~/.agents/skills/` ([docs](https://cursor.com/docs/context/skills)) |
| `gemini` | Gemini CLI | `~/.agents/skills/` ([docs](https://geminicli.com/docs/cli/skills/)) |
| `windsurf` | Windsurf / Devin | `~/.agents/skills/` ([docs](https://docs.devin.ai/desktop/cascade/skills)) |
| `opencode` | OpenCode | `~/.agents/skills/` ([docs](https://opencode.ai/docs/skills/)) |
| `amp` | Amp | `~/.agents/skills/` ([docs](https://ampcode.com/docs/customize/skills)) |
| `kiro` | Kiro (IDE) | `~/.kiro/skills/` ([docs](https://kiro.dev/docs/skills/)) |
| `cline` | Cline | `~/.cline/skills/` ([docs](https://docs.cline.bot/features/skills)) |

`~` is your home folder (`C:\Users\<you>` on Windows). `CLAUDE_CONFIG_DIR` is honoured for Claude Code.

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
