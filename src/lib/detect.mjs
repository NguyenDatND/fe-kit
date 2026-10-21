import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { exists } from './fsx.mjs'

const LOCKFILES = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['package-lock.json', 'npm'],
]
// First match wins: specific meta-frameworks come before the generic build tool.
const FRAMEWORKS = [
  ['next', 'next'],
  ['nuxt', 'nuxt'],
  ['@remix-run/react', 'remix'],
  ['astro', 'astro'],
  ['@sveltejs/kit', 'sveltekit'],
  ['@angular/cli', 'angular-cli'],
  ['react-scripts', 'cra'],
  ['vite', 'vite'],
]
/** The framework names `detectStack` can report. A reference document that names one is matched against it. */
export const FRAMEWORK_NAMES = FRAMEWORKS.map(([, name]) => name)
const UI_LIBRARIES = [
  ['@angular/core', 'angular'],
  ['react', 'react'],
  ['vue', 'vue'],
  ['svelte', 'svelte'],
]
const TEST_RUNNERS = [
  ['vitest', 'vitest'],
  ['jest', 'jest'],
  ['mocha', 'mocha'],
]
const MONOREPO_FILES = [
  ['turbo.json', 'turbo'],
  ['nx.json', 'nx'],
  ['lerna.json', 'lerna'],
]
// Which package.json scripts count as which command, in order of preference.
const COMMAND_SCRIPTS = {
  dev: ['dev', 'start'],
  build: ['build'],
  lint: ['lint'],
  typecheck: ['typecheck', 'type-check', 'check-types', 'check:types', 'tsc'],
  test: ['test'],
}

/** The commands `context` reports and a profile may override. */
export const COMMAND_NAMES = Object.keys(COMMAND_SCRIPTS)

const pick = (dependencies, table) => table.find(([name]) => name in dependencies)?.[1] ?? null

// package.json is hand-written: a field of the wrong type is ignored rather than allowed to crash detection.
const plainObject = (value) => (value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {})
const strings = (value) => (Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [])
const stringValues = (value) => Object.fromEntries(Object.entries(plainObject(value)).filter(([, item]) => typeof item === 'string'))

function neutralStack() {
  return {
    packageManager: null,
    language: 'javascript',
    uiLibrary: null,
    framework: null,
    testRunner: null,
    monorepo: null,
    scripts: {},
  }
}

async function readPackageJson(dir) {
  let text
  try {
    text = await readFile(join(dir, 'package.json'), 'utf8')
  } catch {
    return { error: 'package.json not found' }
  }
  let json
  try {
    json = JSON.parse(text)
  } catch (error) {
    return { error: `package.json is not valid JSON: ${error.message}` }
  }
  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    return { error: 'package.json must contain a JSON object' }
  }
  return { json }
}

const declaredManager = (json) =>
  (typeof json?.packageManager === 'string' ? /^(npm|pnpm|yarn|bun)@/.exec(json.packageManager)?.[1] : undefined) ?? null

/** A declared `packageManager` (corepack) wins over a lockfile, and the package's own over the project root's. */
async function detectPackageManager(json, projectJson, dirs) {
  const declared = declaredManager(json) ?? declaredManager(projectJson)
  if (declared) return declared
  for (const dir of dirs) {
    for (const [file, name] of LOCKFILES) {
      if (await exists(join(dir, file))) return name
    }
  }
  return null
}

async function detectMonorepo(dirs) {
  const tools = []
  let workspaces = []
  for (const dir of dirs) {
    try {
      const pnpmWorkspace = parseYaml(await readFile(join(dir, 'pnpm-workspace.yaml'), 'utf8'))
      tools.push('pnpm-workspaces')
      workspaces = strings(pnpmWorkspace?.packages)
    } catch {
      // no pnpm-workspace.yaml, or one that is not valid YAML
    }
    const { json } = await readPackageJson(dir)
    const declared = Array.isArray(json?.workspaces) ? json.workspaces : json?.workspaces?.packages
    if (Array.isArray(declared)) {
      tools.push('workspaces')
      workspaces = strings(declared)
    }
    for (const [file, tool] of MONOREPO_FILES) {
      if (await exists(join(dir, file))) tools.push(tool)
    }
  }
  return tools.length > 0 ? { tools: [...new Set(tools)], workspaces } : null
}

/**
 * Reads the stack from the nearest package.json. `projectRoot` is searched too for the lockfile and
 * for monorepo markers, because a sub-package usually has neither.
 */
export async function detectStack(packageRoot, { projectRoot = packageRoot } = {}) {
  const { json, error } = await readPackageJson(packageRoot)
  if (error) return { ...neutralStack(), error }

  const dirs = [...new Set([packageRoot, projectRoot])]
  const dependencies = { ...plainObject(json.dependencies), ...plainObject(json.devDependencies) }
  const projectJson = projectRoot === packageRoot ? json : (await readPackageJson(projectRoot)).json
  const hasTsconfig = (await Promise.all(dirs.map((dir) => exists(join(dir, 'tsconfig.json'))))).some(Boolean)

  return {
    packageManager: await detectPackageManager(json, projectJson, dirs),
    language: 'typescript' in dependencies || hasTsconfig ? 'typescript' : 'javascript',
    uiLibrary: pick(dependencies, UI_LIBRARIES),
    framework: pick(dependencies, FRAMEWORKS),
    testRunner: pick(dependencies, TEST_RUNNERS),
    monorepo: await detectMonorepo([...new Set([projectRoot, packageRoot])]),
    scripts: stringValues(json.scripts),
  }
}

export function scriptCommand(packageManager, script) {
  return `${packageManager ?? 'npm'} run ${script}`
}

/** Commands come from package.json scripts only; a command that has no script is null, never guessed. */
export function deriveCommands({ packageManager, scripts }) {
  return Object.fromEntries(
    Object.entries(COMMAND_SCRIPTS).map(([name, candidates]) => {
      const script = candidates.find((candidate) => candidate in scripts)
      return [name, script ? scriptCommand(packageManager, script) : null]
    }),
  )
}
