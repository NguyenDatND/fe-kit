/**
 * The guard of a read-only target: a browser context in which a scripted run cannot change data. `newGuardedContext` makes the
 * context and puts the guard in place before it hands the context back, so no page can exist without it. Several holes were
 * measured on Chromium rather than assumed, and each has its answer here:
 *  - a write is refused in `context.route`, which also sees popups, iframes, workers and `<a ping>`; a service worker would
 *    answer behind it, so service workers are blocked;
 *  - the route is told only about the first request of a redirect chain, so a write that is let through is sent by
 *    `route.fetch` without following redirects, and a redirect is refused instead of passed on;
 *  - what a page sends while it is being unloaded (`sendBeacon`, `fetch`, with or without `keepalive`) does not pass through the
 *    route at all, so a script run in every frame refuses it (at any other time these requests do pass through the route);
 *  - a WebSocket is a channel for writes the route cannot read, so it is closed before it connects.
 * What this cannot do: tell a GET that changes data from one that does not.
 */

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const FORWARD_TIMEOUT_MS = 30_000

// Runs in every frame before the page's own scripts. `sendBeacon` cannot be queued (false is what it answers when it cannot).
// Once the document starts to unload (`pagehide`; `pageshow` undoes it when the page comes back from the cache) `fetch` refuses:
// that is the one window in which a fetch is sent without the route seeing it. A synchronous or asynchronous XHR sent then was
// measured not to be sent at all. `beforeunload` is left out on purpose: a dialog can cancel it, and the page would stay locked.
export const GUARD_INIT_SCRIPT = `(() => {
  try { Object.defineProperty(Navigator.prototype, 'sendBeacon', { value: () => false, configurable: false, writable: false }) } catch {}
  let unloading = false
  addEventListener('pagehide', () => { unloading = true }, true)
  addEventListener('pageshow', () => { unloading = false }, true)
  const realFetch = window.fetch
  window.fetch = function (...args) {
    if (unloading) return Promise.reject(new TypeError('blocked by fe-kit: the page is unloading'))
    return realFetch.apply(this, args)
  }
})()`

/** A URL as it goes in a report: no query string, no fragment, no login. They can hold a token. */
export function plainUrl(url) {
  try {
    const address = new URL(url)
    return `${address.origin}${address.pathname}`
  } catch {
    return '(unreadable URL)'
  }
}

/**
 * Makes a context for `policy` (see request-policy.mjs), with the saved login `storageState` if there is one. Returns
 * `{ context, events }`; `events` fills as the run goes: `{ kind, method?, url, reason?, via? }` with kind `blocked`,
 * `allowed-write`, `redirect-refused`, `transport-refused` or `websocket-blocked`. A target that is not read-only gets no guard.
 */
export async function newGuardedContext(browser, { policy, storageState, viewport, forwardTimeoutMs = FORWARD_TIMEOUT_MS }) {
  const context = await browser.newContext({ serviceWorkers: 'block', storageState, viewport })
  const events = []
  if (!policy.readOnly) return { context, events }

  const record = (event) => events.push(event)

  /** Sends a write that the policy let through and hands the answer to the page. Never sent twice, never sent another way. */
  async function forward(route, request) {
    const at = { method: request.method(), url: plainUrl(request.url()) }
    // The fetch below carries the cookies of the context. A page that asked for none (`credentials: 'omit'`) must not get them.
    if (!('cookie' in request.headers()) && (await context.cookies(request.url())).length > 0) {
      record({ kind: 'transport-refused', ...at, reason: 'the page sent this request without credentials, and fe-kit cannot send it that way' })
      return route.abort('blockedbyclient')
    }
    let response
    try {
      response = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout: forwardTimeoutMs })
    } catch {
      record({ kind: 'transport-refused', ...at, reason: 'sending the request failed, and it is not tried again' })
      return route.abort('failed')
    }
    if (response.status() >= 300 && response.status() < 400) {
      record({ kind: 'redirect-refused', ...at, reason: `the answer was a redirect (${response.status()}), and a redirect after a write is not followed` })
      return route.abort('blockedbyclient')
    }
    return route.fulfill({ response })
  }

  async function handle(route) {
    const request = route.request()
    // The decision is made in this step, before any await: the one --allow-request permission is spent here.
    const decision = policy.decide({ method: request.method(), url: request.url(), headers: request.headers(), body: request.postDataBuffer() })
    if (!decision.allow) {
      record({ kind: 'blocked', method: request.method(), url: plainUrl(request.url()), reason: decision.reason })
      return route.abort('blockedbyclient')
    }
    if (READ_METHODS.has(request.method().toUpperCase())) return route.continue()
    record({ kind: 'allowed-write', method: request.method(), url: plainUrl(request.url()), via: decision.via })
    return forward(route, request)
  }

  await context.addInitScript(GUARD_INIT_SCRIPT)
  await context.route('**/*', async (route) => {
    try {
      await handle(route)
    } catch {
      // Whatever went wrong, the request is not let through: no continue() here. Aborting can fail when the page is already gone.
      await route.abort('failed').catch(() => {})
    }
  })
  await context.routeWebSocket(/.*/, (socket) => {
    record({ kind: 'websocket-blocked', url: plainUrl(socket.url()), reason: 'a WebSocket can carry writes the guard cannot read' })
    socket.close({ code: 1008, reason: 'blocked by fe-kit' })
  })
  return { context, events }
}
