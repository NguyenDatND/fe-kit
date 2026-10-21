import assert from 'node:assert/strict'
import { chmod, lstat, mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { UsageError } from '../src/lib/errors.mjs'
import { readSession, saveSession, sessionPath, sessionStatus, stateRoot } from '../src/lib/auth-store.mjs'
import { canTestPermissions, tempDir } from './helpers.mjs'

const state = { cookies: [{ name: 'sid', value: 'FAKE_COOKIE_VALUE', domain: 'localhost', path: '/', expires: -1 }], origins: [{ origin: 'http://localhost:5173', localStorage: [{ name: 'token', value: 'FAKE_TOKEN_VALUE' }] }] }
const modeOf = async (path) => (await lstat(path)).mode & 0o777

/** The folders of the saved logins as `saveSession` makes them, made by hand so that a test can put something in them first. */
async function privateFolders(root, { profile = true } = {}) {
  await mkdir(join(root, 'auth'), { mode: 0o700 })
  if (profile) await mkdir(join(root, 'auth', 'p'), { mode: 0o700 })
}

test('the state folder is FE_KIT_STATE_DIR when set, else ~/.local/state/fe-kit under the home folder', () => {
  assert.equal(stateRoot({ FE_KIT_STATE_DIR: '/x/state' }), '/x/state')
  assert.equal(stateRoot({ HOME: '/home/me' }), '/home/me/.local/state/fe-kit')
})

test('a session file is named by profile, target and role, and a name that could leave the folder is a usage error', () => {
  assert.equal(sessionPath('/s', { profile: 'shop-web', target: 'staging', role: 'admin' }), '/s/auth/shop-web/staging.admin.json')
  assert.equal(sessionPath('/s', { profile: 'my.shop_2', target: 'local', role: 'staff' }), '/s/auth/my.shop_2/local.staff.json')
  for (const bad of [{ profile: '../x' }, { profile: '..' }, { profile: '.hidden' }, { profile: 'a/b' }, { profile: '' }, { target: 'a/b' }, { target: '..' }, { role: 'a b' }, { role: '' }, { role: '../../etc/passwd' }]) {
    assert.throws(() => sessionPath('/s', { profile: 'p', target: 't', role: 'r', ...bad }), UsageError, JSON.stringify(bad))
  }
})

test('saving writes the file with mode 600 in folders with mode 700, and reading gives the state back', { skip: !canTestPermissions }, async (t) => {
  const root = await tempDir(t)
  const file = sessionPath(root, { profile: 'p', target: 't', role: 'admin' })

  await saveSession(file, state)

  assert.equal(await modeOf(file), 0o600)
  assert.equal(await modeOf(join(root, 'auth')), 0o700)
  assert.equal(await modeOf(join(root, 'auth', 'p')), 0o700)
  assert.deepEqual(await readSession(file), state)
})

test('a session that is not there reads as null', async (t) => {
  const root = await tempDir(t)

  assert.equal(await readSession(sessionPath(root, { profile: 'p', target: 't', role: 'r' })), null)
})

test('saving again replaces the file whole, and leaves no temporary file behind', async (t) => {
  const root = await tempDir(t)
  const file = sessionPath(root, { profile: 'p', target: 't', role: 'r' })

  await saveSession(file, state)
  await saveSession(file, { cookies: [], origins: [] })

  assert.deepEqual(await readSession(file), { cookies: [], origins: [] })
  assert.deepEqual(await readdir(join(root, 'auth', 'p')), ['t.r.json'])
})

test('a session file that is a symlink is replaced, not written through to what it points at', async (t) => {
  const root = await tempDir(t)
  const file = sessionPath(root, { profile: 'p', target: 't', role: 'r' })
  const elsewhere = join(root, 'elsewhere.txt')
  await writeFile(elsewhere, 'keep me')
  await privateFolders(root)
  await symlink(elsewhere, file)

  await saveSession(file, state)

  assert.equal(await readFile(elsewhere, 'utf8'), 'keep me')
  assert.equal((await lstat(file)).isSymbolicLink(), false)
})

test('a folder in the path that is a symlink is refused, so a session is never written outside the state folder', async (t) => {
  const root = await tempDir(t)
  const outside = await tempDir(t)
  await privateFolders(root, { profile: false })
  await symlink(outside, join(root, 'auth', 'p'))

  await assert.rejects(saveSession(sessionPath(root, { profile: 'p', target: 't', role: 'r' }), state), UsageError)
  assert.deepEqual(await readdir(outside), [])
})

test('a folder in the path that is a link is refused for reading and for status too, even when the file behind it is real', async (t) => {
  const root = await tempDir(t)
  const real = await tempDir(t)
  await writeFile(join(real, 't.r.json'), JSON.stringify(state), { mode: 0o600 })
  await privateFolders(root, { profile: false })
  await symlink(real, join(root, 'auth', 'p'))
  const file = sessionPath(root, { profile: 'p', target: 't', role: 'r' })

  await assert.rejects(readSession(file), UsageError)
  const status = await sessionStatus(file)
  assert.equal(status.state, 'unsafe')
  assert.match(status.problem, /link/)
})

test('a folder that others can enter is refused for reading and for saving, until it is made private', { skip: !canTestPermissions }, async (t) => {
  for (const [folder, mode] of [['auth', 0o755], ['auth/p', 0o755], ['auth', 0o750], ['auth/p', 0o710]]) {
    const root = await tempDir(t)
    const file = sessionPath(root, { profile: 'p', target: 't', role: 'r' })
    await saveSession(file, state)
    await chmod(join(root, folder), mode)

    await assert.rejects(readSession(file), (error) => error instanceof UsageError && /chmod 700/.test(error.message), `read ${folder}`)
    await assert.rejects(saveSession(file, state), (error) => error instanceof UsageError && /chmod 700/.test(error.message), `save ${folder}`)

    await chmod(join(root, folder), 0o700)
    assert.deepEqual(await readSession(file), state)
  }
})

test('a session file that others can read is not read', { skip: !canTestPermissions }, async (t) => {
  const root = await tempDir(t)
  const file = sessionPath(root, { profile: 'p', target: 't', role: 'r' })
  await saveSession(file, state)
  await chmod(file, 0o640)

  await assert.rejects(readSession(file), (error) => error instanceof UsageError && /chmod 600/.test(error.message))

  await chmod(file, 0o600)
  assert.deepEqual(await readSession(file), state)
})

test('a session whose folders do not exist yet reads as null, not as an error', async (t) => {
  const root = await tempDir(t)

  assert.equal(await readSession(sessionPath(root, { profile: 'p', target: 't', role: 'r' })), null)
  await mkdir(join(root, 'auth'), { mode: 0o700 })
  assert.equal(await readSession(sessionPath(root, { profile: 'p', target: 't', role: 'r' })), null)
})

test('reading a session file that is a symlink is refused', async (t) => {
  const root = await tempDir(t)
  const file = sessionPath(root, { profile: 'p', target: 't', role: 'r' })
  await privateFolders(root)
  await writeFile(join(root, 'real.json'), JSON.stringify(state))
  await symlink(join(root, 'real.json'), file)

  await assert.rejects(readSession(file), (error) => error instanceof UsageError && /link/.test(error.message))
})

test('a file that is not a session (bad JSON, no cookies list) is refused with a usage error that does not repeat its content', async (t) => {
  const root = await tempDir(t)
  const file = sessionPath(root, { profile: 'p', target: 't', role: 'r' })
  await privateFolders(root)

  await writeFile(file, '{ FAKE_SECRET not json')
  await assert.rejects(readSession(file), (error) => error instanceof UsageError && !error.message.includes('FAKE_SECRET'))
  await writeFile(file, JSON.stringify({ cookies: 'FAKE_SECRET' }))
  await assert.rejects(readSession(file), (error) => error instanceof UsageError && !error.message.includes('FAKE_SECRET'))
  await writeFile(file, JSON.stringify({ cookies: [] })) // a Playwright state always has both lists
  await assert.rejects(readSession(file), UsageError)
})

test('status says what is there without a single cookie or token value', async (t) => {
  const root = await tempDir(t)
  const file = sessionPath(root, { profile: 'p', target: 't', role: 'r' })
  const later = { name: 'later', value: 'FAKE_LATER', domain: 'localhost', path: '/', expires: 2_100_000_000 }
  const withExpiry = { ...state, cookies: [later, ...state.cookies, { name: 'remember', value: 'FAKE_OTHER', domain: 'localhost', path: '/', expires: 2_000_000_000 }] }
  await saveSession(file, withExpiry)

  const status = await sessionStatus(file)

  assert.equal(status.state, 'present')
  assert.equal(status.cookies, 3)
  assert.equal(status.origins, 1)
  assert.equal(status.expiresAt, new Date(2_000_000_000 * 1000).toISOString())
  assert.ok(typeof status.savedAt === 'string')
  assert.ok(!JSON.stringify(status).includes('FAKE_'))
})

test('status of a missing file is "missing", and a session made only of session cookies has no expiry', async (t) => {
  const root = await tempDir(t)
  const file = sessionPath(root, { profile: 'p', target: 't', role: 'r' })

  assert.deepEqual(await sessionStatus(file), { state: 'missing' })
  await saveSession(file, state)
  assert.equal((await sessionStatus(file)).expiresAt, null)
})

test('status flags a file other users can read, and one that is not a session', { skip: !canTestPermissions }, async (t) => {
  const root = await tempDir(t)
  const file = sessionPath(root, { profile: 'p', target: 't', role: 'r' })
  await saveSession(file, state)

  await chmod(file, 0o644)
  const open = await sessionStatus(file)
  assert.equal(open.state, 'unsafe')
  assert.match(open.problem, /644/)
  assert.ok(!JSON.stringify(open).includes('FAKE_'))

  await chmod(file, 0o600)
  await writeFile(file, 'garbage FAKE_SECRET')
  const broken = await sessionStatus(file)
  assert.equal(broken.state, 'invalid')
  assert.ok(!JSON.stringify(broken).includes('FAKE_SECRET'))
})

test('status flags a file that only its group can read, and a folder that others can enter', { skip: !canTestPermissions }, async (t) => {
  const root = await tempDir(t)
  const file = sessionPath(root, { profile: 'p', target: 't', role: 'r' })
  await saveSession(file, state)

  await chmod(file, 0o640)
  assert.equal((await sessionStatus(file)).state, 'unsafe')
  await chmod(file, 0o600)
  await chmod(join(root, 'auth', 'p'), 0o755)
  const folder = await sessionStatus(file)
  assert.equal(folder.state, 'unsafe')
  assert.match(folder.problem, /folder/)
  await chmod(join(root, 'auth', 'p'), 0o700)
})

test('status of a link is "unsafe", and its target is not read', async (t) => {
  const root = await tempDir(t)
  const file = sessionPath(root, { profile: 'p', target: 't', role: 'r' })
  await privateFolders(root)
  await writeFile(join(root, 'real.json'), JSON.stringify(state))
  await symlink(join(root, 'real.json'), file)

  const status = await sessionStatus(file)
  assert.equal(status.state, 'unsafe')
  assert.match(status.problem, /link/)
})

test('a save that fails leaves no temporary file behind', async (t) => {
  const root = await tempDir(t)
  const file = sessionPath(root, { profile: 'p', target: 't', role: 'r' })
  await privateFolders(root)
  await mkdir(file, { mode: 0o700 }) // a folder where the file should go: the final rename cannot succeed

  await assert.rejects(saveSession(file, state))

  assert.deepEqual(await readdir(join(root, 'auth', 'p')), ['t.r.json'])
})
