import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveProject } from '../src/lib/project.mjs'
import { makeGitRepo, tempDir, writeTree } from './helpers.mjs'

const kitRoot = fileURLToPath(new URL('..', import.meta.url))

// Stands in for the project's own vitest: it reports how it was called, so that the wiring can be checked without installing one.
const FAKE_VITEST = `#!/usr/bin/env node
const { readFileSync } = require('node:fs')
if (process.env.FAKE_PROJECTS) {
  console.error('Error: fe-kit: vitest projects are not supported by local tests yet')
  process.exit(1)
}
if (process.env.FAKE_HANG) {
  process.on('SIGTERM', () => process.exit(0)) // stops when asked, and says it succeeded
  setInterval(() => {}, 1000)
} else {
const args = process.argv.slice(2)
const config = args.includes('--config') ? readFileSync(args[args.indexOf('--config') + 1], 'utf8') : null
console.log(JSON.stringify({ cwd: process.cwd(), args, config, ci: process.env.CI }))
process.exit(Number(process.env.FAKE_EXIT ?? 0))
}
`

// Stands in for the project's own jest: `--showConfig` prints a configuration (and a warning on stderr), anything else reports the call.
const FAKE_JEST = `#!/usr/bin/env node
const args = process.argv.slice(2)
if (args.includes('--showConfig')) {
  process.stderr.write('{ a warning in braces that is not part of the JSON }\\n')
  const fallback = { configs: [{ rootDir: process.cwd(), roots: [process.cwd() + '/src'], testRegex: [], testPathIgnorePatterns: ['/node_modules/'] }] }
  process.stdout.write((process.env.FAKE_SHOWCONFIG ?? JSON.stringify(fallback, null, 2)) + '\\n')
  process.exit(Number(process.env.FAKE_SHOWCONFIG_EXIT ?? 0))
}
console.log(JSON.stringify({ jest: args, cwd: process.cwd(), ci: process.env.CI }))
process.exit(Number(process.env.EXIT_JEST ?? 0))
`

/**
 * A project with local tests in `.fe-kit/tests`, a fake test runner (vitest, or jest with `runner: 'jest'`) and, for
 * vitest, a vite config. `packageDir` puts package.json (and
 * the config) below the project root, the way a monorepo does; the fake vitest then sits at the root, hoisted.
 */
export async function localProject(t, { runner = 'vitest', packageDir = '', dependencies = { [runner]: '5.0.0' }, tests = { 'a.test.ts': 'x', 'sub/b.spec.tsx': 'x' }, gitignore = '*\n', bin = true, binAbove = false, config = runner === 'vitest' ? 'vite.config.ts' : null, extra = {} } = {}) {
  const outer = await tempDir(t)
  const dir = binAbove ? join(outer, 'project') : outer
  await mkdir(dir, { recursive: true })
  const at = (path) => join(packageDir, path)
  const files = { [at('package.json')]: JSON.stringify({ devDependencies: dependencies }), ...extra }
  if (config) files[at(config)] = 'export default {}\n'
  if (gitignore !== null) files['.fe-kit/.gitignore'] = gitignore
  for (const [name, text] of Object.entries(tests)) files[`.fe-kit/tests/${name}`] = text
  await writeTree(dir, files)
  await makeGitRepo(dir)
  if (bin) {
    const home = binAbove ? outer : dir // `binAbove`: where a stray install outside the project would be
    await mkdir(join(home, 'node_modules/.bin'), { recursive: true })
    await writeFile(join(home, `node_modules/.bin/${runner}`), runner === 'jest' ? FAKE_JEST : FAKE_VITEST)
    await chmod(join(home, `node_modules/.bin/${runner}`), 0o755)
  }
  const project = await resolveProject({ cwd: join(dir, packageDir), env: { HOME: await tempDir(t), FE_KIT_PROFILES_DIR: await tempDir(t) }, kitRoot })
  return { dir, project }
}
export const reported = (result) => JSON.parse(result.output)

