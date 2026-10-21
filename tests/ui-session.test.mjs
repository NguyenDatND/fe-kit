import assert from 'node:assert/strict'
import { after, describe, test } from 'node:test'
import { loadPlaywright } from '../src/lib/browser.mjs'
import { checkSession } from '../src/lib/ui-session.mjs'
import { loginState, startApp } from './ui-fixture.mjs'

let browser = null
let skipReason = false
try {
  browser = await (await loadPlaywright()).chromium.launch()
} catch (error) {
  skipReason = `Chromium could not be started: ${error.message.split('\n')[0]}`
}
const app = await startApp()
after(async () => {
  await browser?.close()
  await app.close()
})

/** A page of the app, logged in as `admin` unless `state` is null. */
async function open(t, path, { state } = {}) {
  const context = await browser.newContext({ storageState: state === null ? undefined : (state ?? (await loginState(browser, app))) })
  t.after(() => context.close())
  const page = await context.newPage()
  await page.goto(`${app.origin}${path}`)
  return { page, context }
}
const config = (overrides = {}) => ({ loginPath: '/login', loginMarker: undefined, loggedInMarker: undefined, probe: undefined, ...overrides })
const check = ({ page, context }, overrides) => checkSession({ page, context, origin: app.origin, config: config(overrides), settleMs: 400 })
const PROBE = { path: '/api/me', expired: [401], loggedIn: [200] }

describe('checkSession tells a live login from a lost one by what the target is configured to show', { skip: skipReason }, () => {
  test('authenticated: the logged-in marker is on the page', async (t) => {
    const result = await check(await open(t, '/'), { loggedInMarker: '[data-user]' })

    assert.equal(result.state, 'authenticated')
    assert.ok(result.evidence.length > 0)
  })

  test('authenticated: the probe answers with a logged-in status', async (t) => {
    const result = await check(await open(t, '/plain'), { probe: PROBE })

    assert.equal(result.state, 'authenticated')
  })

  test('expired: the page was sent to the login path', async (t) => {
    const opened = await open(t, '/', { state: null }) // no login at all: the app redirects to /login

    const result = await check(opened, { loggedInMarker: '[data-user]' })

    assert.equal(result.state, 'expired')
    assert.match(result.evidence.join(' '), /login page/)
  })

  test('expired: the login form is shown at the old address (a soft logout), found by loginMarker', async (t) => {
    const result = await check(await open(t, '/soft'), { loginMarker: 'form#login', loggedInMarker: '[data-user]' })

    assert.equal(result.state, 'expired')
    assert.match(result.evidence.join(' '), /login form/)
  })

  test('expired: the probe says so even when the page looks normal', async (t) => {
    const opened = await open(t, '/plain')
    app.expireSessions()

    const result = await check(opened, { probe: PROBE })

    assert.equal(result.state, 'expired')
    assert.match(result.evidence.join(' '), /probe/)
  })

  test('a probe answer that is not listed (403) is not a lost login, and not a live one either', async (t) => {
    const opened = await open(t, '/plain')

    const result = await check(opened, { probe: { path: '/api/forbidden', expired: [401], loggedIn: [200] } })

    assert.equal(result.state, 'unknown')
  })

  test('a probe that answers with a redirect is not followed: its status is not listed, so there is no evidence either way', async (t) => {
    const opened = await open(t, '/plain', { state: null })

    const result = await check(opened, { probe: { path: '/api/me-redirect', expired: [401], loggedIn: [200] } })

    assert.equal(result.state, 'unknown') // followed, it would end on the login page with a 200: a false "logged in"
  })

  test('a redirect status the profile lists as expired is evidence of a lost login', async (t) => {
    const opened = await open(t, '/plain', { state: null })

    const result = await check(opened, { probe: { path: '/api/me-redirect', expired: [401, 302], loggedIn: [200] } })

    assert.equal(result.state, 'expired')
  })

  test('unknown: nothing that was configured can be seen, and a login page at another address is no proof', async (t) => {
    const opened = await open(t, '/plain')

    assert.equal((await check(opened, { loggedInMarker: '[data-user]' })).state, 'unknown')
    await opened.page.goto('about:blank')
    assert.equal((await check(opened, { loggedInMarker: '[data-user]' })).state, 'unknown')
  })

  test('a login page of ANOTHER origin with the login path is not taken for a lost login', async (t) => {
    const opened = await open(t, '/')
    await opened.page.route('http://other.example.test/**', (route) => route.fulfill({ contentType: 'text/html', body: '<h1>Elsewhere</h1>' }))
    await opened.page.goto('http://other.example.test/login')

    const result = await check(opened, { loggedInMarker: '[data-user]' })

    assert.equal(result.state, 'unknown')
  })

  test('evidence of both kinds is a lost login: the page may show both a user marker and a login form', async (t) => {
    const result = await check(await open(t, '/soft'), { loginMarker: 'form#login', probe: { path: '/forbidden-probe', expired: [401], loggedIn: [200, 404] } })

    assert.equal(result.state, 'expired')
  })

  test('the login path matches whole path segments: /loginx is not /login, /login/sso is', async (t) => {
    const opened = await open(t, '/')
    await opened.page.route(`${app.origin}/loginx`, (route) => route.fulfill({ contentType: 'text/html', body: '<h1>x</h1>' }))
    await opened.page.route(`${app.origin}/login/sso`, (route) => route.fulfill({ contentType: 'text/html', body: '<h1>sso</h1>' }))

    await opened.page.goto(`${app.origin}/loginx`)
    assert.equal((await check(opened, { loggedInMarker: '[data-user]' })).state, 'unknown')
    await opened.page.goto(`${app.origin}/login/sso`)
    assert.equal((await check(opened, { loggedInMarker: '[data-user]' })).state, 'expired')
  })

  test('evidence names what was seen and never holds a cookie or a page text', async (t) => {
    const result = await check(await open(t, '/soft'), { loginMarker: 'form#login', loggedInMarker: '[data-user]' })

    assert.ok(!JSON.stringify(result).includes('Session ended'))
    assert.ok(!JSON.stringify(result).includes('sid'))
  })
})
