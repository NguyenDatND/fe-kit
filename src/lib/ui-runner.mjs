import { join } from 'node:path'
import { loadPlaywright } from './browser.mjs'
import { UsageError } from './errors.mjs'
import { plural } from './format.mjs'
import { redactCredentials } from './profile.mjs'
import { createRequestPolicy } from './request-policy.mjs'
import { assertUiActEnabled } from './ui-act-gate.mjs'
import { createScrubber, secretsOf } from './scrub.mjs'
import { plainUrl } from './plain-url.mjs'
import { newGuardedContext } from './ui-guard.mjs'
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
// The first line of an error, with every address cut down to origin and path and what is secret taken out: the rest can quote the page.
const firstLine = (error, scrub) => clip(scrub(String(error?.message ?? error).split('\n')[0].replace(/https?:\/\/\S+/g, (url) => plainUrl(url))), 200)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function describeFailure(step, error, timeoutMs, scrub) {
  const where = `${step.action}${step.selector === undefined ? '' : ` ${step.selector}`}`
  if (error?.name === 'TimeoutError' || error?.code === 'step-timeout') return `${where}: timeout after ${timeoutMs} ms (not found, not visible or not as expected)`
  return `${where}: ${firstLine(error, scrub)}`
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
function listen(page, result, scrub) {
  const keep = (list, entry) => {
    if (list.length < MAX_FINDINGS) list.push(entry)
    else result.droppedFindings += 1
  }
  page.on('console', (message) => {
    // The browser notes every request the guard refused ("Failed to load resource: net::ERR_BLOCKED_BY_CLIENT.Inspector"): the
    // guard tells that itself, so it is not a console error of the page.
    if (message.type() === 'error' && !message.text().includes('net::ERR_BLOCKED_BY_CLIENT')) keep(result.consoleErrors, { type: 'console', text: clip(scrub(message.text())) })
  })
  page.on('pageerror', (error) => keep(result.consoleErrors, { type: 'pageerror', text: clip(scrub(String(error?.message ?? error))) }))
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
  const pathOf = (path) => path.split(/[?#]/)[0]
  return {
    profile: resolved.profile,
    target: resolved.targetName,
    role: resolved.role ?? null,
    url: plainUrl(resolved.url),
    readOnly: resolved.readOnly,
    session: { state: 'not-required', evidence: [] },
    viewports: [],
    steps: steps.map((step, index) => ({ index, action: step.action, ...(step.selector === undefined ? {} : { selector: step.selector }), ...(step.path === undefined ? {} : { path: pathOf(step.path) }), ...(step.name === undefined ? {} : { name: step.name }), ...(step.key === undefined ? {} : { key: step.key }), status: 'pending' })),
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

// A write the guard let through and then could not carry (it failed, it was redirected, the guard itself broke) is not a refusal
// that was meant: it is something that went wrong, and a run that saw one has not shown what the page does.
const GUARD_FAILURES = new Set(['transport-refused', 'redirect-refused', 'guard-error'])

/** Why a run is not a clean one, in words; empty when it is. A lost login is not one of these: it has its own exit code. */
export function problemsOf(result) {
  const problems = []
  const failed = result.steps.find((step) => step.status === 'failed')
  if (failed !== undefined) problems.push(`step ${failed.index + 1} failed`)
  if (result.timedOut) problems.push('the run took too long')
  if (result.navigationError !== null) problems.push('the page could not be opened')
  if (result.session.state === 'unknown') problems.push('the login could not be verified')
  const stuck = result.guard.filter((event) => GUARD_FAILURES.has(event.kind)).length
  if (stuck > 0) problems.push(`the guard could not pass ${plural(stuck, 'request')} on`)
  return problems
}

export const exitCodeOf = (result) => (result.session.state === 'expired' ? 3 : problemsOf(result).length > 0 ? 1 : 0)

/**
 * The result with what came from the page scrubbed once more: the findings are made of addresses, and an address can carry a secret
 * in its path. Only those fields: the words of the report itself (a state, a file name, an action) are not for the scrubber, since a
 * step may well type `desktop` or `failed`.
 */
function scrubbed(result, scrub) {
  const maybe = (text) => (typeof text === 'string' ? scrub(text) : text)
  return {
    ...result,
    url: scrub(result.url),
    session: { ...result.session, evidence: result.session.evidence.map((line) => scrub(line)) },
    navigationError: maybe(result.navigationError),
    viewports: result.viewports.map((viewport) => ({ ...viewport, finalUrl: maybe(viewport.finalUrl) })),
    steps: result.steps.map((step) => ({
      ...step,
      ...(step.error === undefined ? {} : { error: scrub(step.error) }),
      ...(step.selector === undefined ? {} : { selector: scrub(step.selector) }),
      ...(step.path === undefined ? {} : { path: scrub(step.path) }),
    })),
    failedResponses: result.failedResponses.map((entry) => ({ ...entry, url: scrub(entry.url) })),
    failedRequests: result.failedRequests.map((entry) => ({ ...entry, url: scrub(entry.url), reason: scrub(entry.reason) })),
    guard: result.guard.map((event) => ({ ...event, url: maybe(event.url), reason: maybe(event.reason) })),
  }
}

/**
 * `resolved` is what `resolveUiTarget` gives; `storageState` the saved login of the role (null when there is none, undefined
 * when no role was asked for); `steps` come from `parseSteps`. Resolves `{ data, exitCode }`; `data` is what the report says.
 * `deps.launchBrowser` and `deps.beforeStep` are seams for tests.
 */
export async function runUi({ resolved, storageState, steps = [], viewports, pagePath, outDir, deps = {}, timeoutMs = 300_000, stepTimeoutMs = 5000, settleMs = 3000, allowRequest }) {
  // Before anything is opened or any permission exists: see ui-act-gate.mjs.
  if (allowRequest !== undefined) assertUiActEnabled(deps)
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
    return { data: { ...result, problems: [], exitCode: 3 }, exitCode: 3 }
  }
  if (hasRole) result.session = { state: 'unknown', evidence: [] }

  const scrub = createScrubber(secretsOf(storageState, steps))
  const policy = createRequestPolicy({ origin: resolved.origin, readOnly: resolved.readOnly, safeRequests: resolved.safeRequests, allowRequest })
  const launch = deps.launchBrowser ?? (async () => (await loadPlaywright()).chromium.launch())
  const browser = await launch()
  let timer
  try {
    const work = look({ browser, policy, resolved, storageState, steps, viewports, pagePath, outDir, deps, stepTimeoutMs, settleMs, result, scrub })
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
  return { data: redactCredentials({ ...scrubbed(result, scrub), problems: problemsOf(result), exitCode }), exitCode }
}

async function look({ browser, policy, resolved, storageState, steps, viewports, pagePath, outDir, deps, stepTimeoutMs, settleMs, result, scrub }) {
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
    listen(page, result, scrub)
    const entry = { name: viewport.name, width: viewport.width, height: viewport.height, screenshot: null, finalUrl: null }
    result.viewports.push(entry)
    try {
      await page.goto(new URL(pagePath, resolved.url).href, { waitUntil: 'load', timeout: 30_000 })
    } catch (error) {
      result.navigationError = firstLine(error, scrub)
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
        record.error = describeFailure(step, error, timeoutMs, scrub)
      }
      record.durationMs = Date.now() - began
      if (record.status === 'failed') break
      if (step.action === 'goto') await verify(page, `after step ${index + 1}`)
      if (result.session.state === 'expired') return
    }
    entry.screenshot = `page.${viewport.name}.png`
    await page.screenshot({ path: join(outDir, entry.screenshot), fullPage: true })
    entry.finalUrl = plainUrl(page.url())
    // Also when a step failed: the step that lost the login is often not the one that failed.
    if (steps.length > 0) await verify(page, 'after the steps')
    await page.close()
  }
}
