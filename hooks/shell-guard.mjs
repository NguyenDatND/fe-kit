#!/usr/bin/env node
// The hook the tools run before a shell command or a file read: asks before commits, pushes and the commands of
// fe-kit that change things, and refuses what would read the folders of saved logins and secrets. It only starts
// the supervisor (see src/lib/hook-supervisor.mjs); it uses nothing of the kit but that, so it can still block when
// the rest of the kit is broken.
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
let result
try {
  const { supervise } = await import('../src/lib/hook-supervisor.mjs')
  result = await supervise({ input: process.stdin, workerPath: join(here, 'shell-guard-worker.mjs') })
} catch {
  result = { exitCode: 2, stdout: '', stderr: 'fe-kit shell-guard: blocked because the guard could not start; run the command yourself in a terminal if you meant it\n' }
}
process.stdout.write(result.stdout, () => process.stderr.write(result.stderr, () => process.exit(result.exitCode)))
