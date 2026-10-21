/**
 * Whether the login a run started with still holds. A page cannot say so by itself, so the profile says what to look for
 * (`session` of a target): where the login page is, a selector that only the login form has, a selector that only a logged-in
 * page has, a read-only address that answers differently once the login is gone. Evidence of a lost login wins over evidence
 * of a live one, and no evidence at all is `unknown`, which is neither of them. The result names what was seen and never repeats
 * a cookie or a piece of the page.
 */

function addressOf(page) {
  try {
    return new URL(page.url())
  } catch {
    return null
  }
}

export async function checkSession({ page, context, origin, config, settleMs = 3000 }) {
  const expired = []
  const alive = []

  const here = addressOf(page)
  // Only a page of the target itself counts: a login page on another host is not proof about this target's session.
  if (here !== null && here.origin === origin && (here.pathname === config.loginPath || here.pathname.startsWith(`${config.loginPath}/`))) {
    expired.push(`the page is the login page (${config.loginPath})`)
  }
  if (config.loginMarker !== undefined && (await page.locator(config.loginMarker).first().isVisible().catch(() => false))) {
    expired.push('the login form is visible (loginMarker)')
  }
  if (config.probe !== undefined) {
    try {
      // A GET, so it passes any guard; redirects are not followed, so a 302 is only what a profile lists.
      const response = await context.request.get(new URL(config.probe.path, origin).href, { maxRedirects: 0, timeout: 5000 })
      // Told by its path only: the address of the probe can carry a token in its query string.
      const probe = new URL(config.probe.path, origin).pathname
      if (config.probe.expired.includes(response.status())) expired.push(`the probe ${probe} answered ${response.status()}`)
      else if (config.probe.loggedIn.includes(response.status())) alive.push(`the probe ${probe} answered ${response.status()}`)
    } catch {
      // No answer is no evidence.
    }
  }
  if (config.loggedInMarker !== undefined && expired.length === 0) {
    try {
      await page.locator(config.loggedInMarker).first().waitFor({ state: 'visible', timeout: settleMs })
      alive.push('the logged-in marker is visible (loggedInMarker)')
    } catch {
      // Not there (yet): no evidence.
    }
  }
  const evidence = [...expired, ...alive]
  return { state: expired.length > 0 ? 'expired' : alive.length > 0 ? 'authenticated' : 'unknown', evidence }
}
