// End-to-end tests for `hive-task-workflow start` (scripts/hive-task.ps1).
// Each test uses its own throwaway origin + clone. No network, no Azure DevOps.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SHORTHAND, cleanup, draftDir, git, gitOk, makeRepo, remoteBranches, runCli, tempDir } from './helpers.mjs'

const BRANCH = 'feat/4821-add-sso-only-login-toggle'
const ARGS = ['start', '4821', '-Type', 'feat', '-Title', 'Add the SSO-only login toggle', '-Scope', 'sso']

function withRepo(fn) {
  return async () => {
    const repo = makeRepo()
    const home = tempDir('home')
    try { await fn({ ...repo, home }) } finally { cleanup(repo.root, home) }
  }
}

test('start creates the branch from origin/development and writes the three drafts', withRepo(({ work, origin, home }) => {
  const r = runCli(ARGS, { cwd: work, home })
  assert.equal(r.status, 0, r.out)
  assert.match(r.out, new RegExp(`branch : ${BRANCH}`))
  assert.match(r.out, /base   : origin\/development/)
  assert.match(r.out, /commit : feat\(sso\): add the SSO-only login toggle/)

  assert.equal(git(work, 'branch', '--show-current'), BRANCH)
  assert.equal(git(work, 'rev-parse', 'HEAD'), git(work, 'rev-parse', 'origin/development'))

  const dir = draftDir(work)
  const key = BRANCH.replace('/', '__')
  const commit = readFileSync(join(dir, `${key}.commit.txt`), 'utf8')
  assert.equal(commit.split('\n')[0], 'feat(sso): add the SSO-only login toggle')
  assert.match(commit, /^AB#4821$/m)
  assert.equal(readFileSync(join(dir, `${key}.pr-title.txt`), 'utf8'), 'feat(sso): add the SSO-only login toggle')
  const pr = readFileSync(join(dir, `${key}.pr.md`), 'utf8')
  assert.match(pr, /AB#4821/)
  assert.match(pr, /## Scope audit/)
  assert.doesNotMatch(pr, /Claude Code/)
  assert.ok(!commit.includes('\r') && !pr.includes('\r'), 'drafts are written with LF line endings')
  assert.notEqual(readFileSync(join(dir, `${key}.commit.txt`))[0], 0xef, 'no UTF-8 BOM')

  // The script never pushes.
  assert.deepEqual(remoteBranches(origin), ['development', 'main'])
}))

test('start leaves the new branch without an upstream so a bare push cannot hit development', withRepo(({ work, home }) => {
  assert.equal(runCli(ARGS, { cwd: work, home }).status, 0)
  assert.equal(gitOk(work, 'config', '--get', `branch.${BRANCH}.remote`), false)
  assert.equal(gitOk(work, 'rev-parse', '--abbrev-ref', '@{upstream}'), false)
}))

test('start -WhatIf prints the plan and changes nothing', withRepo(({ work, home }) => {
  const r = runCli([...ARGS, '-WhatIf'], { cwd: work, home })
  assert.equal(r.status, 0, r.out)
  assert.match(r.out, new RegExp(`branch : ${BRANCH}`))
  assert.equal(git(work, 'branch', '--show-current'), 'development')
  assert.equal(gitOk(work, 'show-ref', '--verify', '--quiet', `refs/heads/${BRANCH}`), false)
  assert.equal(existsSync(join(draftDir(work), `${BRANCH.replace('/', '__')}.commit.txt`)), false)
}))

test('hive-task shorthand binary behaves like start', withRepo(({ work, home }) => {
  const r = runCli(ARGS.slice(1), { cwd: work, home, entry: SHORTHAND })
  assert.equal(r.status, 0, r.out)
  assert.equal(git(work, 'branch', '--show-current'), BRANCH)
}))

test('start noref builds a noref branch and omits the AB# footer', withRepo(({ work, home }) => {
  const r = runCli(['start', 'noref', '-Type', 'chore', '-Title', 'Drop tracked migrations', '-Scope', 'db'], { cwd: work, home })
  assert.equal(r.status, 0, r.out)
  assert.equal(git(work, 'branch', '--show-current'), 'chore/noref-drop-tracked-migrations')
  const commit = readFileSync(join(draftDir(work), 'chore__noref-drop-tracked-migrations.commit.txt'), 'utf8')
  assert.equal(commit.split('\n')[0], 'chore(db): drop tracked migrations')
  assert.doesNotMatch(commit, /^AB#/m)
}))

test('start -Desc overrides the title-derived slug', withRepo(({ work, home }) => {
  const r = runCli(['start', '4821', '-Type', 'fix', '-Title', 'Anything at all here', '-Desc', 'expire-card', '-Scope', 'db'], { cwd: work, home })
  assert.equal(r.status, 0, r.out)
  assert.equal(git(work, 'branch', '--show-current'), 'fix/4821-expire-card')
}))

test('start refuses uncommitted tracked changes and creates no branch', withRepo(({ work, home }) => {
  writeFileSync(join(work, 'README.md'), 'edited\n')
  const r = runCli(ARGS, { cwd: work, home })
  assert.equal(r.status, 1)
  assert.match(r.out, /uncommitted tracked changes/)
  assert.equal(git(work, 'branch', '--show-current'), 'development')
  assert.equal(gitOk(work, 'show-ref', '--verify', '--quiet', `refs/heads/${BRANCH}`), false)
}))

test('start allows untracked files and says so', withRepo(({ work, home }) => {
  writeFileSync(join(work, 'scratch.txt'), 'x\n')
  const r = runCli(ARGS, { cwd: work, home })
  assert.equal(r.status, 0, r.out)
  assert.match(r.out, /untracked files present/)
}))

test('start refuses a branch that already exists', withRepo(({ work, home }) => {
  assert.equal(runCli(ARGS, { cwd: work, home }).status, 0)
  git(work, 'switch', 'development')
  const r = runCli(ARGS, { cwd: work, home })
  assert.equal(r.status, 1)
  assert.match(r.out, /already exists/)
}))

test('start refuses to re-cut an existing branch as -vN', withRepo(({ work, home }) => {
  assert.equal(runCli(['start', '4821', '-Type', 'feat', '-Desc', 'sso-toggle', '-Scope', 'sso'], { cwd: work, home }).status, 0)
  git(work, 'switch', 'development')
  const r = runCli(['start', '4821', '-Type', 'feat', '-Desc', 'sso-toggle-v2', '-Scope', 'sso'], { cwd: work, home })
  assert.equal(r.status, 1)
  assert.match(r.out, /re-cuts existing branch/)
}))

test('start refuses a base other than development unless explicitly allowed', withRepo(({ work, home }) => {
  const refused = runCli([...ARGS, '-Base', 'main'], { cwd: work, home })
  assert.equal(refused.status, 1)
  assert.match(refused.out, /not the integration branch/)
  assert.equal(git(work, 'branch', '--show-current'), 'development')

  const allowed = runCli([...ARGS, '-Base', 'main', '-AllowNonDevelopmentBase'], { cwd: work, home })
  assert.equal(allowed.status, 0, allowed.out)
  assert.match(allowed.out, /base   : origin\/main/)
}))

test('start refuses a base that is not on origin', withRepo(({ work, home }) => {
  const r = runCli([...ARGS, '-Base', 'nope'], { cwd: work, home })
  assert.equal(r.status, 1)
  assert.match(r.out, /not on origin/)
}))

test('start without a scope stops and lists the known scopes', withRepo(({ work, home }) => {
  const r = runCli(['start', '4821', '-Type', 'feat', '-Title', 'Add the SSO-only login toggle'], { cwd: work, home })
  assert.equal(r.status, 1)
  assert.match(r.out, /no commit scope/)
  assert.match(r.out, /sso, migrator, bot-connector, contacts, db, nps/)
}))

test('start cannot decide a type without -Type or a readable work item', withRepo(({ work, home }) => {
  const r = runCli(['start', '4821', '-Title', 'Add the SSO-only login toggle', '-Scope', 'sso'], { cwd: work, home })
  assert.equal(r.status, 1)
  assert.match(r.out, /cannot decide the branch type/)
}))

test('start rejects a title that is too short for a 2-5 word description', withRepo(({ work, home }) => {
  const r = runCli(['start', '4821', '-Type', 'feat', '-Title', 'Login', '-Scope', 'sso'], { cwd: work, home })
  assert.equal(r.status, 1)
  assert.match(r.out, /too short/)
}))

test('start rejects a reserved branch shape and an over-long description', withRepo(({ work, home }) => {
  const r = runCli(['start', '4821', '-Type', 'feat', '-Desc', 'one-two-three-four-five-six', '-Scope', 'sso'], { cwd: work, home })
  assert.equal(r.status, 1)
  assert.match(r.out, /must be 2-5/)
}))

test('start reports an unreachable origin without creating a branch', withRepo(({ work, root, home }) => {
  git(work, 'remote', 'set-url', 'origin', join(root, 'does-not-exist.git'))
  const r = runCli(ARGS, { cwd: work, home })
  assert.equal(r.status, 1)
  assert.match(r.out, /cannot reach origin/)
  assert.equal(git(work, 'branch', '--show-current'), 'development')
}))

test('start outside a git repo fails with a clear message', () => {
  const dir = tempDir('norepo')
  const home = tempDir('home')
  try {
    const r = runCli(ARGS, { cwd: dir, home })
    assert.equal(r.status, 1)
    assert.match(r.out, /not inside a git repo/)
  } finally { cleanup(dir, home) }
})

test('start validates the work-item id before launching PowerShell', () => {
  const r = runCli(['start', 'abc'])
  assert.equal(r.status, 1)
  assert.match(r.out, /missing work-item id/)
})

test('start writes drafts per branch, so two tasks do not overwrite each other', withRepo(({ work, home }) => {
  assert.equal(runCli(ARGS, { cwd: work, home }).status, 0)
  git(work, 'switch', 'development')
  assert.equal(runCli(['start', '4790', '-Type', 'fix', '-Title', 'Expire the card', '-Scope', 'db'], { cwd: work, home }).status, 0)
  const files = readdirSync(draftDir(work)).sort()
  assert.equal(files.length, 6)
}))
