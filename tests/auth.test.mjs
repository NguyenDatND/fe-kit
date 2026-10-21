import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { run } from '../src/commands/auth.mjs'
import { readSession, saveSession, sessionPath, stateRoot } from '../src/lib/auth-store.mjs'
import { UsageError } from '../src/lib/errors.mjs'
import { makeGitRepo, tempDir, writeTree } from './helpers.mjs'

const kitRoot = fileURLToPath(new URL('..', import.meta.url))
const bin = join(kitRoot, 'bin/fe-kit.mjs')
const execFileAsync = promisify(execFile)

const PROFILE = `---
name: shop
match: { remotes: ["gitlab.local/fe/shop"] }
roles: [admin, staff]
targets:
  local: { start: "pnpm dev", url: "http://localhost:5173" }
  staging: { url: "\${env:SHOP_URL}" }
---
`
const STATE = { cookies: [{ name: 'sid', value: 'FAKE_COOKIE_VALUE', domain: 'staging.example.com', path: '/', expires: -1 }], origins: [] }

async function setup(t, profile = PROFILE) {
  const dir = await tempDir(t)
  await makeGitRepo(dir, { remote: 'git@gitlab.local:fe/shop.git' })
  await writeTree(dir, { 'package.json': '{}' })
  const profilesDir = await tempDir(t)
  await writeTree(profilesDir, { 'shop.md': profile })
  const state = await tempDir(t)
  const env = { HOME: dir, FE_KIT_PROFILES_DIR: profilesDir, FE_KIT_STATE_DIR: state, SHOP_URL: 'https://staging.example.com' }
  return { dir, env, state, file: sessionPath(state, { profile: 'shop', target: 'staging', role: 'admin' }) }
}

/** A browser that records what it was asked and "logs in" by handing back `state`. */
function fakeBrowser(state = STATE, { onWait } = {}) {
  const calls = { launched: null, goto: null, storageState: null, closed: 0, waited: 0, said: [] }
  return {
    calls,
    deps: {
      isInteractive: true,
      say: (text) => calls.said.push(text),
      waitForEnter: async () => {
        calls.waited++
        await onWait?.()
      },
      launchBrowser: async (options) => {
        calls.launched = options
        return {
          newContext: async () => ({
            newPage: async () => ({ goto: async (url) => (calls.goto = url) }),
            storageState: async (options) => {
              calls.storageState = options
              return state
            },
          }),
          close: async () => calls.closed++,
        }
      },
    },
  }
}

const call = (dir, env, args, flags, deps) => run({ args, flags, cwd: dir, env, kitRoot, deps })

test('login opens the target in a visible browser, waits for the user, and saves the state with indexedDB', async (t) => {
  const { dir, env, file } = await setup(t)
  const browser = fakeBrowser()

  const { text, data, exitCode } = await call(dir, env, ['login'], { target: 'staging', role: 'admin' }, browser.deps)

  assert.equal(exitCode, 0)
  assert.deepEqual(browser.calls.launched, { headless: false })
  assert.equal(browser.calls.goto, 'https://staging.example.com/')
  assert.deepEqual(browser.calls.storageState, { indexedDB: true })
  assert.equal(browser.calls.waited, 1)
  assert.equal(browser.calls.closed, 1)
  assert.deepEqual(await readSession(file), STATE)
  assert.match(browser.calls.said.join('\n'), /press Enter/)
  assert.match(text, /Saved the login for staging as admin \(1 cookie, 0 origins\)/)
  assert.match(text, /fe-kit auth status --target staging --role admin/)
  assert.ok(!text.includes('FAKE_COOKIE_VALUE') && !JSON.stringify(data).includes('FAKE_COOKIE_VALUE'))
})

test('--path says which page to open, and it cannot leave the target', async (t) => {
  const { dir, env } = await setup(t)
  const browser = fakeBrowser()

  await call(dir, env, ['login'], { target: 'staging', role: 'admin', path: '/signin?next=/' }, browser.deps)
  assert.equal(browser.calls.goto, 'https://staging.example.com/signin?next=/')

  for (const path of ['//evil.example.com/x', 'https://evil.example.com/', 'signin']) {
    await assert.rejects(call(dir, env, ['login'], { target: 'staging', role: 'admin', path }, fakeBrowser().deps), UsageError, path)
  }
})

test('login needs a terminal: with none it refuses before a browser is opened', async (t) => {
  const { dir, env } = await setup(t)
  const browser = fakeBrowser()

  await assert.rejects(
    call(dir, env, ['login'], { target: 'staging', role: 'admin' }, { ...browser.deps, isInteractive: false }),
    (error) => error instanceof UsageError && /terminal/.test(error.message),
  )
  assert.equal(browser.calls.launched, null)
})

test('the browser is closed when the wait fails, and nothing is saved', async (t) => {
  const { dir, env, file } = await setup(t)
  const browser = fakeBrowser(STATE, {
    onWait: () => {
      throw new Error('stdin closed')
    },
  })

  await assert.rejects(call(dir, env, ['login'], { target: 'staging', role: 'admin' }, browser.deps), /stdin closed/)

  assert.equal(browser.calls.closed, 1)
  assert.equal(await readSession(file), null)
})

test('a browser that holds no cookies and no storage does not replace a saved login', async (t) => {
  const { dir, env, file } = await setup(t)
  await saveSession(file, STATE)
  const browser = fakeBrowser({ cookies: [], origins: [] })

  await assert.rejects(call(dir, env, ['login'], { target: 'staging', role: 'admin' }, browser.deps), (error) => error instanceof UsageError && /nothing to save/.test(error.message))

  assert.deepEqual(await readSession(file), STATE)
  assert.equal(browser.calls.closed, 1)
})

test('status of a login that is not there exits 1 and gives the command to make one', async (t) => {
  const { dir, env } = await setup(t)

  const { text, data, exitCode } = await call(dir, env, ['status'], { target: 'staging', role: 'admin' })

  assert.equal(exitCode, 1)
  assert.equal(data.state, 'missing')
  assert.match(text, /No saved login for staging as admin/)
  assert.match(text, /fe-kit auth login --target staging --role admin/)
})

test('status of a saved login exits 0 and shows counts and dates, never a value', async (t) => {
  const { dir, env, file } = await setup(t)
  await saveSession(file, { cookies: [{ ...STATE.cookies[0], expires: 4_000_000_000 }], origins: [{ origin: 'https://staging.example.com', localStorage: [{ name: 'token', value: 'FAKE_TOKEN_VALUE' }] }] })

  const { text, data, exitCode } = await call(dir, env, ['status'], { target: 'staging', role: 'admin' })

  assert.equal(exitCode, 0)
  assert.equal(data.state, 'present')
  assert.match(text, /1 cookie, 1 origin/)
  assert.match(text, /expires 2096-/)
  assert.ok(!text.includes('FAKE_') && !JSON.stringify(data).includes('FAKE_'))
})

test('status of a login whose cookies have all expired exits 1', async (t) => {
  const { dir, env, file } = await setup(t)
  await saveSession(file, { cookies: [{ ...STATE.cookies[0], expires: 1_800_000_000 }], origins: [] }) // the year 2027

  const { text, exitCode } = await call(dir, env, ['status'], { target: 'staging', role: 'admin' }, { now: () => 1_900_000_000_000 })

  assert.equal(exitCode, 1)
  assert.match(text, /expired/)
  assert.match(text, /fe-kit auth login --target staging --role admin/)
})

test('status of a login made of session cookies only says so, and exits 0', async (t) => {
  const { dir, env, file } = await setup(t)
  await saveSession(file, STATE)

  const { text, exitCode } = await call(dir, env, ['status'], { target: 'staging', role: 'admin' })

  assert.equal(exitCode, 0)
  assert.match(text, /session cookies only/)
})

test('status of a file that is not a saved login exits 1 and does not quote it', async (t) => {
  const { dir, env, file } = await setup(t)
  await saveSession(file, STATE)
  await writeFile(file, 'garbage FAKE_SECRET', { mode: 0o600 })

  const { text, data, exitCode } = await call(dir, env, ['status'], { target: 'staging', role: 'admin' })

  assert.equal(exitCode, 1)
  assert.equal(data.state, 'invalid')
  assert.ok(!text.includes('FAKE_SECRET') && !JSON.stringify(data).includes('FAKE_SECRET'))
})

test('status of a login that is a link or can be read by others exits 1 and says why', async (t) => {
  const { dir, env, file, state } = await setup(t)
  await saveSession(file, STATE)
  const { chmod } = await import('node:fs/promises')
  await chmod(file, 0o644)

  const { text, data, exitCode } = await call(dir, env, ['status'], { target: 'staging', role: 'admin' })

  assert.equal(exitCode, 1)
  assert.equal(data.state, 'unsafe')
  assert.match(text, /644/)
  assert.ok((await stat(join(state, 'auth'))).isDirectory())
})

test('a missing role, an unknown sub-command and a missing sub-command are usage errors', async (t) => {
  const { dir, env } = await setup(t)

  await assert.rejects(call(dir, env, ['status'], { target: 'staging' }), (error) => error instanceof UsageError && /--role/.test(error.message))
  await assert.rejects(call(dir, env, ['logout'], { target: 'staging', role: 'admin' }), (error) => error instanceof UsageError && /login or status/.test(error.message))
  await assert.rejects(call(dir, env, [], { target: 'staging', role: 'admin' }), UsageError)
})

test('the saved files live under the state folder and nowhere in the project', async (t) => {
  const { dir, env, state } = await setup(t)
  await call(dir, env, ['login'], { target: 'staging', role: 'admin' }, fakeBrowser().deps)

  assert.ok((await stat(join(stateRoot(env), 'auth', 'shop', 'staging.admin.json'))).isFile())
  assert.equal(stateRoot(env), state)
  const entries = await execFileAsync('find', [dir, '-name', '*.json', '-not', '-name', 'package.json'])
  assert.equal(entries.stdout.trim(), '')
})

test('the command line wires auth up: a usage error exits 2 with a message', async (t) => {
  const { dir, env } = await setup(t)

  const failed = await execFileAsync('node', [bin, 'auth', 'status', '--target', 'staging'], { cwd: dir, env: { ...process.env, ...env } }).then(() => null, (error) => error)

  assert.equal(failed.code, 2)
  assert.match(failed.stderr, /--role/)
})
