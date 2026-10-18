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

function skillTargets() {
  // Claude Code user skills dir; CLAUDE_CONFIG_DIR overrides ~/.claude.
  const base = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
  return [join(base, 'skills', SKILL_NAME)]
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

function setup() {
  const checks = []
  const tick = (ok, label, hint = '') => { checks.push(ok); console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}${!ok && hint ? `\n       -> ${hint}` : ''}`) }
  console.log(`${PKG.name}@${PKG.version} setup\n`)

  const gv = gitVersion()
  tick(!!gv && (gv[0] > 2 || (gv[0] === 2 && gv[1] >= 31)), `git ${gv ? gv.join('.') : 'not found'} (need 2.31+)`, 'install Git 2.31 or newer')

  const ps = findPowerShell()
  tick(!!ps, `PowerShell ${ps ? `${ps.version} (${ps.exe})` : 'not found'}`, IS_WINDOWS ? 'powershell.exe missing from PATH' : 'install pwsh: https://aka.ms/powershell')

  for (const target of skillTargets()) {
    try { installSkill(target); tick(existsSync(join(target, 'SKILL.md')) && existsSync(join(target, 'scripts', 'hive-task.ps1')), `skill installed: ${target}`) }
    catch (e) { tick(false, `skill install to ${target}`, e.message) }
  }

  if (ps) tick(runPs1(join('test', 'HiveTask.tests.ps1'), []) === 0, 'bundled unit tests pass')

  // Optional: work-item lookup. Not a failure if absent; the script falls back to -Type/-Title.
  // shell: az is a .cmd shim on Windows, which Node refuses to spawn without one. Fixed args only.
  const az = spawnSync('az --version', { encoding: 'utf8', shell: true })
  console.log(`  ${az.status === 0 ? 'OK  ' : 'INFO'} Azure CLI ${az.status === 0 ? 'found' : 'not found'} (optional: automatic work-item lookup via 'az login' or AZURE_DEVOPS_EXT_PAT)`)

  const ok = checks.every(Boolean)
  console.log(ok
    ? `\nReady. Restart Claude Code so the skill loads. Start a task with:\n  npx ${PKG.name} start <work-item-id> -Scope <module>`
    : '\nSetup incomplete - fix the FAIL lines above and re-run.')
  process.exit(ok ? 0 : 1)
}

function usage(code = 0) {
  console.log(`${PKG.name}@${PKG.version}

Usage:
  npx ${PKG.name} setup                 install the agent skill and check prerequisites
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
  case 'setup': setup(); break
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
