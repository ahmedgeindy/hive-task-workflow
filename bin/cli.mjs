#!/usr/bin/env node
// hive-task-workflow CLI.
//
//   npx @genidy/hive-task-workflow setup          install the agent skill + check prerequisites
//   npx @genidy/hive-task-workflow start <id> ... start a task (branch, commit template, PR draft)
//   npx @genidy/hive-task-workflow guide          print the team git workflow guide
//   npx @genidy/hive-task-workflow selftest       run the bundled unit tests
//
// `start` forwards every argument after it to scripts/hive-task.ps1 unchanged.
// `hive-task <id> ...` (second bin, bin/hive-task.mjs) is shorthand for `start`.

import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const IS_WINDOWS = platform() === 'win32'
const SKILL_NAME = 'hive-task-workflow'
const MARKER = '.installed-by'   // proves a target dir is ours before we overwrite it

function fail(what, cause, next) {
  console.error(`\nFAILED: ${what}\n  cause: ${cause}\n  next:  ${next}`)
  process.exit(1)
}

function findPowerShell() {
  // Windows PowerShell 5.1 ships with Windows; pwsh 7 anywhere else.
  for (const exe of IS_WINDOWS ? ['powershell.exe', 'pwsh.exe'] : ['pwsh']) {
    const r = spawnSync(exe, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'], { encoding: 'utf8' })
    if (r.status === 0) return { exe, version: r.stdout.trim() }
  }
  return null
}

function runPs1(script, args) {
  const ps = findPowerShell()
  if (!ps) {
    fail('PowerShell not found', IS_WINDOWS ? 'powershell.exe is not on PATH' : 'pwsh is not installed',
      IS_WINDOWS ? 'run from a normal Windows terminal' : 'install PowerShell 7: https://aka.ms/powershell')
  }
  // -NonInteractive: a missing mandatory parameter fails instead of prompting.
  const r = spawnSync(ps.exe, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(ROOT, 'scripts', script), ...args],
    { stdio: 'inherit' })
  if (r.error) fail(`could not run ${script}`, r.error.message, `check PowerShell runs: ${ps.exe} -NoProfile -Command 1`)
  if (r.signal) fail(`${script} was killed`, r.signal, 're-run')
  return r.status ?? 1
}

function gitVersion() {
  const r = spawnSync('git', ['--version'], { encoding: 'utf8' })
  const m = r.status === 0 && r.stdout.match(/(\d+)\.(\d+)/)
  return m ? [Number(m[1]), Number(m[2])] : null
}

// Where each agent discovers user-level Agent Skills (SKILL.md folders, agentskills.io format).
// Verified against each vendor's docs 2026-10-18 (URLs in README "Supported agents").
// Agents that read the shared ~/.agents/skills folder share one copy, so picking several of
// them installs once. `home` is the dir whose presence means "this agent is installed here".
const H = () => homedir()
const claudeHome = () => process.env.CLAUDE_CONFIG_DIR || join(H(), '.claude')
const shared = () => join(H(), '.agents', 'skills')
const AGENTS = [
  { id: 'claude',   name: 'Claude Code',      home: claudeHome,                              skills: () => join(claudeHome(), 'skills') },
  { id: 'codex',    name: 'OpenAI Codex CLI', home: () => join(H(), '.codex'),               skills: shared },
  { id: 'copilot',  name: 'GitHub Copilot',   home: () => join(H(), '.copilot'),             skills: shared },
  { id: 'cursor',   name: 'Cursor',           home: () => join(H(), '.cursor'),              skills: shared },
  { id: 'gemini',   name: 'Gemini CLI',       home: () => join(H(), '.gemini'),              skills: shared },
  { id: 'windsurf', name: 'Windsurf / Devin', home: () => join(H(), '.codeium', 'windsurf'), skills: shared },
  { id: 'opencode', name: 'OpenCode',         home: () => join(H(), '.config', 'opencode'),  skills: shared },
  { id: 'amp',      name: 'Amp',              home: () => join(H(), '.config', 'amp'),       skills: shared },
  { id: 'kiro',     name: 'Kiro (IDE)',       home: () => join(H(), '.kiro'),                skills: () => join(H(), '.kiro', 'skills') },
  { id: 'cline',    name: 'Cline',            home: () => join(H(), '.cline'),               skills: () => join(H(), '.cline', 'skills') },
]
// Project scope: <repo>/.agents/skills (Codex, Copilot, Cursor, Gemini, Windsurf, OpenCode, Amp)
// and <repo>/.claude/skills (Claude Code, Cline). Commit them to share with the team.
const PROJECT_DIRS = [
  ['.agents', 'Codex, Copilot, Cursor, Gemini, Windsurf, OpenCode, Amp'],
  ['.claude', 'Claude Code, Cline'],
]

function parseAgentList(value) {
  const ids = String(value).split(',').map((v) => v.trim().toLowerCase()).filter(Boolean)
  if (ids.includes('all')) return AGENTS
  const unknown = ids.filter((id) => !AGENTS.some((a) => a.id === id))
  if (unknown.length || !ids.length) {
    fail(`unknown agent: ${unknown.join(', ') || '(empty)'}`, `known: ${AGENTS.map((a) => a.id).join(', ')}, all`, 'fix the --agent value')
  }
  return AGENTS.filter((a) => ids.includes(a.id))
}

async function chooseAgents(flag) {
  if (flag !== undefined) return parseAgentList(flag)
  const detected = AGENTS.filter((a) => existsSync(a.home()))
  if (!process.stdin.isTTY) {
    if (!detected.length) fail('no AI agent detected', 'none of the known agent config dirs exist', `pass --agent <${AGENTS.map((a) => a.id).join('|')}|all>`)
    return detected
  }
  console.log('Which AI agents should get the skill?\n')
  AGENTS.forEach((a, i) => console.log(`  ${String(i + 1).padStart(2)}) ${a.name.padEnd(18)} ${existsSync(a.home()) ? '(detected)' : ''}`))
  console.log('   a) all')
  const def = detected.map((a) => AGENTS.indexOf(a) + 1).join(',')
  const { createInterface } = await import('node:readline/promises')
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = (await rl.question(`\nNumbers, comma-separated [${def || 'none detected'}]: `)).trim() || def
  rl.close()
  if (!answer) fail('no agent selected', 'empty choice and nothing detected', 're-run and pick at least one number')
  if (answer.toLowerCase() === 'a') return AGENTS
  const picked = answer.split(',').map((n) => AGENTS[Number(n.trim()) - 1])
  if (picked.some((a) => !a)) fail(`invalid choice: ${answer}`, `use numbers 1-${AGENTS.length} or a`, 're-run setup')
  console.log('')
  return [...new Set(picked)]
}

function targetsFor(agents, project) {
  // Map of skill dir -> agents served. Dedupes: several agents share ~/.agents/skills.
  const map = new Map()
  if (project) {
    const root = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' })
    if (root.status !== 0) fail('--project needs a git repo', `cwd = ${process.cwd()}`, 'cd into the repo you want to share the skill in')
    for (const [d, who] of PROJECT_DIRS) map.set(join(root.stdout.trim(), d, 'skills', SKILL_NAME), who)
    return map
  }
  for (const a of agents) {
    const dir = join(a.skills(), SKILL_NAME)
    map.set(dir, map.has(dir) ? `${map.get(dir)}, ${a.name}` : a.name)
  }
  return map
}

function flagValue(args, name) {
  const i = args.findIndex((a) => a === name || a.startsWith(`${name}=`))
  if (i < 0) return undefined
  return args[i].includes('=') ? args[i].split('=').slice(1).join('=') : (args[i + 1] ?? '')
}

function installSkill(target) {
  // Throws (never exits) so setup() can report it and still print the summary.
  // Swap via sibling dirs so a failed delete can never leave the dir without its marker,
  // which would lock every later setup out with "not installed by" (review finding).
  if (existsSync(target) && !existsSync(join(target, MARKER))) {
    throw new Error(`${target} exists and was not installed by ${PKG.name} - move or delete it yourself, then re-run setup`)
  }
  const fresh = `${target}.new-${process.pid}`
  const old = `${target}.old-${process.pid}`
  rmSync(fresh, { recursive: true, force: true })
  mkdirSync(fresh, { recursive: true })
  cpSync(join(ROOT, 'SKILL.md'), join(fresh, 'SKILL.md'))
  cpSync(join(ROOT, 'scripts'), join(fresh, 'scripts'), { recursive: true })
  cpSync(join(ROOT, 'docs'), join(fresh, 'docs'), { recursive: true })
  writeFileSync(join(fresh, MARKER), `${PKG.name}@${PKG.version}
`)
  if (existsSync(target)) renameSync(target, old)
  renameSync(fresh, target)
  try { rmSync(old, { recursive: true, force: true }) } catch { console.log(`  INFO could not remove ${old} (in use?) - delete it later`) }
}

async function setup(args) {
  const project = args.includes('--project')
  const agents = project ? [] : await chooseAgents(flagValue(args, '--agent'))
  const checks = []
  const tick = (ok, label, hint = '') => { checks.push(ok); console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}${!ok && hint ? `\n       -> ${hint}` : ''}`) }
  console.log(`${PKG.name}@${PKG.version} setup\n`)

  const gv = gitVersion()
  tick(!!gv && (gv[0] > 2 || (gv[0] === 2 && gv[1] >= 31)), `git ${gv ? gv.join('.') : 'not found'} (need 2.31+)`, 'install Git 2.31 or newer')

  const ps = findPowerShell()
  tick(!!ps, `PowerShell ${ps ? `${ps.version} (${ps.exe})` : 'not found'}`, IS_WINDOWS ? 'powershell.exe missing from PATH' : 'install pwsh: https://aka.ms/powershell')

  for (const [target, who] of targetsFor(agents, project)) {
    try { installSkill(target); tick(existsSync(join(target, 'SKILL.md')) && existsSync(join(target, 'scripts', 'hive-task.ps1')), `skill -> ${target}  [${who}]`) }
    catch (e) { tick(false, `skill install to ${target}`, e.message) }
  }

  if (ps) tick(runPs1(join('test', 'HiveTask.tests.ps1'), []) === 0, 'bundled unit tests pass')

  // Optional: work-item lookup. Not a failure if absent; the script falls back to -Type/-Title.
  // shell: az is a .cmd shim on Windows, which Node refuses to spawn without one. Fixed args only.
  const az = spawnSync('az --version', { encoding: 'utf8', shell: true })
  console.log(`  ${az.status === 0 ? 'OK  ' : 'INFO'} Azure CLI ${az.status === 0 ? 'found' : 'not found'} (optional: automatic work-item lookup via 'az login' or AZURE_DEVOPS_EXT_PAT)`)

  const ok = checks.every(Boolean)
  console.log(ok
    ? `\nReady. Restart your AI agent(s) so the skill loads.${project ? ' Commit the new .agents/ and .claude/ skill folders to share it with the team.' : ''}\nStart a task with:\n  npx ${PKG.name} start <work-item-id> -Scope <module>`
    : '\nSetup incomplete - fix the FAIL lines above and re-run.')
  process.exit(ok ? 0 : 1)
}

function remove(args) {
  const project = args.includes('--project')
  const flag = flagValue(args, '--agent')
  const agents = project ? [] : flag !== undefined ? parseAgentList(flag) : AGENTS
  let n = 0
  for (const [target] of targetsFor(agents, project)) {
    if (!existsSync(target)) continue
    if (!existsSync(join(target, MARKER))) { console.log(`  SKIP ${target} (not installed by ${PKG.name})`); continue }
    rmSync(target, { recursive: true, force: true }); n++
    console.log(`  removed ${target}`)
  }
  console.log(n ? 'Done.' : 'Nothing to remove.')
}

function usage(code = 0) {
  console.log(`${PKG.name}@${PKG.version}

Usage:
  npx ${PKG.name} setup                 pick AI agents, install the skill, check prerequisites
      --agent <list>                   skip the prompt: ${AGENTS.map((a) => a.id).join(',')} or all
      --project                        install into this repo (.agents/ + .claude/) to commit for the team
  npx ${PKG.name} remove [--agent <list>] [--project]   uninstall the skill
  npx ${PKG.name} start <id> [options]  start a task: branch + commit template + PR draft
  npx ${PKG.name} guide                 print the team git workflow guide
  npx ${PKG.name} selftest              run the bundled unit tests

start options (passed to hive-task.ps1):
  -Scope <module>  -Type <feat|fix|...>  -Title "<summary>"  -Desc <two-to-five-words>
  -Base <branch>   -AllowNonDevelopmentBase   -Org <url>   -Project <name>   -WhatIf`)
  process.exit(code)
}

const argv = process.argv.slice(2)
const cmd = argv.shift()

switch (cmd) {
  case 'setup': await setup(argv); break
  case 'remove': remove(argv); break
  case 'start':
    if (['-h', '--help', 'help', '/?'].includes(argv[0])) usage(0)
    if (!/^(\d+|noref)$/i.test(argv[0] || '')) fail('missing work-item id', `start needs <id> or noref first, got '${argv[0] ?? ''}'`, `npx ${PKG.name} start 4821 -Scope sso`)
    process.exit(runPs1('hive-task.ps1', argv))
    break
  case 'guide': process.stdout.write(readFileSync(join(ROOT, 'docs', 'TEAM-GIT-WORKFLOW.md'), 'utf8')); break
  case 'selftest': process.exit(runPs1(join('test', 'HiveTask.tests.ps1'), [])); break
  case undefined: case '-h': case '--help': case 'help': usage(0); break
  case '-v': case '--version': console.log(PKG.version); break
  default: console.error(`unknown command: ${cmd}\n`); usage(2)
}
