import http from 'node:http'

/**
 * A small web app for the `ui` tests, shaped like the sandbox: a login page, a dashboard that needs a session, a form that
 * writes, pages with console errors and a failing request. Every request it gets is recorded, so a test can say exactly what
 * reached it.
 */
export async function startApp() {
  const requests = []
  const sessions = new Map() // sid -> role
  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...headers })
    res.end(body)
  }
  const cookieOf = (req) => /(?:^|; )sid=([^;]+)/.exec(req.headers.cookie ?? '')?.[1]

  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString()
      const path = new URL(req.url, 'http://x').pathname
      requests.push({ method: req.method, path, url: req.url, body })
      const role = sessions.get(cookieOf(req))

      if (path === '/login' && req.method === 'GET') return send(res, 200, '<h1>Sign in</h1><form id="login" method="post" action="/login"><input name="role" id="role"><button>Sign in</button></form>')
      if (path === '/login' && req.method === 'POST') {
        const sid = Math.random().toString(36).slice(2)
        sessions.set(sid, new URLSearchParams(body).get('role') ?? 'admin')
        return send(res, 303, '', { location: '/', 'set-cookie': `sid=${sid}; Path=/; HttpOnly` })
      }
      if (path === '/api/me') return role ? send(res, 200, JSON.stringify({ role }), { 'content-type': 'application/json' }) : send(res, 401, '{}', { 'content-type': 'application/json' })
      if (path === '/api/me-redirect') return send(res, 302, '', { location: '/login' })
      if (path === '/api/forbidden') return send(res, 403, '{}', { 'content-type': 'application/json' })
      if (path === '/api/orders' && req.method === 'POST') return send(res, 201, '{"id":1}', { 'content-type': 'application/json' })
      if (path === '/plain') return send(res, 200, '<h1>Plain page</h1>')
      if (path === '/soft') return send(res, 200, '<h1>Session ended</h1><form id="login"><input name="role"><button>Sign in</button></form>') // a login page shown at the old URL
      if (path === '/forbidden-probe') return send(res, 200, '<h1>Dashboard</h1><span data-user>x</span>')
      if (path === '/broken') {
        return send(res, 200, '<h1>Broken</h1><script>console.log("just info"); console.error("Something broke: token=ABC"); console.error("see https://user:FAKE_PW@example.test/x"); fetch("/api/missing"); fetch("/api/bad"); setTimeout(() => { throw new Error("late failure") }, 10)</script>')
      }
      if (path === '/api/missing') return send(res, 404, '{}', { 'content-type': 'application/json' })
      if (path === '/api/bad') return send(res, 400, '{}', { 'content-type': 'application/json' })
      if (path === '/dropped') return send(res, 200, '<h1>Dropped</h1><script>fetch("/hangup").catch(() => {})</script>')
      if (path === '/hangup') return req.socket.destroy()
      if (path === '/tall') return send(res, 200, '<h1>Tall</h1><div style="height:3000px">long page</div>')
      if (path === '/long') return send(res, 200, '<h1>Long</h1><script>console.error("x".repeat(600))</script>')
      if (path === '/two') return send(res, 200, '<h1>Two</h1><button>Same</button><button>Same</button>')
      if (path === '/noisy') return send(res, 200, '<h1>Noisy</h1><script>for (let i = 0; i < 150; i++) console.error("noise " + i)</script>')
      if (path === '/expire') {
        sessions.clear()
        return send(res, 200, '<h1>Expired</h1>')
      }
      if (!role) return send(res, 302, '', { location: '/login' })
      if (path === '/') return send(res, 200, `<h1>Dashboard</h1><span data-user>${role}</span><a href="/orders">Orders</a>`)
      if (path === '/orders') {
        return send(
          res,
          200,
          `<span data-user>${role}</span><h1>Orders</h1><input id="customer"><button id="save" onclick="fetch('/api/orders',{method:'POST',body:document.getElementById('customer').value}).then(r=>{document.getElementById('result').textContent='saved '+r.status},()=>{document.getElementById('result').textContent='save refused'})">Save</button><p id="result"></p><a id="expire" href="/expire">Expire</a>`,
        )
      }
      return send(res, 404, '<h1>Not found</h1>')
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    requests,
    writes: () => requests.filter((request) => !['GET', 'HEAD', 'OPTIONS'].includes(request.method)).map((request) => `${request.method} ${request.path}`),
    reset: () => {
      requests.length = 0
    },
    expireSessions: () => sessions.clear(),
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

/** Logs in as `role` through the login form, as a person would, and returns the Playwright storage state. */
export async function loginState(browser, app, role = 'admin') {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(`${app.origin}/login`)
  await page.fill('#role', role)
  await page.click('button')
  await page.waitForURL(`${app.origin}/`)
  const state = await context.storageState({ indexedDB: true })
  await context.close()
  return state
}
