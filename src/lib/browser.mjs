import { UsageError } from './errors.mjs'

/**
 * Playwright, loaded when a command needs a browser: the other commands run without paying for it. The browser itself is not
 * part of the package; `npx playwright install chromium` fetches it, and fe-kit never does that on its own.
 */
export async function loadPlaywright(importPlaywright = () => import('playwright')) {
  try {
    return await importPlaywright()
  } catch (error) {
    // Only "the package is not there" is explained; an error from inside Playwright is the caller's to see.
    if (error?.code === 'ERR_MODULE_NOT_FOUND' && /'playwright'/.test(error.message)) {
      throw new UsageError('playwright is not installed: run `npm install` in the fe-kit folder')
    }
    throw error
  }
}
