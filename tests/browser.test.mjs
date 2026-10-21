import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadPlaywright } from '../src/lib/browser.mjs'
import { UsageError } from '../src/lib/errors.mjs'

test('Playwright is loaded when it is installed', async () => {
  const playwright = await loadPlaywright()

  assert.equal(typeof playwright.chromium.launch, 'function')
})

test('a missing Playwright is a usage error that says how to install it, not a stack trace', async () => {
  const missing = Object.assign(new Error("Cannot find package 'playwright' imported from /x"), { code: 'ERR_MODULE_NOT_FOUND' })

  await assert.rejects(
    loadPlaywright(async () => {
      throw missing
    }),
    (error) => error instanceof UsageError && /playwright is not installed/.test(error.message) && /npm install/.test(error.message),
  )
})

test('an error while loading Playwright that is not "missing" is not hidden', async () => {
  const broken = new Error('boom inside playwright')

  await assert.rejects(
    loadPlaywright(async () => {
      throw broken
    }),
    (error) => error === broken,
  )
})

test('a missing module that is not Playwright itself is not reported as a missing Playwright', async () => {
  const other = Object.assign(new Error("Cannot find package 'left-pad' imported from /x/playwright/index.js"), { code: 'ERR_MODULE_NOT_FOUND' })

  await assert.rejects(
    loadPlaywright(async () => {
      throw other
    }),
    (error) => error === other,
  )
})

test('an error that only mentions Playwright by name is not reported as a missing Playwright', async () => {
  const other = Object.assign(new Error("'playwright' threw while loading"), { code: 'ERR_REQUIRE_ESM' })

  await assert.rejects(
    loadPlaywright(async () => {
      throw other
    }),
    (error) => error === other,
  )
})
