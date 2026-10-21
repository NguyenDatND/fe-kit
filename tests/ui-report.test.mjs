import assert from 'node:assert/strict'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { formatUiMarkdown, formatUiText, writeUiReport } from '../src/lib/ui-report.mjs'
import { tempDir } from './helpers.mjs'

const base = {
  profile: 'shop',
  target: 'staging',
  role: 'admin',
  url: 'https://staging.example.com/',
  readOnly: true,
  session: { state: 'authenticated', evidence: ['first page: the logged-in marker is visible (loggedInMarker)'] },
  viewports: [
    { name: 'mobile', width: 375, height: 812, screenshot: 'page.mobile.png', finalUrl: 'https://staging.example.com/orders' },
    { name: 'desktop', width: 1280, height: 800, screenshot: 'page.desktop.png', finalUrl: 'https://staging.example.com/orders' },
  ],
  steps: [
    { index: 0, action: 'fill', selector: '#customer', status: 'ok', durationMs: 20 },
    { index: 1, action: 'click', selector: '#save', status: 'ok', durationMs: 31 },
    { index: 2, action: 'expectText', selector: '#result', status: 'failed', error: 'expectText #result: timeout after 5000 ms (not found, not visible or not as expected)', durationMs: 5001 },
    { index: 3, action: 'screenshot', name: 'done', status: 'skipped' },
  ],
  consoleErrors: [{ type: 'console', text: 'Something broke' }, { type: 'pageerror', text: 'late failure' }],
  failedResponses: [{ status: 404, method: 'GET', url: 'https://staging.example.com/api/missing' }],
  failedRequests: [],
  droppedFindings: 0,
  guard: [
    { kind: 'blocked', method: 'POST', url: 'https://staging.example.com/api/orders', reason: 'the target is read-only: POST requests are refused' },
    { kind: 'websocket-blocked', url: 'wss://staging.example.com/live', reason: 'a WebSocket can carry writes the guard cannot read' },
  ],
  navigationError: null,
  timedOut: false,
  exitCode: 1,
}

test('the text says what was seen, where the pictures are, and what the guard refused', () => {
  const text = formatUiText(base, { directory: '.fe-kit/ui/run-1' })

  assert.match(text, /^fe-kit ui: staging as admin \(read-only\), https:\/\/staging\.example\.com\/$/m)
  assert.match(text, /^Login: authenticated$/m)
  assert.match(text, /\.fe-kit\/ui\/run-1\/page\.mobile\.png \(375x812\)/)
  assert.match(text, /^Steps: 2 ok, 1 failed, 1 skipped$/m)
  assert.match(text, /expectText #result: timeout after 5000 ms/)
  assert.match(text, /^Console errors: 2$/m)
  assert.match(text, /404 GET https:\/\/staging\.example\.com\/api\/missing/)
  assert.match(text, /Refused by the guard: 2/)
  assert.match(text, /POST https:\/\/staging\.example\.com\/api\/orders: the target is read-only/)
  assert.match(text, /Report: \.fe-kit\/ui\/run-1\/report\.md/)
})

test('a lost login says how to log in again, with the target and the role', () => {
  const text = formatUiText({ ...base, session: { state: 'expired', evidence: ['first page: the page is the login page (/login)'] }, exitCode: 3 }, { directory: 'd' })

  assert.match(text, /^Login: expired \(first page: the page is the login page \(\/login\)\)$/m)
  assert.match(text, /fe-kit auth login --target staging --role admin/)
})

test('an unknown login says it was not verified, and a missing saved login says there is none', () => {
  assert.match(formatUiText({ ...base, session: { state: 'unknown', evidence: [] }, exitCode: 1 }, { directory: 'd' }), /^Login: unknown, so it was not verified/m)
  assert.match(formatUiText({ ...base, session: { state: 'expired', evidence: ['no saved login for role admin'] }, exitCode: 3 }, { directory: 'd' }), /no saved login for role admin/)
})

test('a run with no role has no login line to worry about, and a run without findings says so', () => {
  const quiet = { ...base, role: null, readOnly: false, session: { state: 'not-required', evidence: [] }, steps: [], consoleErrors: [], failedResponses: [], guard: [], exitCode: 0 }
  const text = formatUiText(quiet, { directory: 'd' })

  assert.match(text, /^fe-kit ui: staging \(writable\), https:\/\/staging\.example\.com\/$/m)
  assert.doesNotMatch(text, /^Login:/m)
  assert.match(text, /^Console errors: none$/m)
  assert.match(text, /^Failed responses: none$/m)
  assert.doesNotMatch(text, /Refused by the guard/)
  assert.doesNotMatch(text, /^Steps:/m)
})

test('a run that timed out or could not open the page says so', () => {
  assert.match(formatUiText({ ...base, timedOut: true }, { directory: 'd' }), /The run was stopped: it took too long/)
  assert.match(formatUiText({ ...base, navigationError: 'page.goto: net::ERR_CONNECTION_REFUSED at http://x/' }, { directory: 'd' }), /Could not open the page: page\.goto: net::ERR_CONNECTION_REFUSED/)
})

test('lists are cut after ten lines and the cut is counted, so a noisy page does not flood the reader', () => {
  const noisy = { ...base, consoleErrors: Array.from({ length: 25 }, (_, index) => ({ type: 'console', text: `error ${index}` })), droppedFindings: 7 }
  const text = formatUiText(noisy, { directory: 'd' })

  assert.match(text, /^Console errors: 25 \(and 7 more not kept\)$/m)
  assert.match(text, /error 9\b/)
  assert.doesNotMatch(text, /error 10\b/)
  assert.match(text, /and 15 more in report\.md/)
})

test('writes the guard let through are told apart from what it refused', () => {
  const allowed = { ...base, guard: [{ kind: 'allowed-write', method: 'POST', url: 'https://staging.example.com/graphql', via: 'safe-request' }] }
  const text = formatUiText(allowed, { directory: 'd' })

  assert.match(text, /^Writes let through: 1$/m)
  assert.match(text, /POST https:\/\/staging\.example\.com\/graphql \(safe-request\)/)
  assert.doesNotMatch(text, /Refused by the guard/)
})

test('a viewport with no picture (the page did not open) is not listed among the pictures', () => {
  const text = formatUiText({ ...base, viewports: [{ name: 'mobile', width: 375, height: 812, screenshot: null, finalUrl: null }] }, { directory: 'd' })

  assert.doesNotMatch(text, /Pictures:/)
  assert.doesNotMatch(formatUiMarkdown({ ...base, viewports: [{ name: 'mobile', width: 375, height: 812, screenshot: null, finalUrl: null }] }), /!\[mobile\]/)
})

test('a pipe in a table cell does not break the table', () => {
  const markdown = formatUiMarkdown({ ...base, steps: [{ index: 0, action: 'click', selector: 'a|b', status: 'failed', error: 'x | y' }] })

  assert.match(markdown, /\| 1 \| click \| a\\\|b \| failed \| x \\\| y \|/)
})

test('the markdown report holds every section, and the failed step is easy to find', () => {
  const markdown = formatUiMarkdown(base)

  for (const heading of ['# UI check: staging as admin', '## Result', '## Login', '## Pictures', '## Steps', '## Console errors', '## Failed responses', '## Refused by the guard']) assert.ok(markdown.includes(heading), heading)
  assert.match(markdown, /\| 3 \| expectText \| #result \| failed \|/)
  assert.match(markdown, /!\[mobile\]\(page\.mobile\.png\)/)
})

test('writeUiReport writes report.json and report.md, and never over an existing report', async (t) => {
  const dir = await tempDir(t)

  await writeUiReport(dir, base)

  assert.deepEqual((await readdir(dir)).sort(), ['report.json', 'report.md'])
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'report.json'), 'utf8')), base)
  assert.match(await readFile(join(dir, 'report.md'), 'utf8'), /^# UI check/)
  await assert.rejects(writeUiReport(dir, base), /EEXIST/)
})

test('either report file already being there stops the write', async (t) => {
  for (const name of ['report.json', 'report.md']) {
    const dir = await tempDir(t)
    await writeFile(join(dir, name), 'earlier')

    await assert.rejects(writeUiReport(dir, base), /EEXIST/, name)
    assert.equal(await readFile(join(dir, name), 'utf8'), 'earlier')
  }
})
