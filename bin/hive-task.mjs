#!/usr/bin/env node
// `hive-task <id> [options]` == `hive-task-workflow start <id> [options]`.
// Help/version go to the CLI unchanged so they print usage instead of a PowerShell error.
const first = process.argv[2]
if (!['-h', '--help', 'help', '/?', '-v', '--version'].includes(first)) process.argv.splice(2, 0, 'start')
await import('./cli.mjs')
