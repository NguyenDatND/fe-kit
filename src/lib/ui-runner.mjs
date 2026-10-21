import { join } from 'node:path'
import { loadPlaywright } from './browser.mjs'
import { UsageError } from './errors.mjs'
import { redactCredentials } from './profile.mjs'
import { createRequestPolicy } from './request-policy.mjs'
import { newGuardedContext, plainUrl } from './ui-guard.mjs'
import { checkSession } from './ui-session.mjs'

/**
 * Looks at a target in a real browser: opens a page at each viewport, runs the steps, takes pictures, and reports what the page
 * said (console errors, failed responses) and what the guard refused. Exit code: 3 when the login a role needs is gone, 1 when a
 * step failed, the run ran out of time or the login cannot be told, else 0. Console errors and failed responses are findings to
 * read, not failures. Nothing typed by a step, no cookie and no query string goes into the result.
 */

const MAX_FINDINGS = 100
const MAX_TEXT = 500
const NEEDS_EVIDENCE = 'needs "session.loggedInMarker" or "session.probe" in the target, to tell whether the login still holds'

const clip = (text, max = MAX_TEXT) => (text.length > max ? `${text.slice(0, max)}…` : text)
// The first line of an error, with every address cut down to origin and path: the rest can quote the page.
const firstLine = (error) => clip(String(error?.message ?? error).split('\n')[0].replace(/https?:\/\/\S+/g, (url) => plainUrl(url)), 200)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function describeFailure(step, error, timeoutMs) {
  const where = `${step.action}${step.selector === undefined ? '' : ` ${step.selector}`}`
  if (error?.name === 'TimeoutError' || error?.code === 'step-timeout') return `${where}: timeout after ${timeoutMs} ms (not found, not visible or not as expected)`
  return `${where}: ${firstLine(error)}`
}

/** One step against the page; throws when it does not hold. */
async function performStep(step, { page, viewport, outDir, resolved, timeoutMs }) {
  const options = { timeout: timeoutMs }
  switch (step.action) {
    case 'goto': {
      const address = new URL(step.path, resolved.url)
      if (address.origin !== resolved.origin) throw new Error('a goto step stays on the target')
      return page.goto(address.href, { waitUntil: 'load', timeout: timeoutMs })
    }
    case 'click':
      return page.locator(step.selector).click(options)
    case 'fill':
      return page.locator(step.selector).fill(step.value, options)
    case 'press':
      return step.selector === undefined ? page.keyboard.press(step.key) : page.locator(step.selector).press(step.key, options)
    case 'waitFor':
    case 'expectVisible':
      return page.locator(step.selector).first().waitFor({ state: 'visible', ...options })
    case 'screenshot':
      return page.screenshot({ path: join(outDir, `${step.name}.${viewport.name}.png`), fullPage: true })
    case 'expectText':
      return page.locator(step.selector ?? 'body').filter({ hasText: step.text }).first().waitFor({ state: 'visible', ...options })
    case 'expectValue': {
      const locator = page.locator(step.selector)
      const until = Date.now() + timeoutMs
      for (;;) {
        if ((await locator.inputValue({ timeout: Math.max(1, until - Date.now()) })) === step.value) return undefined
        if (Date.now() >= until) throw Object.assign(new Error('value differs'), { code: 'step-timeout' })
        await sleep(50)
      }
    }
    default:
      throw new Error(`unknown action ${step.action}`)
  }
}

/** Collects what the page says about itself. */
function listen(page, result) {
  const keep = (list, entry) => {
    if (list.length < MAX_FINDINGS) list.push(entry)
    else result.droppedFindings += 1
  }
  page.on('console', (message) => {
    if (message.type() === 'error') keep(result.consoleErrors, { type: 'console', text: clip(message.text()) })
  })
  page.on('pageerror', (error) => keep(result.consoleErrors, { type: 'pageerror', text: clip(String(error?.message ?? error)) }))
  page.on('response', (response) => {
    if (response.status() >= 400) keep(result.failedResponses, { status: response.status(), method: response.request().method(), url: plainUrl(response.url()) })
  })
  page.on('requestfailed', (request) => {
    const reason = request.failure()?.errorText ?? 'failed'
    // What the guard refused ends in ".Inspector" and is told in `guard`; here is only what failed on its own.
    if (!reason.startsWith('net::ERR_BLOCKED_BY_CLIENT')) keep(result.failedRequests, { method: request.method(), url: plainUrl(request.url()), reason })
  })
}

function newResult(resolved, viewports, steps) {
  return {
    profile: resolved.profile,
    target: resolved.targetName,
    role: resolved.role ?? null,
    url: plainUrl(resolved.url),
    readOnly: resolved.readOnly,
    session: { state: 'not-required', evidence: [] },
    viewports: [],
    steps: steps.map((step, index) => ({ index, action: step.action, ...(step.selector === undefined ? {} : { selector: step.selector }), ...(step.path === undefined ? {} : { path: step.path }), ...(step.name === undefined ? {} : { name: step.name }), ...(step.key === undefined ? {} : { key: step.key }), status: 'pending' })),
    consoleErrors: [],
    failedResponses: [],
    failedRequests: [],
    droppedFindings: 0,
    guard: [],
    navigationError: null,
    timedOut: false,
    sizes: viewports.map((viewport) => viewport.name),
  }
}

const exitCodeOf = (result) => {
  if (result.session.state === 'expired') return 3
  const failed = result.steps.some((step) => step.status === 'failed')
  return failed || result.timedOut || result.navigationError !== null || result.session.state === 'unknown' ? 1 : 0
}

/**
 * `resolved` is what `resolveUiTarget` gives; `storageState` the saved login of the role (null when there is none, undefined
 * when no role was asked for); `steps` come from `parseSteps`. Resolves `{ data, exitCode }`; `data` is what the report says.
 * `deps.launchBrowser` and `deps.beforeStep` are seams for tests.
 */
export async function runUi({ resolved, storageState, steps = [], viewports, pagePath, outDir, deps = {}, timeoutMs = 300_000, stepTimeoutMs = 5000, settleMs = 3000, allowRequest }) {
  const result = newResult(resolved, viewports, steps)
  const skipRemaining = () => {
    for (const step of result.steps) if (step.status === 'pending') step.status = 'skipped'
  }
  const hasRole = resolved.role !== undefined
  if (hasRole && resolved.session.loggedInMarker === undefined && resolved.session.probe === undefined) {
    throw new UsageError(`target "${resolved.targetName}" ${NEEDS_EVIDENCE}`)
  }
  if (hasRole && !storageState) {
    result.session = { state: 'expired', evidence: [`no saved login for role ${resolved.role}`] }
    skipRemaining()
    return { data: { ...result, exitCode: 3 }, exitCode: 3 }
  }
  if (hasRole) result.session = { state: 'unknown', evidence: [] }

  const policy = createRequestPolicy({ origin: resolved.origin, readOnly: resolved.readOnly, safeRequests: resolved.safeRequests, allowRequest })
  const launch = deps.launchBrowser ?? (async () => (await loadPlaywright()).chromium.launch())
  const browser = await launch()
  let timer
  try {
    const work = look({ browser, policy, resolved, storageState, steps, viewports, pagePath, outDir, deps, stepTimeoutMs, settleMs, result })
    const deadline = new Promise((resolve) => {
      timer = setTimeout(() => {
        result.timedOut = true
        resolve()
      }, timeoutMs)
    })
    await Promise.race([work, deadline])
    work.catch(() => {}) // when the deadline won, closing the browser makes the work fail, and nobody is waiting for that
  } finally {
    clearTimeout(timer)
    await browser.close().catch(() => {})
  }
  skipRemaining()
  const exitCode = exitCodeOf(result)
  return { data: redactCredentials({ ...result, exitCode }), exitCode }
}

async function look({ browser, policy, resolved, storageState, steps, viewports, pagePath, outDir, deps, stepTimeoutMs, settleMs, result }) {
  const { context, events } = await newGuardedContext(browser, { policy, storageState: storageState ?? undefined })
  result.guard = events // it fills while the run goes
  const hasRole = resolved.role !== undefined
  const verify = async (page, when) => {
    if (!hasRole) return
    const checked = await checkSession({ page, context, origin: resolved.origin, config: resolved.session, settleMs })
    result.session = { state: checked.state, evidence: checked.evidence.map((line) => `${when}: ${line}`) }
  }

  for (const viewport of viewports) {
    const page = await context.newPage()
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    listen(page, result)
    const entry = { name: viewport.name, width: viewport.width, height: viewport.height, screenshot: null, finalUrl: null }
    result.viewports.push(entry)
    try {
      await page.goto(new URL(pagePath, resolved.url).href, { waitUntil: 'load', timeout: 30_000 })
    } catch (error) {
      result.navigationError = firstLine(error)
      return
    }
    await page.waitForLoadState('networkidle', { timeout: settleMs }).catch(() => {})
    await verify(page, 'first page')
    if (result.session.state === 'expired') return

    for (const [index, step] of steps.entries()) {
      const record = result.steps[index]
      deps.beforeStep?.(index)
      const began = Date.now()
      const timeoutMs = step.timeoutMs ?? stepTimeoutMs
      try {
        await performStep(step, { page, viewport, outDir, resolved, timeoutMs })
        record.status = 'ok'
      } catch (error) {
        record.status = 'failed'
        record.error = describeFailure(step, error, timeoutMs)
      }
      record.durationMs = Date.now() - began
      if (record.status === 'failed') break
      if (step.action === 'goto') await verify(page, `after step ${index + 1}`)
      if (result.session.state === 'expired') return
    }
    entry.screenshot = `page.${viewport.name}.png`
    await page.screenshot({ path: join(outDir, entry.screenshot), fullPage: true })
    entry.finalUrl = plainUrl(page.url())
    if (steps.length > 0 && result.steps.every((step) => step.status !== 'failed')) await verify(page, 'after the steps')
    await page.close()
  }
}
