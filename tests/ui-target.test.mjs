import assert from 'node:assert/strict'
import { test } from 'node:test'
import { UsageError } from '../src/lib/errors.mjs'
import { resolvePagePath, resolveUiTarget } from '../src/lib/ui-target.mjs'

const settings = {
  name: 'shop',
  roles: ['admin', 'staff'],
  targets: {
    local: { start: 'pnpm dev', url: 'http://localhost:5173' },
    staging: { url: '${env:SHOP_URL}/app', safeRequests: ['POST /graphql'], session: { loginPath: '/signin', loggedInMarker: '[data-user]' } },
  },
}
const env = { SHOP_URL: 'https://staging.example.com', HOME: '/home/me', FE_KIT_STATE_DIR: '/state' }
const resolve = (flags, overrides = {}) => resolveUiTarget({ settings, flags, env, ...overrides })

test('a target and a role resolve to the address, the guard settings and the file of the saved login', () => {
  const resolved = resolve({ target: 'staging', role: 'admin' })

  assert.equal(resolved.profile, 'shop')
  assert.equal(resolved.targetName, 'staging')
  assert.equal(resolved.role, 'admin')
  assert.equal(resolved.url, 'https://staging.example.com/app')
  assert.equal(resolved.origin, 'https://staging.example.com')
  assert.equal(resolved.readOnly, true)
  assert.deepEqual(resolved.safeRequests, [{ method: 'POST', path: '/graphql', body: 'graphql' }])
  assert.equal(resolved.session.loginPath, '/signin')
  assert.equal(resolved.statePath, '/state/auth/shop/staging.admin.json')
})

test('a target the kit starts itself is writable, and a run without a role has no saved login', () => {
  const resolved = resolve({ target: 'local' })

  assert.equal(resolved.readOnly, false)
  assert.equal(resolved.role, undefined)
  assert.equal(resolved.statePath, undefined)
})

test('the target may be left out only when the profile has exactly one', () => {
  const one = { ...settings, targets: { local: settings.targets.local } }

  assert.equal(resolveUiTarget({ settings: one, flags: {}, env }).targetName, 'local')
  assert.throws(() => resolve({}), (error) => error instanceof UsageError && /--target/.test(error.message) && /local, staging/.test(error.message))
})

test('an unknown target or role, and a role where the command needs one, are usage errors that list the choices', () => {
  assert.throws(() => resolve({ target: 'prod' }), (error) => error instanceof UsageError && /unknown target/.test(error.message) && /local, staging/.test(error.message))
  assert.throws(() => resolve({ target: 'staging', role: 'root' }), (error) => error instanceof UsageError && /unknown role/.test(error.message) && /admin, staff/.test(error.message))
  assert.throws(() => resolve({ target: 'staging' }, { roleRequired: true }), (error) => error instanceof UsageError && /--role/.test(error.message))
})

test('a profile that declares no roles takes any safe role name', () => {
  const free = { ...settings, roles: undefined }

  assert.equal(resolveUiTarget({ settings: free, flags: { target: 'staging', role: 'tester' }, env }).role, 'tester')
  assert.throws(() => resolveUiTarget({ settings: free, flags: { target: 'staging', role: '../x' }, env }), UsageError)
})

test('a profile with no targets, or with problems in them, is refused, naming the problems', () => {
  assert.throws(() => resolveUiTarget({ settings: {}, flags: {}, env }), (error) => error instanceof UsageError && /no profile matches/.test(error.message))
  assert.throws(() => resolveUiTarget({ settings: { name: 'x', targets: {} }, flags: {}, env }), (error) => error instanceof UsageError && /has no "targets"/.test(error.message))
  assert.throws(() => resolveUiTarget({ settings: { name: 'x' }, flags: {}, env }), (error) => error instanceof UsageError && /has no "targets"/.test(error.message))
  assert.throws(
    () => resolveUiTarget({ settings: { name: 'x', targets: { t: { url: 'http://h', readonly: true } } }, flags: { target: 't' }, env }),
    (error) => error instanceof UsageError && /readonly/.test(error.message),
  )
})

test('a variable that is not set is named, and the address must be http or https', () => {
  assert.throws(() => resolveUiTarget({ settings, flags: { target: 'staging' }, env: { HOME: '/h' } }), (error) => error instanceof UsageError && /SHOP_URL/.test(error.message))
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'ftp://h/x', 'not a url', 'staging.example.com', 'https://user:pw@h/x', 'https://user@h/x']) {
    const odd = { name: 'x', targets: { t: { url } } }
    assert.throws(() => resolveUiTarget({ settings: odd, flags: { target: 't' }, env }), UsageError, url)
  }
})

test('a target with no url is refused', () => {
  assert.throws(() => resolveUiTarget({ settings: { name: 'x', targets: { t: { start: 'pnpm dev' } } }, flags: { target: 't' }, env }), (error) => error instanceof UsageError && /url/.test(error.message))
})

test('the address never carries a value of the environment into the error', () => {
  const odd = { name: 'x', targets: { t: { url: '${env:SHOP_URL}' } } }

  assert.throws(() => resolveUiTarget({ settings: odd, flags: { target: 't' }, env: { SHOP_URL: 'ftp://user:FAKE_SECRET@h' } }), (error) => error instanceof UsageError && !error.message.includes('FAKE_SECRET'))
})

test('a page path is resolved against the target, and one that would leave the target is a usage error', () => {
  const resolved = resolve({ target: 'staging' })

  assert.equal(resolvePagePath(resolved, undefined).href, 'https://staging.example.com/app')
  assert.equal(resolvePagePath(resolved, '/').href, 'https://staging.example.com/')
  assert.equal(resolvePagePath(resolved, '/orders?tab=1').href, 'https://staging.example.com/orders?tab=1')
  for (const path of ['//evil.example.com/x', 'https://evil.example.com/', 'orders', '', '/\\evil.example.com', '/a b']) {
    assert.throws(() => resolvePagePath(resolved, path), (error) => error instanceof UsageError && /--path/.test(error.message), JSON.stringify(path))
  }
})
