import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateProfile } from '../src/lib/profile.mjs'
import { isReadOnly, parseSafeRequest, sessionConfig, targetProblems } from '../src/lib/targets.mjs'

const good = {
  local: { start: 'pnpm dev', url: 'http://localhost:5173' },
  staging: {
    url: '${env:SHOP_STAGING_URL}',
    readOnly: true,
    safeRequests: ['POST /graphql', { request: 'POST /search', body: 'any' }],
    session: { loginPath: '/signin', loginMarker: 'form#login', loggedInMarker: '[data-user]', probe: { path: '/api/me', expired: [401], loggedIn: [200] } },
  },
}

test('a well-formed set of targets and roles has no problems', () => {
  assert.deepEqual(targetProblems(good, ['admin', 'staff']), [])
  assert.deepEqual(targetProblems(undefined, undefined), [])
})

test('validateProfile reports what is wrong with targets and roles', () => {
  const problems = validateProfile({ name: 'x', match: { remotes: ['h/a/b'] }, targets: { staging: { readOnly: 'yes' } }, roles: 'admin' })

  assert.ok(problems.includes('"targets.staging.readOnly" must be true or false'))
  assert.ok(problems.includes('"roles" must be a list of names'))
})

test('targets and each target must be maps, and a target name must be safe to print', () => {
  assert.deepEqual(targetProblems([], undefined), ['"targets" must be a map of targets'])
  assert.deepEqual(targetProblems({ staging: 'http://x' }, undefined), ['"targets.staging" must be a map'])
  const [problem, ...rest] = targetProblems({ 'a b:SECRET': {} }, undefined)
  assert.equal(rest.length, 0)
  assert.match(problem, /a target name may hold only letters, digits, "-" and "_"/)
  assert.ok(!problem.includes('SECRET'))
})

test('url and start are non-empty strings; a field that is not known is a problem, so a typo cannot turn a guard off', () => {
  assert.deepEqual(targetProblems({ t: { url: '', start: 3 } }, undefined), ['"targets.t.url" must be a non-empty string', '"targets.t.start" must be a non-empty string'])
  assert.deepEqual(targetProblems({ t: { readonly: true } }, undefined), ['"targets.t.readonly" is not a known field (known: url, start, readOnly, safeRequests, session)'])
})

test('a field name that could hold a credential is not repeated in a problem', () => {
  const problems = targetProblems({ t: { 'https://u:SECRET@h': 1 } }, undefined)

  assert.equal(problems.length, 1)
  assert.ok(!problems[0].includes('SECRET'))
})

test('safeRequests holds "METHOD /path" strings or { request, body: "any" } objects, and nothing else', () => {
  const problems = targetProblems(
    {
      t: {
        safeRequests: ['GET /graphql', 'POST graphql', 'POST /gr*', 'POST /a?x=1', 'POST /a#b', { request: 'POST /x' }, { request: 'POST /x', body: 'graphql' }, { request: 'POST /x', body: 'any', extra: 1 }, 7],
      },
    },
    undefined,
  )

  assert.equal(problems.length, 9)
  assert.ok(problems.every((problem) => problem.startsWith('"targets.t.safeRequests[')))
  assert.deepEqual(targetProblems({ t: { safeRequests: 'POST /graphql' } }, undefined), ['"targets.t.safeRequests" must be a list'])
})

test('parseSafeRequest: a string is a GraphQL request, an object with body "any" is taken on trust', () => {
  assert.deepEqual(parseSafeRequest('post /graphql'), { method: 'POST', path: '/graphql', body: 'graphql' })
  assert.deepEqual(parseSafeRequest({ request: 'PUT /a/b', body: 'any' }), { method: 'PUT', path: '/a/b', body: 'any' })
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.deepEqual(parseSafeRequest(`${method} /x`), { method, path: '/x', body: 'graphql' }, method)
  assert.equal(parseSafeRequest('GET /graphql'), null)
  assert.equal(parseSafeRequest({ request: 'POST /x' }), null)
  assert.equal(parseSafeRequest('POST  /two-spaces'), null)
})

test('session: markers are non-empty strings, the probe has a path and status lists, unknown fields are problems', () => {
  const problems = targetProblems(
    { t: { session: { loginPath: 'login', loginMarker: '', loggedInMarker: 5, probe: { path: 'api/me', expired: [401, 'x'], loggedIn: 200, other: 1 }, extra: true } } },
    undefined,
  )

  for (const field of ['loginPath', 'loginMarker', 'loggedInMarker', 'probe.path', 'probe.expired', 'probe.loggedIn', 'probe.other', 'extra']) {
    assert.ok(
      problems.some((problem) => problem.includes(`"targets.t.session.${field}"`)),
      field,
    )
  }
  assert.deepEqual(targetProblems({ t: { session: 'x' } }, undefined), ['"targets.t.session" must be a map'])
  assert.deepEqual(targetProblems({ t: { session: { probe: [] } } }, undefined), ['"targets.t.session.probe" must be a map'])
})

test('probe status lists hold HTTP status codes only: 100 to 599', () => {
  const problems = (expired) => targetProblems({ t: { session: { probe: { path: '/me', expired } } } }, undefined)

  assert.deepEqual(problems([100, 401, 599]), [])
  for (const bad of [[99], [600], [0], [-1], [401.5], []]) assert.equal(problems(bad).length, 1, JSON.stringify(bad))
})

test('a name with a slash is not a safe target name or role', () => {
  assert.equal(targetProblems({ 'a/b': {} }, undefined).length, 1)
  assert.equal(targetProblems(undefined, ['a/b']).length, 1)
})

test('roles are safe names', () => {
  assert.deepEqual(targetProblems(undefined, ['admin', 'staff']), [])
  const problems = targetProblems(undefined, ['ok', '../x', ''])
  assert.equal(problems.length, 2)
  assert.ok(problems.every((problem) => problem.startsWith('"roles[')))
})

test('a target is read-only unless the kit starts it itself or it says readOnly: false', () => {
  assert.equal(isReadOnly({ url: 'https://staging' }), true)
  assert.equal(isReadOnly({ url: 'http://localhost:5173', start: 'pnpm dev' }), false)
  assert.equal(isReadOnly({ url: 'https://staging', readOnly: false }), false)
  assert.equal(isReadOnly({ url: 'http://localhost', start: 'pnpm dev', readOnly: true }), true)
})

test('sessionConfig fills the defaults: /login, probe expired on 401 and logged in on 200', () => {
  assert.deepEqual(sessionConfig({}), { loginPath: '/login', loginMarker: undefined, loggedInMarker: undefined, probe: undefined })
  assert.deepEqual(sessionConfig({ session: { probe: { path: '/api/me' } } }).probe, { path: '/api/me', expired: [401], loggedIn: [200] })
  assert.equal(sessionConfig(good.staging).loginPath, '/signin')
})
