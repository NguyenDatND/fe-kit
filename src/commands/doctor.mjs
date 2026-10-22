import { spawn } from 'node:child_process'
import { access, readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { sessionStatus } from '../lib/auth-store.mjs'
import { loadPlaywright } from '../lib/browser.mjs'
import { readTextIfExists } from '../lib/config-files.mjs'
import { draftsAreReady } from '../lib/drafts.mjs'
import { runFile } from '../lib/exec.mjs'
import { ConfigProblem } from '../lib/guard-config.mjs'
import { buildPlan, chooseTools, homeOf, readState, stateDirOf } from '../lib/install.mjs'
import { resolveProject } from '../lib/project.mjs'
import { getTarget, TOOLS } from '../lib/tools.mjs'

export const options = {}

export const usage = `Usage: fe-kit doctor [--json]

Checks the kit and the machine: node and playwright, what "fe-kit link" put into each tool (and that it is still there), that
the guard hook starts and answers the way the tools expect, saved logins that are about to end or are not safe, whether the
files of the tools hold a secret, the profile of the project you are in, and the versions of the tools. Nothing is changed.
What is not decided or not checked by hand is listed as pending. Exit code: 0 ok, 1 a problem was found.
`

const SOON_MS = 2 * 86_400_000
const HOOK_WAIT_MS = 8000
const SECRET_PATTERNS = [
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}/],
  ['GitLab token', /\bglpat-[A-Za-z0-9_-]{20,}/],
  ['Figma key', /\bfigd_[A-Za-z0-9_-]{20,}/],
  ['AWS key id', /\bAKIA[0-9A-Z]{16}\b/],
  ['API key', /\bsk-[A-Za-z0-9_-]{20,}/],
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['Bearer token', /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/],
  ['secret in a JSON member', /"(?:password|passwd|api_?key|secret|token)"\s*:\s*"[^"\s]{8,}"/i],
]
const CLI_NAMES = { claude: 'claude', codex: 'codex', antigravity: 'agy' }

/** The call of a tool's hook, as that tool sends it (see tests/fixtures/hooks). */
function sampleInput(tool, command, cwd) {
  if (tool === 'antigravity') return { toolCall: { name: 'run_command', args: { CommandLine: command, Cwd: cwd } } }
  return { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd, ...(tool === 'codex' ? { turn_id: 'doctor' } : {}) }
}

/** Starts the hook as the tools do and gives it `input` on stdin. `startError` when the program could not be started at all. */
function runHookSample({ node, hookPath, input, home }) {
  return new Promise((resolve) => {
    const child = spawn(node, [hookPath], { env: { ...process.env, HOME: home }, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve({ exitCode: null, stdout, stderr: 'no answer in time' })
    }, HOOK_WAIT_MS)
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ exitCode: null, stdout, stderr, startError: error.code ?? error.message })
    })
    child.on('close', (exitCode) => {
      clearTimeout(timer)
      resolve({ exitCode, stdout, stderr })
    })
    child.stdin.on('error', () => {})
    child.stdin.end(JSON.stringify(input))
  })
}

const denies = (tool, stdout) => {
  try {
    const answer = JSON.parse(stdout)
    return tool === 'antigravity' ? answer.decision === 'deny' : answer.hookSpecificOutput?.permissionDecision === 'deny'
  } catch {
    return false
  }
}

async function defaultVersions(env) {
  const versions = {}
  for (const [tool, program] of Object.entries(CLI_NAMES)) {
    const result = await runFile(program, ['--version'], { env, timeoutMs: 8000, stderr: 'discard' })
    versions[tool] = result.exitCode === 0 ? result.output.split('\n')[0].trim() || null : null
  }
  return versions
}

const exists = (path) => access(path).then(() => true, () => false)

export async function run({ cwd, env, kitRoot, deps = {} }) {
  const home = homeOf(env)
  const stateDir = stateDirOf(env)
  const now = deps.now?.() ?? Date.now()
  const show = (text) => text.replaceAll(home, '~')
  const checks = []
  const add = (id, status, message) => checks.push({ id, status, message: show(message) })

  // The program of the kit
  const nodeVersion = deps.nodeVersion ?? process.versions.node
  const major = Number(nodeVersion.split('.')[0])
  add('node', major >= 20 ? 'ok' : 'problem', major >= 20 ? `Node ${nodeVersion}` : `Node ${nodeVersion} is too old: fe-kit needs 20 or newer`)
  try {
    const playwright = await loadPlaywright(deps.importPlaywright)
    add('playwright', 'ok', 'playwright is installed')
    const executable = await Promise.resolve().then(() => playwright.chromium.executablePath()).catch(() => null)
    if (executable !== null && (await exists(executable))) add('chromium', 'ok', 'Chromium for playwright is downloaded')
    else add('chromium', 'pending', 'Chromium for playwright is not downloaded: run `npx playwright install chromium` in the fe-kit folder (fe-kit ui needs it)')
  } catch (error) {
    add('playwright', 'problem', error.message)
  }

  // What link put into each tool
  let state = null
  try {
    state = await readState(stateDir)
  } catch (error) {
    add('install', 'problem', error instanceof ConfigProblem ? error.message : `the record of what fe-kit installed cannot be read (${error.code ?? error.message})`)
  }
  if (state !== null) {
    const { tools: present } = await chooseTools(undefined, home)
    const node = state.node ?? deps.node ?? process.execPath
    for (const tool of Object.keys(TOOLS)) {
      const { label } = getTarget(tool)
      const recorded = state.tools[tool]
      if (recorded === undefined) {
        if (present.includes(tool)) add(`tool:${tool}`, 'pending', `${label} is not linked: run \`fe-kit link --yes\` (without --yes it only shows what it would do)`)
        else add(`tool:${tool}`, 'info', `${label} is not on this machine (its folder is missing)`)
        continue
      }
      const plan = await buildPlan({ kitRoot: state.kitRoot ?? kitRoot, home, env, node, tools: [tool], mode: recorded.mode })
      const entry = plan.tools[tool]
      const drift = [...entry.skills, ...entry.files].filter((item) => item.action !== 'unchanged').length
      if (plan.problems.length > 0) add(`tool:${tool}`, 'problem', `${label}: ${plan.problems.map(({ file, message }) => `${file}: ${message}`).join('; ')}`)
      else if (drift > 0) add(`tool:${tool}`, 'problem', `${label} has lost ${drift} of what fe-kit linked: run \`fe-kit link --yes\` to put it back`)
      else add(`tool:${tool}`, 'ok', `${label}: skills linked and the guard is in place`)
      if (plan.problems.length === 0 && drift === 0) {
        const hookPath = join(state.kitRoot ?? kitRoot, 'hooks', 'shell-guard.mjs')
        const runHook = deps.runHook ?? runHookSample
        const call = (command) => runHook({ node, hookPath, input: sampleInput(tool, command, home), home })
        const allowed = await call('echo fe-kit-doctor')
        const refused = await call('cat ~/.config/fe-kit/env')
        if (allowed.startError !== undefined) add(`hook:${tool}`, 'problem', `${label}: the hook could not be started with ${node} (${allowed.startError})`)
        else if (allowed.exitCode !== 0 || allowed.stdout !== '' || !denies(tool, refused.stdout) || refused.exitCode !== 0) add(`hook:${tool}`, 'problem', `${label}: the hook did not answer as expected (it must say nothing for \`echo\` and refuse a read of the secrets folder)`)
        else add(`hook:${tool}`, 'ok', `${label}: the hook starts, lets a plain command pass and refuses a read of the secrets folder`)
        const found = []
        for (const item of entry.files) {
          const text = (await readTextIfExists(item.file).catch(() => null)) ?? ''
          const kinds = SECRET_PATTERNS.filter(([, pattern]) => pattern.test(text.slice(0, 1_000_000))).map(([kind]) => kind)
          if (kinds.length > 0) found.push(`${item.file} (${kinds.join(', ')})`)
        }
        if (found.length > 0) add(`secrets:${tool}`, 'problem', `${label}: a secret seems to be in ${found.join('; ')}: move it out of the file (fe-kit never prints it)`)
        else add(`secrets:${tool}`, 'ok', `${label}: no secret found in the files the guard is in`)
        if (tool === 'codex') add('checklist:codex', 'info', 'Codex: open /hooks in Codex and approve the fe-kit hook (Codex asks once, and it cannot be checked from here)')
      }
    }
  }

  // Saved logins
  const authDir = join(stateDir, 'auth')
  for (const profile of await readdir(authDir).catch(() => [])) {
    for (const file of (await readdir(join(authDir, profile)).catch(() => [])).filter((name) => name.endsWith('.json')).sort()) {
      const name = basename(file, '.json')
      const [target, role] = [name.slice(0, name.indexOf('.')), name.slice(name.indexOf('.') + 1)]
      const saved = await sessionStatus(join(authDir, profile, file))
      const id = `session:${profile}/${name}`
      const login = `run \`fe-kit auth login --target ${target} --role ${role}\``
      if (saved.state !== 'present') add(id, 'problem', `saved login ${profile}/${name}: ${saved.problem ?? 'it is not a saved login'}; remove it and ${login}`)
      else if (saved.expiresAt !== null && Date.parse(saved.expiresAt) < now) add(id, 'warn', `saved login ${profile}/${name} ended on ${saved.expiresAt.slice(0, 10)}: ${login}`)
      else if (saved.expiresAt !== null && Date.parse(saved.expiresAt) - now < SOON_MS) add(id, 'warn', `saved login ${profile}/${name} ends on ${saved.expiresAt.slice(0, 16).replace('T', ' ')} UTC: ${login}`)
      else add(id, 'ok', `saved login ${profile}/${name}${saved.expiresAt === null ? '' : ` is good until ${saved.expiresAt.slice(0, 10)}`}`)
    }
  }

  // The project the command was started in
  try {
    const project = await resolveProject({ cwd, env, kitRoot })
    if (!project.isGit) add('project', 'info', 'not inside a git project: no profile to look for')
    else {
      const name = project.matched === null ? null : (project.settings.name ?? basename(project.matched.file))
      if (name === null) add('project', 'info', `${project.projectRoot}: no profile matches this project (run /fe-setup to make one)`)
      else add('project', 'ok', `${project.projectRoot}: profile ${name}`)
      add('drafts', (await draftsAreReady(project.projectRoot)) ? 'ok' : 'pending', (await draftsAreReady(project.projectRoot)) ? '.fe-kit/ is ready and hidden from git' : '.fe-kit/ is not ready: run `fe-kit init` in the project')
    }
    // What is said about package.json is for the commands that read it; here only the profiles are the kit's business.
    for (const [index, warning] of project.warnings.filter((text) => text.startsWith('Profile')).entries()) add(`profile-warning:${index}`, 'warn', warning)
  } catch (error) {
    add('project', 'info', `the project could not be looked at (${error.message})`)
  }

  // The tools themselves
  const versions = await (deps.versions ?? (() => defaultVersions(env)))()
  for (const tool of Object.keys(TOOLS)) {
    const { label } = getTarget(tool)
    if (versions[tool]) add(`version:${tool}`, 'info', `${label}: ${versions[tool]}`)
    else add(`version:${tool}`, 'info', `${label}: not found on the PATH`)
  }

  // What waits for the person
  add('pending:rules', 'pending', 'rules (fe-kit-core, personal-core) are not installed: they wait until you have read rules/personal-core.md and rules/fe-kit-core.md')
  add('pending:superpowers', 'pending', 'superpowers for Codex and Antigravity is not checked: which source each surface uses is decision S14 in docs/spike.md, and yours')
  add('pending:gui', 'pending', 'the IDE extensions and desktop apps of the three tools have not been checked by hand (docs/spike.md section 5)')

  const count = (status) => checks.filter((entry) => entry.status === status).length
  const label = { ok: 'ok     ', info: 'info   ', pending: 'pending', warn: 'warning', problem: 'PROBLEM' }
  const lines = checks.map((entry) => `${label[entry.status]} ${entry.message}`)
  lines.push('', `${count('problem')} problem${count('problem') === 1 ? '' : 's'}, ${count('warn')} warning${count('warn') === 1 ? '' : 's'}, ${count('pending')} pending`)
  return { data: { checks }, text: `${lines.join('\n')}\n`, exitCode: count('problem') > 0 ? 1 : 0 }
}
