import assert from 'node:assert/strict'
import http from 'node:http'
import { after, describe, test } from 'node:test'
import { loadPlaywright } from '../src/lib/browser.mjs'
import { createRequestPolicy } from '../src/lib/request-policy.mjs'
import { newGuardedContext } from '../src/lib/ui-guard.mjs'

/** A server that records every request it gets, so a test can say what did reach it. */
async function startServer() {
  const requests = []
  const upgrades = []
  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const body = Buffer.concat(chunks)
      requests.push({ method: req.method, url: req.url, type: req.headers['content-type'], cookie: req.headers.cookie ?? null, body })
      if (req.method === 'GET' && req.url === '/') return res.end('<!doctype html><title>t</title>ok')
      if (req.method === 'GET' && req.url === '/sw.js') {
        res.setHeader('content-type', 'text/javascript')
        return res.end(`self.addEventListener('install', () => { fetch('/api/from-sw', { method: 'POST', body: 'x' }) })
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
self.addEventListener('fetch', (event) => event.respondWith(new Response('answered by the service worker')))`)
      }
      if (req.url === '/graphql') {
        res.setHeader('content-type', 'application/json')
        res.setHeader('x-custom', 'yes')
        return res.end('{"data":{"ok":true}}')
      }
      if (req.url === '/set') {
        res.setHeader('set-cookie', ['a=1; Path=/', 'b=2; Path=/'])
        return res.end('set')
      }
      if (req.url === '/redirect') {
        res.statusCode = 307
        res.setHeader('location', '/api/after-redirect')
        return res.end()
      }
      if (req.url === '/boom') return req.socket.destroy()
      res.end('done')
    })
  })
  server.on('upgrade', (req, socket) => {
    upgrades.push(req.url)
    socket.destroy()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  return {
    origin,
    requests,
    upgrades,
    writes: () => requests.filter((request) => !['GET', 'HEAD', 'OPTIONS'].includes(request.method)).map((request) => `${request.method} ${request.url}`),
    reset: () => {
      requests.length = 0
      upgrades.length = 0
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// A test can only be skipped by a value known when it is declared, so the browser is started here, at the top.
let browser = null
let skipReason = false
try {
  browser = await (await loadPlaywright()).chromium.launch()
} catch (error) {
  skipReason = `Chromium could not be started: ${error.message.split('\n')[0]}`
}
const server = await startServer()
const other = await startServer()
after(async () => {
  await browser?.close()
  await server.close()
  await other.close()
})

const SAFE = [
  { method: 'POST', path: '/graphql', body: 'graphql' },
  { method: 'POST', path: '/search', body: 'any' },
]
const policyFor = (options = {}) => createRequestPolicy({ origin: server.origin, readOnly: true, safeRequests: SAFE, ...options })

/** A guarded context and its page, on a page of the target. */
async function open(t, { policy = policyFor(), storageState } = {}) {
  server.reset()
  other.reset()
  const guarded = await newGuardedContext(browser, { policy, storageState })
  t.after(() => guarded.context.close())
  const page = await guarded.context.newPage()
  await page.goto(`${server.origin}/`)
  return { ...guarded, page }
}

describe('the guard keeps a scripted run from writing on a read-only target', { skip: skipReason }, () => {
  test('a write from the page is refused and never reaches the server; reads pass', async (t) => {
    const { page, events } = await open(t)

    const outcome = await page.evaluate(async (origin) => {
      const read = await fetch(`${origin}/api/orders?token=SECRET_IN_QUERY`)
      const write = await fetch(`${origin}/api/orders?token=SECRET_IN_QUERY`, { method: 'POST', body: '{}' }).then(() => 'sent', () => 'refused')
      return { read: read.status, write }
    }, server.origin)

    assert.deepEqual(outcome, { read: 200, write: 'refused' })
    assert.deepEqual(server.writes(), [])
    assert.equal(events.some((event) => event.kind === 'allowed-write'), false) // a read is not a write that was let through
    assert.deepEqual(events.filter((event) => event.kind === 'blocked').map((event) => `${event.method} ${event.url}`), [`POST ${server.origin}/api/orders`])
    assert.ok(!JSON.stringify(events).includes('SECRET_IN_QUERY'))
  })

  test('every other way a page can send a write is refused: form in the page, popup, iframe, worker, ping, another origin', async (t) => {
    const { page, context } = await open(t)

    await page.evaluate(
      async ({ origin, foreign }) => {
        const form = document.createElement('form')
        form.method = 'POST'
        form.action = `${origin}/api/form`
        form.target = 'hidden'
        const frame = document.createElement('iframe')
        frame.name = 'hidden'
        document.body.append(frame, form)
        form.submit()
        frame.srcdoc = `<form method=post action="${origin}/api/iframe"></form><script>document.forms[0].submit()</script>`
        new Worker(URL.createObjectURL(new Blob([`fetch('${origin}/api/worker',{method:'POST',body:'x'})`])))
        const link = document.createElement('a')
        link.href = `${origin}/ok`
        link.ping = `${origin}/api/ping`
        link.target = 'hidden'
        link.textContent = 'go'
        document.body.append(link)
        link.click()
        await fetch(`${foreign}/api/cross`, { method: 'POST', mode: 'no-cors', body: 'x' }).catch(() => {})
        window.open(`${origin}/`)
      },
      { origin: server.origin, foreign: other.origin },
    )
    const popup = await context.waitForEvent('page')
    await popup.evaluate((origin) => {
      const form = document.createElement('form')
      form.method = 'POST'
      form.action = `${origin}/api/popup`
      document.body.append(form)
      form.submit()
    }, server.origin)
    await pause(500)

    assert.deepEqual(server.writes(), [])
    assert.deepEqual(other.writes(), [])
  })

  test('what a page sends while it is being unloaded is refused too, on navigation and on close', async (t) => {
    for (const leave of ['navigate', 'close']) {
      const { page } = await open(t)
      await page.evaluate((origin) => {
        addEventListener('pagehide', () => {
          navigator.sendBeacon(`${origin}/api/beacon`, 'x')
          fetch(`${origin}/api/keepalive`, { method: 'POST', keepalive: true, body: 'x' }).catch(() => {})
          fetch(`${origin}/api/plain`, { method: 'POST', body: 'x' }).catch(() => {})
        })
      }, server.origin)

      if (leave === 'navigate') await page.goto(`${server.origin}/elsewhere`)
      else await page.close()
      await pause(400)

      assert.deepEqual(server.writes(), [], leave)
    }
  })

  test('sendBeacon and keepalive fetches are refused while the page runs', async (t) => {
    const { page } = await open(t)

    const beacon = await page.evaluate((origin) => navigator.sendBeacon(`${origin}/api/beacon`, 'x'), server.origin)
    const keepalive = await page.evaluate((origin) => fetch(`${origin}/api/keepalive`, { method: 'POST', keepalive: true, body: 'x' }).then(() => 'sent', () => 'refused'), server.origin)
    await pause(300)

    assert.equal(beacon, false)
    assert.equal(keepalive, 'refused')
    assert.deepEqual(server.writes(), [])
  })

  test('a WebSocket never reaches the server, and the attempt is recorded', async (t) => {
    const { page, events } = await open(t)

    await page.evaluate((origin) => new Promise((resolve) => {
      const socket = new WebSocket(`${origin.replace('http', 'ws')}/socket`)
      socket.onclose = resolve
      socket.onerror = resolve
    }), server.origin)
    await pause(200)

    assert.deepEqual(server.upgrades, [])
    assert.ok(events.some((event) => event.kind === 'websocket-blocked'))
  })

  test('a service worker can neither answer for the page nor send a write behind the guard', async (t) => {
    const { page } = await open(t)

    await page.evaluate(() => navigator.serviceWorker.register('/sw.js').catch(() => {}))
    await pause(800)
    const answer = await page.evaluate(async () => (await fetch('/probe')).text())

    assert.equal(answer, 'done')
    assert.deepEqual(server.writes(), [])
  })

  test('the guard is in place before the first page loads: a write the first page sends on load is refused', async (t) => {
    server.reset()
    const guarded = await newGuardedContext(browser, { policy: policyFor() })
    t.after(() => guarded.context.close())
    const page = await guarded.context.newPage()
    await page.route(`${server.origin}/onload`, (route) => route.fulfill({ contentType: 'text/html', body: `<script>fetch('/api/onload', { method: 'POST', body: 'x' }).catch(() => {})</script>` }))
    // The page route answers the document itself; the write it makes then has to go through the context's guard.

    await page.goto(`${server.origin}/onload`)
    await pause(300)

    assert.deepEqual(server.writes(), [])
  })

  test('when the policy itself fails the request is refused, never let through', async (t) => {
    const broken = {
      readOnly: true,
      decide: (request) => {
        if (request.method === 'POST') throw new Error('policy bug')
        return { allow: true, via: 'read' }
      },
    }
    const { page } = await open(t, { policy: broken })

    const outcome = await page.evaluate((origin) => fetch(`${origin}/api/orders`, { method: 'POST', body: 'x' }).then(() => 'sent', () => 'refused'), server.origin)

    assert.equal(outcome, 'refused')
    assert.deepEqual(server.writes(), [])
  })

  test('a target that is not read-only has no guard: writes go through and nothing is recorded', async (t) => {
    const { page, events } = await open(t, { policy: policyFor({ readOnly: false }) })

    const status = await page.evaluate(async (origin) => (await fetch(`${origin}/api/orders`, { method: 'POST', body: '{}' })).status, server.origin)

    assert.equal(status, 200)
    assert.deepEqual(server.writes(), ['POST /api/orders'])
    assert.deepEqual(events, [])
  })

  test('a saved login is given to the context', async (t) => {
    const state = { cookies: [{ name: 'sid', value: 'abc', domain: '127.0.0.1', path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' }], origins: [] }
    const { context } = await open(t, { storageState: state })

    assert.deepEqual((await context.cookies()).map((cookie) => cookie.name), ['sid'])
  })
})

describe('the writes the profile lets through travel intact and cannot leave by a redirect', { skip: skipReason }, () => {
  test('a GraphQL query is sent once, with the same body, and the page gets the real answer', async (t) => {
    const { page, events } = await open(t)
    const body = JSON.stringify({ query: 'query Q { me { id } }' })

    const answer = await page.evaluate(async ({ origin, body }) => {
      const response = await fetch(`${origin}/graphql`, { method: 'POST', headers: { 'content-type': 'application/json' }, body })
      return { status: response.status, custom: response.headers.get('x-custom'), json: await response.json() }
    }, { origin: server.origin, body })

    assert.deepEqual(answer, { status: 200, custom: 'yes', json: { data: { ok: true } } })
    assert.deepEqual(server.requests.filter((request) => request.method === 'POST').map((request) => [request.url, request.body.toString()]), [['/graphql', body]])
    assert.ok(events.some((event) => event.kind === 'allowed-write' && event.via === 'safe-request'))
  })

  test('a mutation on the same endpoint is refused', async (t) => {
    const { page } = await open(t)

    const outcome = await page.evaluate((origin) => fetch(`${origin}/graphql`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: 'mutation M { drop }' }) }).then(() => 'sent', () => 'refused'), server.origin)

    assert.equal(outcome, 'refused')
    assert.deepEqual(server.writes(), [])
  })

  test('bodies of every kind arrive with the same bytes: text, a Blob, binary, a file in a form, nothing at all', async (t) => {
    const { page } = await open(t, { policy: policyFor({ safeRequests: [{ method: 'POST', path: '/search', body: 'any' }] }) })

    await page.evaluate(async (origin) => {
      const send = (body) => fetch(`${origin}/search`, { method: 'POST', body })
      const form = new FormData()
      form.append('file', new File(['hello file'], 'a.txt', { type: 'text/plain' }))
      await send('plain text')
      await send(new Blob(['hello blob'], { type: 'text/plain' }))
      await send(new Uint8Array([1, 2, 3, 4]))
      await send(form)
      await send(undefined)
    }, server.origin)

    const bodies = server.requests.filter((request) => request.method === 'POST')
    assert.equal(bodies.length, 5)
    assert.equal(bodies[0].body.toString(), 'plain text')
    assert.equal(bodies[1].body.toString(), 'hello blob')
    assert.deepEqual([...bodies[2].body], [1, 2, 3, 4])
    assert.match(bodies[3].type, /^multipart\/form-data; boundary=/)
    assert.match(bodies[3].body.toString(), /filename="a\.txt"[\s\S]*hello file/)
    assert.equal(bodies[4].body.length, 0)
  })

  test('cookies a response sets reach the browser, all of them, and the next request carries them', async (t) => {
    const { page, context } = await open(t, { policy: policyFor({ safeRequests: [{ method: 'POST', path: '/set', body: 'any' }, { method: 'POST', path: '/search', body: 'any' }] }) })

    await page.evaluate((origin) => fetch(`${origin}/set`, { method: 'POST' }), server.origin)
    await page.evaluate((origin) => fetch(`${origin}/search`, { method: 'POST' }), server.origin)

    assert.deepEqual((await context.cookies()).map((cookie) => cookie.name).sort(), ['a', 'b'])
    assert.equal(server.requests.find((request) => request.url === '/search').cookie, 'a=1; b=2')
  })

  test('a redirect after an allowed write is not followed: the first request is sent, the second never is', async (t) => {
    const { page, events } = await open(t, { policy: policyFor({ safeRequests: [{ method: 'POST', path: '/redirect', body: 'any' }] }) })

    const outcome = await page.evaluate((origin) => fetch(`${origin}/redirect`, { method: 'POST', body: 'x' }).then(() => 'followed', () => 'refused'), server.origin)
    await pause(300)

    assert.equal(outcome, 'refused')
    assert.deepEqual(server.writes(), ['POST /redirect'])
    assert.equal(server.requests.some((request) => request.url === '/api/after-redirect'), false)
    assert.ok(events.some((event) => event.kind === 'redirect-refused'))
  })

  test('a transport failure is not retried and not sent another way', async (t) => {
    const { page, events } = await open(t, { policy: policyFor({ safeRequests: [{ method: 'POST', path: '/boom', body: 'any' }] }) })

    const outcome = await page.evaluate((origin) => fetch(`${origin}/boom`, { method: 'POST', body: 'x' }).then(() => 'sent', () => 'refused'), server.origin)
    await pause(300)

    assert.equal(outcome, 'refused')
    assert.deepEqual(server.writes(), ['POST /boom'])
    assert.ok(events.some((event) => event.kind === 'transport-refused'))
  })

  test('a request the page sent without credentials is refused while the jar holds cookies, since the guard would add them', async (t) => {
    const state = { cookies: [{ name: 'sid', value: 'abc', domain: '127.0.0.1', path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' }], origins: [] }
    const { page, events } = await open(t, { policy: policyFor({ safeRequests: [{ method: 'POST', path: '/search', body: 'any' }] }), storageState: state })

    const omitted = await page.evaluate((origin) => fetch(`${origin}/search`, { method: 'POST', credentials: 'omit', body: 'x' }).then(() => 'sent', () => 'refused'), server.origin)
    const included = await page.evaluate((origin) => fetch(`${origin}/search`, { method: 'POST', body: 'x' }).then(() => 'sent', () => 'refused'), server.origin)

    assert.deepEqual([omitted, included], ['refused', 'sent'])
    assert.equal(server.requests.filter((request) => request.method === 'POST').length, 1)
    assert.ok(events.some((event) => event.kind === 'transport-refused' && /credentials/.test(event.reason)))
  })

  test('the one --allow-request permission lets one of two simultaneous matching writes through', async (t) => {
    const { page } = await open(t, { policy: policyFor({ allowRequest: `POST ${server.origin}/api/orders` }) })

    const outcomes = await page.evaluate(
      (origin) => Promise.all([0, 1].map(() => fetch(`${origin}/api/orders`, { method: 'POST', body: 'x' }).then(() => 'sent', () => 'refused'))),
      server.origin,
    )

    assert.deepEqual([...outcomes].sort(), ['refused', 'sent'])
    assert.deepEqual(server.writes(), ['POST /api/orders'])
  })

  test('events never hold a query string or a fragment', async (t) => {
    const { page, events } = await open(t)

    await page.evaluate((origin) => fetch(`${origin}/api/orders?token=SECRET_IN_QUERY#SECRET_IN_FRAGMENT`, { method: 'POST', body: 'x' }).catch(() => {}), server.origin)

    assert.ok(events.length > 0)
    assert.ok(!JSON.stringify(events).includes('SECRET_IN_'))
  })
})
