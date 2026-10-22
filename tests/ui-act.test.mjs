import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { run as runUiAct } from '../src/commands/ui-act.mjs'
import { loadPlaywright } from '../src/lib/browser.mjs'
import { UsageError } from '../src/lib/errors.mjs'
import { saveSession, sessionPath } from '../src/lib/auth-store.mjs'
import { assertUiActEnabled, confirmOnTerminal, confirmUiAct } from '../src/lib/ui-act-gate.mjs'
import { PassThrough, Readable } from 'node:stream'
import { runUi } from '../src/lib/ui-runner.mjs'
import { parseViewports } from '../src/lib/ui-viewports.mjs'
import { loginState, startApp } from './ui-fixture.mjs'
import { makeGitRepo, tempDir, writeTree } from './helpers.mjs'

const kitRoot = fileURLToPath(new URL('..', import.meta.url))
const bin = join(kitRoot, 'bin/fe-kit.mjs')
const execFileAsync = promisify(execFile)

let playwright = null
let browser = null
let skipReason = false
try {
  playwright = await loadPlaywright()
  browser = await playwright.chromium.launch()
} catch (error) {
  skipReason = `Chromium could not be started: ${error.message.split('\n')[0]}`
}
const app = await startApp()
after(async () => {
  await browser?.close()
  await app.close()
})

const OPEN = { uiActGate: () => true }
const EVIDENCE = { loginPath: '/login', loginMarker: undefined, loggedInMarker: '[data-user]', probe: undefined }
const resolved = (overrides = {}) => ({ profile: 'shop', targetName: 'staging', target: {}, role: 'admin', url: app.origin, origin: app.origin, readOnly: true, safeRequests: [], session: EVIDENCE, statePath: undefined, ...overrides })
const ORDERS = `POST ${app.origin}/api/orders`
const saveTwice = [
  { action: 'fill', selector: '#customer', value: 'Ada' },
  { action: 'click', selector: '#save' },
  { action: 'expectText', text: 'saved 201', selector: '#result' },
  { action: 'click', selector: '#save' },
  { action: 'expectText', text: 'save refused', selector: '#result' },
]

describe('the gate: a person confirms the one write request at a terminal', () => {
  test('assertUiActEnabled (what the runner holds) refuses unless a gate that says yes is given, and says why', () => {
    for (const deps of [undefined, {}, { uiActGate: undefined }, { uiActGate: () => false }]) {
      assert.throws(() => assertUiActEnabled(deps), (error) => error instanceof UsageError && /confirm/.test(error.message) && /terminal/.test(error.message))
    }
    assert.doesNotThrow(() => assertUiActEnabled({ uiActGate: () => true }))
  })

  test('confirmUiAct shows the request, the target and the role, and goes on only after a yes', async () => {
    const asked = []
    const yes = { confirm: async (message) => (asked.push(message), true) }
    await confirmUiAct({ request: 'POST https://x.example.com/api/orders', target: 'staging', role: 'admin', deps: yes })
    assert.equal(asked.length, 1)
    assert.match(asked[0], /POST https:\/\/x\.example\.com\/api\/orders/)
    assert.match(asked[0], /staging/)
    assert.match(asked[0], /admin/)
    await assert.rejects(confirmUiAct({ request: 'POST https://x/a', target: 't', deps: { confirm: async () => false } }), (error) => error instanceof UsageError && /was not confirmed/.test(error.message))
    await assert.rejects(confirmUiAct({ request: 'POST https://x/a', target: 't', deps: { confirm: async () => null } }), (error) => error instanceof UsageError && /person at a terminal/.test(error.message) && /yourself/.test(error.message))
    for (const odd of ['yes', 1, 'true', undefined]) await assert.rejects(confirmUiAct({ request: 'POST https://x/a', target: 't', deps: { confirm: async () => odd } }), UsageError)
  })

  test('the terminal: only the word yes allows; no terminal is null; silence is a no', async () => {
    const terminal = (text) => ({ input: Readable.from([text]), output: new PassThrough(), close: () => {} })
    const ask = (text, extra = {}) => confirmOnTerminal('allow?', { openTerminal: async () => terminal(text), timeoutMs: 500, ...extra })
    assert.equal(await ask('yes\n'), true)
    assert.equal(await ask('  yes  \r\n'), true)
    for (const refused of ['y\n', 'Yes\n', 'YES\n', 'no\n', '\n', 'yes please\n', '']) assert.equal(await ask(refused), false, JSON.stringify(refused))
    assert.equal(await confirmOnTerminal('allow?', { openTerminal: async () => null }), null)
    const output = new PassThrough()
    let shown = ''
    output.on('data', (chunk) => (shown += chunk))
    await confirmOnTerminal('the question', { openTerminal: async () => ({ input: Readable.from(['no\n']), output, close: () => {} }), timeoutMs: 500 })
    assert.match(shown, /the question/)
    let closed = 0
    await confirmOnTerminal('allow?', { openTerminal: async () => ({ input: Readable.from(['yes\n']), output: new PassThrough(), close: () => closed++ }), timeoutMs: 500 })
    assert.equal(closed, 1, 'the terminal is let go after the answer')
    const silent = { input: new PassThrough(), output: new PassThrough(), close: () => {} }
    const began = performance.now()
    assert.equal(await confirmOnTerminal('allow?', { openTerminal: async () => silent, timeoutMs: 200 }), false)
    assert.ok(performance.now() - began < 2000)
  })

  test('the command refuses, before it makes a folder or opens a browser', async (t) => {
    const dir = await tempDir(t)
    await makeGitRepo(dir, { remote: 'git@gitlab.local:fe/shop.git' })
    await writeTree(dir, { 'package.json': '{}', '.fe-kit/.gitignore': '*\n' })
    const profilesDir = await tempDir(t)
    await writeTree(profilesDir, { 'shop.md': `---\nname: shop\nmatch: { remotes: ["gitlab.local/fe/shop"] }\ntargets:\n  staging: { url: "${app.origin}" }\n---\n` })
    const env = { HOME: dir, FE_KIT_PROFILES_DIR: profilesDir, FE_KIT_STATE_DIR: await tempDir(t) }
    const launches = []
    const flags = { target: 'staging', 'allow-request': ORDERS }

    for (const confirm of [async () => false, async () => null]) {
      await assert.rejects(runUiAct({ args: [], flags, cwd: dir, env, kitRoot, deps: { confirm, launchBrowser: async () => launches.push(1) } }), UsageError)
    }

    assert.deepEqual(launches, [])
    assert.deepEqual(await readdir(join(dir, '.fe-kit')), ['.gitignore'])
  })

  test('without --allow-request, or with one that is not "METHOD https://host/path", it is a usage error of its own', async (t) => {
    const asked = []
    const base = { args: [], cwd: await tempDir(t), env: {}, kitRoot, deps: { confirm: async () => (asked.push(1), true) } }

    await assert.rejects(runUiAct({ ...base, flags: { target: 'staging' } }), (error) => error instanceof UsageError && /needs --allow-request/.test(error.message))
    await assert.rejects(runUiAct({ ...base, flags: { target: 'staging', 'allow-request': 'POST /api/orders' } }), (error) => error instanceof UsageError && /--allow-request/.test(error.message))
    await assert.rejects(runUiAct({ ...base, flags: { target: 'staging', 'allow-request': 'GET https://x.example.com/a' } }), UsageError)
    assert.deepEqual(asked, [], 'a person is not asked about a request that is not even valid')
  })

  test('the command line, with no terminal (as an agent runs it): ui-act exits 2 and says to run it yourself, and ui does not know --allow-request at all', async (t) => {
    const dir = await tempDir(t)
    // detached: a process of its own without a controlling terminal, as a tool's shell has; otherwise /dev/tty would be the one this test runs in
    const cli = (...args) => execFileAsync('node', [bin, ...args], { cwd: dir, env: process.env, detached: true }).then(() => ({ code: 0 }), (error) => error)

    const act = await cli('ui-act', '--target', 'staging', '--allow-request', 'POST https://x.example.com/a')
    const plain = await cli('ui', '--target', 'staging', '--allow-request', 'POST https://x.example.com/a')

    assert.equal(act.code, 2)
    assert.match(act.stderr, /person at a terminal/)
    assert.match(act.stderr, /yourself/)
    assert.equal(plain.code, 2)
    assert.match(plain.stderr, /allow-request/)
  })
})

describe('the runner holds the gate itself, and with the gate open the one permission works end to end', { skip: skipReason }, () => {
  const run = async (t, options) => {
    const storageState = await loginState(browser, app, 'admin') // logging in is itself a write, so the count starts after it
    app.reset()
    const launches = []
    const outcome = await runUi({
      resolved: resolved(),
      storageState,
      steps: saveTwice,
      viewports: parseViewports('desktop', { hasSteps: true }),
      pagePath: '/orders',
      outDir: await tempDir(t),
      stepTimeoutMs: 600,
      settleMs: 400,
      ...options,
      deps: {
        launchBrowser: async () => {
          const launched = await playwright.chromium.launch()
          launches.push(launched)
          return launched
        },
        ...options?.deps,
      },
    })
    return { ...outcome, launches }
  }

  test('called directly with an allowed request and no gate, the runner refuses: nothing is opened, nothing is sent', async (t) => {
    const storageState = await loginState(browser, app)
    const outDir = await tempDir(t)
    app.reset()
    const launches = []

    await assert.rejects(
      runUi({ resolved: resolved(), storageState, steps: saveTwice, viewports: parseViewports('desktop', { hasSteps: true }), pagePath: '/orders', outDir, allowRequest: ORDERS, deps: { launchBrowser: async () => launches.push(1) } }),
      (error) => error instanceof UsageError && /person confirming/.test(error.message),
    )

    assert.deepEqual(launches, [])
    assert.deepEqual(app.requests, [])
  })

  test('with the gate open, exactly one of two matching writes goes through, and the other is refused', async (t) => {
    const { data, exitCode } = await run(t, { allowRequest: ORDERS, deps: OPEN })

    assert.equal(exitCode, 0)
    assert.deepEqual(app.writes(), ['POST /api/orders'])
    assert.deepEqual(data.guard.map((event) => event.kind), ['allowed-write', 'blocked'])
    assert.equal(data.guard[0].via, 'allow-request')
  })

  test('a second matching write in another call is a new permission, so each call needs its own', async (t) => {
    await run(t, { allowRequest: ORDERS, deps: OPEN })
    await run(t, { allowRequest: ORDERS, deps: OPEN })

    assert.deepEqual(app.writes(), ['POST /api/orders']) // reset between the calls: one in the last one
  })

  test('through the command, with the gate open, the permission it was given on the command line is the one that is used', async (t) => {
    const dir = await tempDir(t)
    await makeGitRepo(dir, { remote: 'git@gitlab.local:fe/shop.git' })
    await writeTree(dir, { 'package.json': '{}', '.fe-kit/.gitignore': '*\n' })
    await writeFile(join(dir, 'steps.json'), JSON.stringify(saveTwice))
    const profilesDir = await tempDir(t)
    await writeTree(profilesDir, { 'shop.md': `---\nname: shop\nmatch: { remotes: ["gitlab.local/fe/shop"] }\nroles: [admin]\ntargets:\n  staging:\n    url: "${app.origin}"\n    session: { loggedInMarker: "[data-user]" }\n---\n` })
    const state = await tempDir(t)
    await saveSession(sessionPath(state, { profile: 'shop', target: 'staging', role: 'admin' }), await loginState(browser, app, 'admin'))
    app.reset()
    const env = { HOME: dir, FE_KIT_PROFILES_DIR: profilesDir, FE_KIT_STATE_DIR: state }
    const flags = { target: 'staging', role: 'admin', path: '/orders', steps: 'steps.json', 'allow-request': ORDERS }
    const deps = { confirm: async () => true, launchBrowser: () => playwright.chromium.launch(), settleMs: 400 }

    const { exitCode, data } = await runUiAct({ args: [], flags, cwd: dir, env, kitRoot, deps })

    assert.equal(exitCode, 0)
    assert.deepEqual(app.writes(), ['POST /api/orders'])
    assert.equal(data.guard[0].via, 'allow-request')
  })

  test('with the gate open but no permission asked for, nothing is let through', async (t) => {
    const { data } = await run(t, { steps: [{ action: 'fill', selector: '#customer', value: 'x' }, { action: 'click', selector: '#save' }], deps: OPEN })

    assert.deepEqual(app.writes(), [])
    assert.equal(data.guard.filter((event) => event.kind === 'blocked').length, 1)
  })
})
