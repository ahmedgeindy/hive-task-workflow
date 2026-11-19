// End-to-end tests for `setup` and `remove`. HOME / USERPROFILE point at a
// throwaway directory, so nothing is installed into the real agent folders.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, git, makeRepo, runCli, tempDir } from './helpers.mjs'

const NAME = 'hive-task-workflow'
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

function withHome(fn) {
  return async () => {
    const home = tempDir('home')
    try { await fn(home) } finally { cleanup(home) }
  }
}

const skillDir = (home, ...parts) => join(home, ...parts, NAME)

test('setup --agent claude installs the skill, marker and bundled tests pass', withHome((home) => {
  const r = runCli(['setup', '--agent', 'claude'], { home })
  assert.equal(r.status, 0, r.out)
  assert.match(r.out, /bundled unit tests pass/)
  const dir = skillDir(home, '.claude', 'skills')
  assert.ok(existsSync(join(dir, 'SKILL.md')))
  assert.ok(existsSync(join(dir, 'scripts', 'hive-task.ps1')))
  assert.ok(existsSync(join(dir, 'scripts', 'HiveTask.psm1')))
  assert.ok(existsSync(join(dir, 'docs', 'TEAM-GIT-WORKFLOW.md')))
  assert.equal(readFileSync(join(dir, '.installed-by'), 'utf8').trim(), `${pkg.name}@${pkg.version}`)
}))

test('agents that share ~/.agents/skills get one copy', withHome((home) => {
  const r = runCli(['setup', '--agent', 'codex,cursor,gemini'], { home })
  assert.equal(r.status, 0, r.out)
  assert.ok(existsSync(join(skillDir(home, '.agents', 'skills'), 'SKILL.md')))
  assert.match(r.out, /\[OpenAI Codex CLI, Cursor, Gemini CLI\]/)
  assert.equal(existsSync(skillDir(home, '.claude', 'skills')), false)
}))

test('setup honours CLAUDE_CONFIG_DIR for Claude Code', withHome((home) => {
  const custom = join(home, 'custom-claude')
  const r = runCli(['setup', '--agent', 'claude'], { home, env: { CLAUDE_CONFIG_DIR: custom } })
  assert.equal(r.status, 0, r.out)
  assert.ok(existsSync(join(custom, 'skills', NAME, 'SKILL.md')))
  assert.equal(existsSync(skillDir(home, '.claude', 'skills')), false)
}))

test('setup is safe to run twice and replaces stale files', withHome((home) => {
  assert.equal(runCli(['setup', '--agent', 'claude'], { home }).status, 0)
  const dir = skillDir(home, '.claude', 'skills')
  writeFileSync(join(dir, 'stale.txt'), 'old\n')
  const again = runCli(['setup', '--agent', 'claude'], { home })
  assert.equal(again.status, 0, again.out)
  assert.equal(existsSync(join(dir, 'stale.txt')), false)
  assert.ok(existsSync(join(dir, '.installed-by')))
}))

test('setup refuses a folder it did not install and leaves it untouched', withHome((home) => {
  const dir = skillDir(home, '.claude', 'skills')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'mine.txt'), 'keep me\n')
  const r = runCli(['setup', '--agent', 'claude'], { home })
  assert.equal(r.status, 1)
  assert.match(r.out, /was not installed by/)
  assert.equal(readFileSync(join(dir, 'mine.txt'), 'utf8'), 'keep me\n')
  assert.equal(existsSync(join(dir, 'SKILL.md')), false)
}))

test('setup rejects an unknown agent id', withHome((home) => {
  const r = runCli(['setup', '--agent', 'notanagent'], { home })
  assert.equal(r.status, 1)
  assert.match(r.out, /unknown agent: notanagent/)
}))

test('setup with no agent flag and no detected agent fails with guidance (non-interactive)', withHome((home) => {
  const r = runCli(['setup'], { home })
  assert.equal(r.status, 1)
  assert.match(r.out, /no AI agent detected/)
}))

test('setup with no agent flag installs into detected agents only (non-interactive)', withHome((home) => {
  mkdirSync(join(home, '.kiro'), { recursive: true })
  const r = runCli(['setup'], { home })
  assert.equal(r.status, 0, r.out)
  assert.ok(existsSync(join(skillDir(home, '.kiro', 'skills'), 'SKILL.md')))
  assert.equal(existsSync(skillDir(home, '.claude', 'skills')), false)
}))

test('remove deletes only installs that carry the marker', withHome((home) => {
  assert.equal(runCli(['setup', '--agent', 'claude,kiro'], { home }).status, 0)
  // Make the kiro copy look foreign.
  const kiro = skillDir(home, '.kiro', 'skills')
  rmSync(join(kiro, '.installed-by'))
  const r = runCli(['remove', '--agent', 'claude,kiro'], { home })
  assert.equal(r.status, 0, r.out)
  assert.equal(existsSync(skillDir(home, '.claude', 'skills')), false)
  assert.match(r.out, /SKIP .*not installed by/)
  assert.ok(existsSync(kiro), 'foreign folder is left alone')
}))

test('remove with nothing installed says so', withHome((home) => {
  const r = runCli(['remove', '--agent', 'claude'], { home })
  assert.equal(r.status, 0, r.out)
  assert.match(r.out, /Nothing to remove/)
}))

test('setup --project / remove --project write and delete the repo-level skill folders', withHome((home) => {
  const repo = makeRepo()
  try {
    const r = runCli(['setup', '--project'], { cwd: repo.work, home })
    assert.equal(r.status, 0, r.out)
    assert.ok(existsSync(join(repo.work, '.agents', 'skills', NAME, 'SKILL.md')))
    assert.ok(existsSync(join(repo.work, '.claude', 'skills', NAME, 'SKILL.md')))
    assert.equal(existsSync(skillDir(home, '.claude', 'skills')), false, 'user-level folders untouched')

    const rm = runCli(['remove', '--project'], { cwd: repo.work, home })
    assert.equal(rm.status, 0, rm.out)
    assert.equal(existsSync(join(repo.work, '.agents', 'skills', NAME)), false)
    assert.equal(existsSync(join(repo.work, '.claude', 'skills', NAME)), false)
  } finally { cleanup(repo.root) }
}))

test('setup --project outside a git repo fails', withHome((home) => {
  const dir = tempDir('norepo')
  try {
    const r = runCli(['setup', '--project'], { cwd: dir, home })
    assert.equal(r.status, 1)
    assert.match(r.out, /--project needs a git repo/)
  } finally { cleanup(dir) }
}))

test('the installed copy of hive-task.ps1 runs a task end to end', withHome((home) => {
  assert.equal(runCli(['setup', '--agent', 'claude'], { home }).status, 0)
  const installed = join(skillDir(home, '.claude', 'skills'), 'scripts', 'hive-task.ps1')
  const repo = makeRepo()
  try {
    const exe = process.platform === 'win32' ? 'powershell.exe' : 'pwsh'
    const r = spawnSync(exe, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', installed,
      '4821', '-Type', 'feat', '-Title', 'Add the SSO-only login toggle', '-Scope', 'sso'],
    { cwd: repo.work, encoding: 'utf8' })
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`)
    assert.equal(git(repo.work, 'branch', '--show-current'), 'feat/4821-add-sso-only-login-toggle')
  } finally { cleanup(repo.root) }
}))

test('guide, help and version commands work', () => {
  assert.match(runCli(['guide']).out, /HiveCFM Team Git Workflow/)
  assert.match(runCli(['--help']).out, /Usage:/)
  assert.equal(runCli(['--version']).out.trim(), pkg.version)
  const bad = runCli(['bogus'])
  assert.equal(bad.status, 2)
  assert.match(bad.out, /unknown command: bogus/)
})
