// Shared helpers for the end-to-end tests. Everything runs against throwaway
// directories: a bare "origin", a working clone, and a fake home directory, so
// no test can touch the real machine's git config, skills or agent folders.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const CLI = join(ROOT, 'bin', 'cli.mjs')
export const SHORTHAND = join(ROOT, 'bin', 'hive-task.mjs')

export function tempDir(prefix) {
  return realpathSync(mkdtempSync(join(tmpdir(), `hive-e2e-${prefix}-`)))
}

export function cleanup(...dirs) {
  for (const d of dirs) rmSync(d, { recursive: true, force: true, maxRetries: 3 })
}

export function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${cwd}\n${r.stdout}\n${r.stderr}`)
  return r.stdout.trim()
}

export function gitOk(cwd, ...args) {
  return spawnSync('git', args, { cwd, encoding: 'utf8' }).status === 0
}

/**
 * A bare origin with `development` and `main`, plus a working clone checked out
 * on `development`. Returns { root, origin, work }.
 */
export function makeRepo() {
  const root = tempDir('repo')
  const origin = join(root, 'origin.git')
  const work = join(root, 'work')
  mkdirSync(origin)
  git(root, 'init', '--bare', '--initial-branch=development', origin)
  git(root, 'clone', '-q', origin, work)
  git(work, 'config', 'user.name', 'E2E Tester')
  git(work, 'config', 'user.email', 'e2e@example.invalid')
  git(work, 'config', 'commit.gpgsign', 'false')
  git(work, 'checkout', '-q', '-B', 'development')
  writeFileSync(join(work, 'README.md'), 'seed\n')
  git(work, 'add', 'README.md')
  git(work, 'commit', '-q', '-m', 'seed')
  git(work, 'push', '-q', 'origin', 'development')
  git(work, 'push', '-q', 'origin', 'development:refs/heads/main')
  return { root, origin, work }
}

/** Branch names on the bare origin. */
export function remoteBranches(origin) {
  return git(origin, 'for-each-ref', '--format=%(refname:short)', 'refs/heads').split('\n').filter(Boolean).sort()
}

/** Environment with no work-item credentials and a fake home directory. */
export function cleanEnv(home, extra = {}) {
  const env = { ...process.env }
  delete env.AZURE_DEVOPS_EXT_PAT
  delete env.CLAUDE_CONFIG_DIR
  env.HOME = home
  env.USERPROFILE = home
  return { ...env, ...extra }
}

export function runCli(args, { cwd = ROOT, home, env = {}, entry = CLI } = {}) {
  const r = spawnSync(process.execPath, [entry, ...args], {
    cwd,
    encoding: 'utf8',
    env: cleanEnv(home ?? tempDir('home-unused'), env),
    timeout: 120000,
  })
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

/** Absolute directory where hive-task.ps1 writes its draft files for a repo. */
export function draftDir(work) {
  return git(work, 'rev-parse', '--path-format=absolute', '--git-path', 'hive-task')
}
