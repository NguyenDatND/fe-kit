#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { UsageError } from '../src/lib/errors.mjs'

const kitRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const AVAILABLE = ['context', 'init', 'validate', 'scan', 'rules', 'test', 'verify', 'auth', 'ui', 'dev', 'ui-act', 'link', 'unlink', 'doctor']
const PLANNED = ['mr', 'mcp', 'mcp-run', 'secrets']

const HELP = `fe-kit: frontend kit for Claude Code, Codex and Antigravity

Usage: fe-kit <command> [options] [--json]

Commands:
  context    project root, matching profile, stack and commands from package.json
  init       create .fe-kit/ in the project and link AGENTS.md to CLAUDE.md
  validate   check the kit's skills
  scan       rule checks on the lines this work adds (any, innerHTML, console.log, ...)
  rules      which standards documents apply to the files you are about to change
  test       run the tests in .fe-kit/tests with the project's own vitest or jest
  verify     scan, lint, type-check, project tests and local tests, with a report
  auth       save a login for a role (you log in once, in a browser window) and check it
  ui         look at the target in a browser: pictures, console errors, failed requests, steps
  dev        start, stop and check the dev server of a target, in the background
  ui-act     like ui, but lets one write request through, after you type yes at the terminal
  link       put the skills and shell-guard into Claude Code, Codex and Antigravity (dry run unless --yes)
  unlink     take out exactly what link added
  doctor     check the kit, what link installed, the guard hook, saved logins, secrets in config files

Not implemented yet: ${PLANNED.join(', ')}

Exit codes: 0 ok, 1 problems found, 2 usage error, 3 saved login gone (ui), 70 unexpected failure.
`

async function main(argv) {
  const [first, ...rest] = argv

  if (first === undefined || first === '--help' || first === '-h' || first === 'help') {
    process.stdout.write(HELP)
    return 0
  }
  if (first === '--version' || first === '-v') {
    const { version } = JSON.parse(await readFile(join(kitRoot, 'package.json'), 'utf8'))
    process.stdout.write(`${version}\n`)
    return 0
  }
  if (PLANNED.includes(first)) {
    process.stderr.write(`fe-kit ${first} is not implemented yet\n`)
    return 2
  }
  if (!AVAILABLE.includes(first)) {
    process.stderr.write(`unknown command: ${first}\n\n${HELP}`)
    return 2
  }

  const command = await import(`../src/commands/${first}.mjs`)
  // Whoever is unsure how to call a command asks it with --help (arguments after -- are not options).
  const options = rest.slice(0, rest.includes('--') ? rest.indexOf('--') : rest.length)
  if (options.includes('--help') || options.includes('-h')) {
    process.stdout.write(command.usage ?? HELP)
    return 0
  }
  let parsed
  try {
    parsed = parseArgs({ args: rest, options: { json: { type: 'boolean' }, ...command.options }, allowPositionals: true })
  } catch (error) {
    process.stderr.write(`fe-kit ${first}: ${error.message}\n`)
    return 2
  }

  const result = await command.run({
    args: parsed.positionals,
    flags: parsed.values,
    cwd: process.cwd(),
    env: process.env,
    kitRoot,
  })
  process.stdout.write(parsed.values.json ? `${JSON.stringify(result.data, null, 2)}\n` : result.text)
  return result.exitCode ?? 0
}

// 70 is EX_SOFTWARE. It stays clear of 1 (problems found) and 3 (reserved for an expired session in `ui`).
const UNEXPECTED_FAILURE = 70
const USAGE_ERROR = 2

try {
  process.exitCode = await main(process.argv.slice(2))
} catch (error) {
  if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify({ error: error.message }, null, 2)}\n`)
  process.stderr.write(`fe-kit: ${error.message}\n`)
  process.exitCode = error instanceof UsageError ? USAGE_ERROR : UNEXPECTED_FAILURE
}
