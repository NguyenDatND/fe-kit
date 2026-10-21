import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'
import { loadPlaywright } from '../src/lib/browser.mjs'
import { UsageError } from '../src/lib/errors.mjs'
import { runUi } from '../src/lib/ui-runner.mjs'
import { parseViewports } from '../src/lib/ui-viewports.mjs'
import { loginState, startApp } from './ui-fixture.mjs'
import { tempDir } from './helpers.mjs'

let playwright = null
let browser = null // the test's own, for logging in; the runs launch their own, as the command does
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

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47])
const EVIDENCE = { loginPath: '/login', loginMarker: undefined, loggedInMarker: '[data-user]', probe: undefined }
const resolved = (overrides = {}) => ({
  profile: 'shop',
  targetName: 'local',
  target: {},
  role: undefined,
  url: app.origin,
  origin: app.origin,
  readOnly: false,
  safeRequests: [],
  session: EVIDENCE,
  statePath: undefined,
  ...overrides,
})
const desktop = parseViewports('desktop', { hasSteps: false })
/** The size a PNG says it has: the IHDR chunk starts at byte 8, and holds width and height after its 8 bytes of name and length. */
const pngSize = (file) => ({ width: file.readUInt32BE(16), height: file.readUInt32BE(20) })

async function run(t, options = {}) {
  app.reset()
  const outDir = await tempDir(t)
  const launches = []
  const outcome = await runUi({
    resolved: resolved(options.resolved),
    storageState: options.storageState,
    steps: options.steps,
    viewports: options.viewports ?? desktop,
    pagePath: options.pagePath ?? '/plain',
    outDir,
    stepTimeoutMs: 600,
    settleMs: 400,
    ...options.limits,
    deps: {
      launchBrowser: async () => {
        const launched = await playwright.chromium.launch()
        launches.push(launched)
        return launched
      },
      ...options.deps,
    },
  })
  return { ...outcome, outDir, launches }
}

describe('runUi looks at the target in a real browser and reports what it saw', { skip: skipReason }, () => {
  test('a plain run takes a full-page picture at each viewport, and reports the page it ended on', async (t) => {
    const { data, exitCode, outDir } = await run(t, { viewports: parseViewports(undefined, { hasSteps: false }) })

    assert.equal(exitCode, 0)
    assert.deepEqual(data.viewports.map((viewport) => viewport.name), ['mobile', 'tablet', 'desktop'])
    assert.deepEqual(data.viewports.map((viewport) => viewport.screenshot), ['page.mobile.png', 'page.tablet.png', 'page.desktop.png'])
    for (const viewport of data.viewports) assert.deepEqual((await readFile(join(outDir, viewport.screenshot))).subarray(0, 4), PNG)
    assert.equal(data.viewports[0].finalUrl, `${app.origin}/plain`)
    assert.equal(data.session.state, 'not-required')
    assert.equal(data.readOnly, false)
  })

  test('a run with a saved login is authenticated by the marker the profile names, and the page is the logged-in one', async (t) => {
    const storageState = await loginState(browser, app, 'admin')

    const { data, exitCode } = await run(t, { pagePath: '/', resolved: { role: 'admin' }, storageState })

    assert.equal(exitCode, 0)
    assert.equal(data.session.state, 'authenticated')
    assert.equal(data.role, 'admin')
    assert.ok(data.session.evidence.every((line) => line.startsWith('first page: '))) // no steps, so no check "after the steps"
  })

  test('no saved login for the role is exit 3, without opening a browser', async (t) => {
    const { data, exitCode, launches } = await run(t, { resolved: { role: 'admin' }, storageState: null })

    assert.equal(exitCode, 3)
    assert.equal(data.session.state, 'expired')
    assert.match(data.session.evidence.join(' '), /no saved login/)
    assert.deepEqual(launches, [])
  })

  test('a login that has run out is exit 3 at the first page, and the steps are not run', async (t) => {
    const storageState = await loginState(browser, app, 'admin')
    app.expireSessions()

    const { data, exitCode } = await run(t, { pagePath: '/', resolved: { role: 'admin' }, storageState, steps: [{ action: 'click', selector: 'a' }] })

    assert.equal(exitCode, 3)
    assert.equal(data.session.state, 'expired')
    assert.deepEqual(data.steps.map((step) => step.status), ['skipped'])
  })

  test('a run with a role needs something that proves the login is alive, else it is a usage error before any browser opens', async (t) => {
    const storageState = await loginState(browser, app, 'admin')

    await assert.rejects(
      run(t, { resolved: { role: 'admin', session: { loginPath: '/login', loginMarker: 'form#login', loggedInMarker: undefined, probe: undefined } }, storageState }),
      (error) => error instanceof UsageError && /loggedInMarker/.test(error.message),
    )
  })

  test('a run with a role and nothing that can be seen is "unknown" and exits 1', async (t) => {
    const storageState = await loginState(browser, app, 'admin')

    const { data, exitCode } = await run(t, { pagePath: '/plain', resolved: { role: 'admin' }, storageState })

    assert.equal(exitCode, 1)
    assert.equal(data.session.state, 'unknown')
  })

  test('console errors, uncaught errors and failed responses are reported, and they do not fail the run', async (t) => {
    const { data, exitCode } = await run(t, { pagePath: '/broken' })

    assert.equal(exitCode, 0)
    assert.ok(data.consoleErrors.some((entry) => entry.type === 'console' && entry.text.includes('Something broke')))
    assert.equal(data.consoleErrors.some((entry) => entry.text.includes('just info')), false) // console.log is not an error
    assert.ok(data.consoleErrors.some((entry) => entry.type === 'pageerror' && entry.text.includes('late failure')))
    assert.deepEqual(data.failedResponses.map((entry) => `${entry.status} ${entry.method} ${entry.url}`).sort(), [`400 GET ${app.origin}/api/bad`, `404 GET ${app.origin}/api/missing`])
  })

  test('a credential in a console message is not in the result', async (t) => {
    const { data } = await run(t, { pagePath: '/broken' })

    assert.ok(data.consoleErrors.some((entry) => entry.text.includes('see https://[REDACTED]@example.test/x')))
    assert.ok(!JSON.stringify(data).includes('FAKE_PW'))
  })

  test('at most 100 findings are kept, and the rest are counted', async (t) => {
    const { data } = await run(t, { pagePath: '/noisy' })

    assert.equal(data.consoleErrors.length, 100)
    assert.equal(data.droppedFindings, 50)
  })

  test('steps run once in order and report each; a form is filled and submitted on a writable target', async (t) => {
    const storageState = await loginState(browser, app, 'admin')

    const { data, exitCode, outDir } = await run(t, {
      pagePath: '/orders',
      resolved: { role: 'admin' },
      storageState,
      steps: [
        { action: 'fill', selector: '#customer', value: 'Ada' },
        { action: 'click', selector: '#save' },
        { action: 'expectText', text: 'saved 201', selector: '#result' },
        { action: 'screenshot', name: 'after-save' },
      ],
    })

    assert.equal(exitCode, 0)
    assert.deepEqual(data.steps.map((step) => [step.action, step.status]), [['fill', 'ok'], ['click', 'ok'], ['expectText', 'ok'], ['screenshot', 'ok']])
    assert.deepEqual(app.writes(), ['POST /api/orders'])
    assert.ok((await readdir(outDir)).includes('after-save.desktop.png'))
  })

  test('on a read-only target the same steps run, the typed value stays, and the submit is refused', async (t) => {
    const storageState = await loginState(browser, app, 'admin')

    const { data, exitCode } = await run(t, {
      pagePath: '/orders',
      resolved: { role: 'admin', readOnly: true },
      storageState,
      steps: [
        { action: 'fill', selector: '#customer', value: 'Ada' },
        { action: 'click', selector: '#save' },
        { action: 'expectText', text: 'save refused', selector: '#result' },
        { action: 'expectValue', selector: '#customer', value: 'Ada' },
      ],
    })

    assert.equal(exitCode, 0)
    assert.equal(data.steps.every((step) => step.status === 'ok'), true)
    assert.deepEqual(app.writes(), [])
    assert.deepEqual(data.guard.filter((event) => event.kind === 'blocked').map((event) => `${event.method} ${event.url}`), [`POST ${app.origin}/api/orders`])
    assert.equal(data.readOnly, true)
    assert.deepEqual(data.failedRequests, []) // what the guard refused is told by the guard, not as a failed request
  })

  test('a step that fails stops the run: it is reported, the rest are skipped, and the exit code is 1', async (t) => {
    const { data, exitCode } = await run(t, {
      pagePath: '/plain',
      steps: [
        { action: 'expectText', text: 'Plain page' },
        { action: 'expectText', text: 'This text is not on the page' },
        { action: 'click', selector: '#never' },
      ],
    })

    assert.equal(exitCode, 1)
    assert.deepEqual(data.steps.map((step) => step.status), ['ok', 'failed', 'skipped'])
    assert.match(data.steps[1].error, /timeout after 600 ms/)
    assert.ok(!data.steps[1].error.includes('Plain page'))
  })

  test('a value typed by a step is not in the result', async (t) => {
    const { data } = await run(t, { pagePath: '/orders', resolved: { role: 'admin' }, storageState: await loginState(browser, app), steps: [{ action: 'fill', selector: '#customer', value: 'FAKE_SECRET_VALUE' }] })

    assert.ok(!JSON.stringify(data).includes('FAKE_SECRET_VALUE'))
  })

  test('a goto step stays on the target', async (t) => {
    const { data } = await run(t, { pagePath: '/plain', steps: [{ action: 'goto', path: '/soft' }, { action: 'expectText', text: 'Session ended' }] })

    assert.deepEqual(data.steps.map((step) => step.status), ['ok', 'ok'])
    assert.equal(data.viewports[0].finalUrl, `${app.origin}/soft`)
  })

  test('the login is checked again after a goto step: a login lost halfway is exit 3, and the steps after it are not run', async (t) => {
    const storageState = await loginState(browser, app, 'admin')

    const { data, exitCode } = await run(t, {
      pagePath: '/',
      resolved: { role: 'admin' },
      storageState,
      steps: [
        { action: 'goto', path: '/orders' },
        { action: 'goto', path: '/' },
        { action: 'click', selector: '#save' },
      ],
      deps: {
        beforeStep: (index) => {
          if (index === 1) app.expireSessions() // lost between the first step and the second, which then lands on the login page
        },
      },
    })

    assert.equal(exitCode, 3)
    assert.equal(data.session.state, 'expired')
    assert.deepEqual(data.steps.map((step) => step.status), ['ok', 'ok', 'skipped'])
  })

  test('the login is checked after the steps too: a page without the logged-in marker at the end is "unknown"', async (t) => {
    const storageState = await loginState(browser, app, 'admin')

    const { data, exitCode } = await run(t, { pagePath: '/orders', resolved: { role: 'admin' }, storageState, steps: [{ action: 'click', selector: '#expire' }] })

    assert.equal(data.steps[0].status, 'ok')
    assert.equal(data.session.state, 'unknown')
    assert.equal(exitCode, 1)
  })

  test('a target that cannot be reached is reported and exits 1', async (t) => {
    const closed = await startApp() // a port that was in use a moment ago and now answers nobody
    const dead = closed.origin
    await closed.close()

    const { data, exitCode } = await run(t, { resolved: { url: dead, origin: dead }, pagePath: '/' })

    assert.equal(exitCode, 1)
    assert.match(data.navigationError, /ERR_CONNECTION_REFUSED/)
    assert.deepEqual(data.viewports.map((viewport) => viewport.screenshot), [null])
  })

  test('a goto step to another site is a failed step, even if the steps were not checked first', async (t) => {
    const { data, exitCode } = await run(t, { steps: [{ action: 'goto', path: '//evil.example.test/x' }] })

    assert.equal(exitCode, 1)
    assert.equal(data.steps[0].status, 'failed')
    assert.match(data.steps[0].error, /stays on the target/)
  })

  test('a run that takes too long is stopped and reported, and the browser context is closed', async (t) => {
    const { data, exitCode } = await run(t, { pagePath: '/plain', steps: [{ action: 'waitFor', selector: '#never', timeoutMs: 10_000 }], limits: { timeoutMs: 700, stepTimeoutMs: 10_000 } })

    assert.equal(exitCode, 1)
    assert.equal(data.timedOut, true)
  })

  test('a request that fails on its own (the server hangs up) is reported as a failed request', async (t) => {
    const { data } = await run(t, { pagePath: '/dropped' })

    assert.deepEqual(data.failedRequests.map((entry) => `${entry.method} ${entry.url}`), [`GET ${app.origin}/hangup`])
  })

  test('a probe alone is enough to tell the login is alive', async (t) => {
    const storageState = await loginState(browser, app, 'admin')
    const session = { loginPath: '/login', loginMarker: undefined, loggedInMarker: undefined, probe: { path: '/api/me', expired: [401], loggedIn: [200] } }

    const { data, exitCode } = await run(t, { pagePath: '/plain', resolved: { role: 'admin', session }, storageState })

    assert.equal(exitCode, 0)
    assert.equal(data.session.state, 'authenticated')
  })

  test('a run with a role that could not open the page has a login that was not verified', async (t) => {
    const closed = await startApp()
    const dead = closed.origin
    await closed.close()
    const storageState = await loginState(browser, app, 'admin')

    const { data } = await run(t, { resolved: { url: dead, origin: dead, role: 'admin' }, storageState, pagePath: '/' })

    assert.equal(data.session.state, 'unknown')
    assert.ok(!data.navigationError.includes('\n'))
    assert.ok(!data.navigationError.includes('Call log'))
  })

  test('a long console message is cut', async (t) => {
    const { data } = await run(t, { pagePath: '/long' })

    assert.equal(data.consoleErrors[0].text.length, 501)
    assert.ok(data.consoleErrors[0].text.endsWith('…'))
  })

  test('pictures are the size of the viewport across and the whole page down, both the final one and a screenshot step', async (t) => {
    const { data, outDir } = await run(t, { pagePath: '/tall', viewports: parseViewports('mobile', { hasSteps: false }) })
    const final = pngSize(await readFile(join(outDir, data.viewports[0].screenshot)))

    assert.equal(final.width, 375)
    assert.ok(final.height > 3000, String(final.height))

    const stepped = await run(t, { pagePath: '/tall', steps: [{ action: 'screenshot', name: 'whole' }] })
    const picture = pngSize(await readFile(join(stepped.outDir, 'whole.desktop.png')))
    assert.equal(picture.width, 1280)
    assert.ok(picture.height > 3000, String(picture.height))
  })

  test('a step may set its own timeout, and the failure says how long it waited', async (t) => {
    const { data } = await run(t, { steps: [{ action: 'expectText', text: 'nothing like this', timeoutMs: 200 }] })

    assert.match(data.steps[0].error, /timeout after 200 ms/)
  })

  test('a selector that matches two elements is a failed click, not a click on the first', async (t) => {
    const { data, exitCode } = await run(t, { pagePath: '/two', steps: [{ action: 'click', selector: 'button' }] })

    assert.equal(exitCode, 1)
    assert.equal(data.steps[0].status, 'failed')
    assert.ok(!data.steps[0].error.includes('Same'))
  })

  test('a key pressed without a selector goes to what has the focus, and with a selector to that element', async (t) => {
    const { data } = await run(t, {
      pagePath: '/orders',
      resolved: { role: 'admin' },
      storageState: await loginState(browser, app, 'admin'),
      steps: [
        { action: 'fill', selector: '#customer', value: 'a' },
        { action: 'press', key: 'b' },
        { action: 'expectValue', selector: '#customer', value: 'ab' },
        { action: 'fill', selector: '#customer', value: '' },
        { action: 'press', key: 'Tab' }, // the focus leaves the input
        { action: 'press', selector: '#customer', key: 'x' }, // and this key goes to the input anyway, because the step names it
        { action: 'expectValue', selector: '#customer', value: 'x' },
      ],
    })

    assert.deepEqual(data.steps.map((step) => step.status), ['ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok'])
  })

  test('the browser it launched is closed afterwards, on success and on a failed run', async (t) => {
    const ok = await run(t)
    const failed = await run(t, { steps: [{ action: 'click', selector: '#never' }] })

    assert.deepEqual([ok.launches.length, failed.launches.length], [1, 1])
    assert.equal(ok.launches[0].isConnected(), false)
    assert.equal(failed.launches[0].isConnected(), false)
  })
})
