import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { chmod, mkdtemp, readdir, readFile, realpath, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { run } from '../src/commands/dev.mjs'
import { DevBusyError, startDev, stopDev, withLock } from '../src/lib/dev-server.mjs'
import { UsageError } from '../src/lib/errors.mjs'
import { makeGitRepo, tempDir, writeTree } from './helpers.mjs'
import { startApp } from './ui-fixture.mjs'

const kitRoot = fileURLToPath(new URL('..', import.meta.url))
const bin = join(kitRoot, 'bin/fe-kit.mjs')
const execFileAsync = promisify(execFile)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}
const answers = (url) => fetch(url, { signal: AbortSignal.timeout(1000) }).then(() => true, () => false)
async function freePort() {
  const probe = createServer()
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const { port } = probe.address()
  await new Promise((resolve) => probe.close(resolve))
  return port
}

// What a dev server does for these tests: listens on the port it is given, and writes the pid of a child it leaves running.
const SERVER = `import http from 'node:http'
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
const port = Number(process.argv[2])
if (process.argv[3] === 'child') writeFileSync('child.pid', String(spawn('sleep', ['300'], { stdio: 'ignore' }).pid))
http.createServer((req, res) => res.end('dev server')).listen(port, '127.0.0.1', () => console.log('listening on ' + port))
`

const profileFor = (port, start, query = '') => `---
name: shop
match: { remotes: ["gitlab.local/fe/shop"] }
targets:
  local:
    start: ${JSON.stringify(start)}
    url: "http://127.0.0.1:${port}${query}"
  staging:
    url: "https://staging.example.com"
---
`

async function setup(t, { start, drafts = true, port, query } = {}) {
  // Not `tempDir`: its cleanup would run first and remove the folder, and the record that says what to stop with it.
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'fe-kit-dev-')))
  await makeGitRepo(dir, { remote: 'git@gitlab.local:fe/shop.git' })
  const chosen = port ?? (await freePort())
  await writeTree(dir, { 'package.json': '{}', 'server.mjs': SERVER, ...(drafts ? { '.fe-kit/.gitignore': '*\n' } : {}) })
  const profilesDir = await tempDir(t)
  const command = typeof start === 'function' ? start(chosen) : (start ?? `node server.mjs ${chosen}`)
  await writeTree(profilesDir, { 'shop.md': profileFor(chosen, command, query) })
  const env = { ...process.env, HOME: dir, FE_KIT_PROFILES_DIR: profilesDir }
  // Whatever a test leaves running is stopped, so a failing test does not leave servers behind; then the folder goes.
  t.after(async () => {
    await run({ args: ['stop'], flags: { target: 'local' }, cwd: dir, env, kitRoot }).catch(() => {})
    const child = await readFile(join(dir, 'child.pid'), 'utf8').catch(() => null)
    if (child !== null && alive(Number(child))) process.kill(Number(child), 'SIGKILL')
    await rm(dir, { recursive: true, force: true })
  })
  return { dir, env, port: chosen, url: `http://127.0.0.1:${chosen}` }
}

const call = (dir, env, sub, flags = { target: 'local' }) => run({ args: [sub], flags, cwd: dir, env, kitRoot })
const recordOf = async (dir) => JSON.parse(await readFile(join(dir, '.fe-kit/dev.pid'), 'utf8'))

test('start runs the target\'s start command in the background and waits until the address answers', async (t) => {
  const { dir, env, url } = await setup(t)

  const { text, data, exitCode } = await call(dir, env, 'start')

  assert.equal(exitCode, 0)
  assert.equal(await answers(url), true)
  assert.match(text, /Started the dev server for local/)
  assert.match(text, /\.fe-kit\/dev\.log/)
  const record = await recordOf(dir)
  assert.equal(record.pid, data.pid)
  assert.equal(record.url, `${url}/`) // kept as origin and path
  assert.equal(record.target, 'local')
  assert.match(record.command, /node server\.mjs/)
  assert.ok(alive(record.pid))
  assert.match(await readFile(join(dir, '.fe-kit/dev.log'), 'utf8'), /listening on/)
})

test('status says whether it is running and answering; stop ends it, with its children, and removes the record', async (t) => {
  const { dir, env, url } = await setup(t, { start: (port) => `node server.mjs ${port} child` })
  await call(dir, env, 'start')
  const child = Number(await readFile(join(dir, 'child.pid'), 'utf8'))
  const pid = (await recordOf(dir)).pid

  const running = await call(dir, env, 'status')
  assert.equal(running.exitCode, 0)
  assert.match(running.text, /running/)
  assert.equal(running.data.answering, true)

  const stopped = await call(dir, env, 'stop')
  assert.equal(stopped.exitCode, 0)
  assert.match(stopped.text, /Stopped/)
  await sleep(200)
  assert.equal(alive(pid), false)
  assert.equal(alive(child), false)
  assert.equal(await answers(url), false)
  await assert.rejects(stat(join(dir, '.fe-kit/dev.pid')), { code: 'ENOENT' })
  assert.equal((await call(dir, env, 'status')).exitCode, 1)
})

test('start again while it runs does not start a second one', async (t) => {
  const { dir, env } = await setup(t)
  const first = await call(dir, env, 'start')

  const second = await call(dir, env, 'start')

  assert.equal(second.exitCode, 0)
  assert.equal(second.data.pid, first.data.pid)
  assert.match(second.text, /already running/)
})

test('start refuses when something else already answers at the address, and starts nothing', async (t) => {
  const foreign = await startApp()
  t.after(() => foreign.close())
  const { dir, env } = await setup(t, { port: Number(new URL(foreign.origin).port), start: 'node server.mjs 1' })

  const { text, exitCode } = await call(dir, env, 'start')

  assert.equal(exitCode, 1)
  assert.match(text, /already answers/)
  await assert.rejects(stat(join(dir, '.fe-kit/dev.pid')), { code: 'ENOENT' })
})

test('a start command that exits at once is a failure that shows the end of its log, and leaves no record', async (t) => {
  const { dir, env } = await setup(t, { start: 'echo cannot bind the port; exit 3' })

  const { text, exitCode } = await call(dir, env, 'start')

  assert.equal(exitCode, 1)
  assert.match(text, /exited with code 3/)
  assert.match(text, /cannot bind the port/)
  await assert.rejects(stat(join(dir, '.fe-kit/dev.pid')), { code: 'ENOENT' })
})

test('what the log shows on a failure has no credential in it', async (t) => {
  const { dir, env } = await setup(t, { start: 'echo "Authorization: Bearer FAKE_BEARER_TOKEN_123"; echo "calling https://api.example.com/x?access=FAKE_QUERY_SECRET"; exit 3' })

  const { text } = await call(dir, env, 'start')

  assert.match(text, /exited with code 3/)
  assert.ok(!text.includes('FAKE_'), text)
})

test('a dev.log that is a link is refused, and what it points at is not touched', async (t) => {
  const { dir, env } = await setup(t)
  await writeFile(join(dir, 'sentinel.txt'), 'keep me')
  await symlink(join(dir, 'sentinel.txt'), join(dir, '.fe-kit/dev.log'))

  await assert.rejects(call(dir, env, 'start'), (error) => error instanceof UsageError && /dev\.log/.test(error.message))

  assert.equal(await readFile(join(dir, 'sentinel.txt'), 'utf8'), 'keep me')
  await assert.rejects(stat(join(dir, '.fe-kit/dev.pid')), { code: 'ENOENT' })
})

test('a dev.pid that is a link is refused for reading and never written through', async (t) => {
  const { dir, env } = await setup(t)
  const record = JSON.stringify({ pid: 1, started: 'x', command: 'x', url: 'http://127.0.0.1:1', target: 'local' })
  await writeFile(join(dir, 'sentinel.txt'), record)
  await symlink(join(dir, 'sentinel.txt'), join(dir, '.fe-kit/dev.pid'))

  for (const sub of ['status', 'stop', 'start']) await assert.rejects(call(dir, env, sub), (error) => error instanceof UsageError && /dev\.pid/.test(error.message), sub)

  assert.equal(await readFile(join(dir, 'sentinel.txt'), 'utf8'), record)
})

test('two starts at the same moment make one server, and the lock is gone afterwards', async (t) => {
  const { dir, env, port } = await setup(t)

  const results = await Promise.all([call(dir, env, 'start'), call(dir, env, 'start')])

  assert.equal(results.filter((result) => result.data.status === 'started').length, 1)
  assert.ok(results.every((result) => result.exitCode === 0 || /another fe-kit dev command/.test(result.text)))
  const running = await execFileAsync('pgrep', ['-f', `node server.mjs ${port}`]).then(({ stdout }) => stdout.trim().split('\n').length, () => 0)
  assert.equal(running, 1)
  await assert.rejects(stat(join(dir, '.fe-kit/dev.lock')), { code: 'ENOENT' })
})

test('a start or stop while another one runs says so and touches nothing; a lock left by a process that is gone does not stop anyone', async (t) => {
  const { dir, env } = await setup(t)
  const begun = await execFileAsync('ps', ['-o', 'lstart=', '-p', String(process.pid)]).then(({ stdout }) => stdout.trim())
  await writeFile(join(dir, '.fe-kit/dev.lock'), JSON.stringify({ pid: process.pid, started: begun }))

  for (const sub of ['start', 'stop']) {
    const busy = await call(dir, env, sub)
    assert.equal(busy.exitCode, 1, sub)
    assert.match(busy.text, /another fe-kit dev command is running \(pid \d+\)/, sub)
  }
  await assert.rejects(stat(join(dir, '.fe-kit/dev.pid')), { code: 'ENOENT' })

  await writeFile(join(dir, '.fe-kit/dev.lock'), JSON.stringify({ pid: 2_000_000_000, started: 'Mon Jan  1 00:00:00 2001' }))
  assert.equal((await call(dir, env, 'start')).exitCode, 0)
})

test('the lock is released when a start fails', async (t) => {
  const { dir, env } = await setup(t, { start: 'exit 3' })

  await call(dir, env, 'start')

  await assert.rejects(stat(join(dir, '.fe-kit/dev.lock')), { code: 'ENOENT' })
})

test('the address is shown and kept without its query string or fragment, whatever the profile holds', async (t) => {
  const { dir, env, url } = await setup(t, { query: '/?token=FAKE_QUERY_SECRET#FAKE_FRAGMENT_SECRET' })

  const started = await call(dir, env, 'start')
  const status = await call(dir, env, 'status')

  for (const result of [started, status]) {
    assert.ok(!result.text.includes('FAKE_'), result.text)
    assert.ok(!JSON.stringify(result.data).includes('FAKE_'))
  }
  assert.ok(!(await readFile(join(dir, '.fe-kit/dev.pid'), 'utf8')).includes('FAKE_'))
  assert.equal((await recordOf(dir)).url, `${url}/`)
  assert.equal(await answers(url), true)
})

test('a record kept by an earlier version, with a query string in its address, is shown without it', async (t) => {
  const { dir, env } = await setup(t)
  await call(dir, env, 'start')
  const record = await recordOf(dir)
  await writeFile(join(dir, '.fe-kit/dev.pid'), JSON.stringify({ ...record, url: `${record.url}?token=FAKE_QUERY_SECRET#FAKE_FRAGMENT_SECRET` }))

  const status = await call(dir, env, 'status')
  const again = await call(dir, env, 'start')

  assert.equal(status.data.answering, true)
  for (const result of [status, again]) {
    assert.ok(!result.text.includes('FAKE_') && !JSON.stringify(result.data).includes('FAKE_'), result.text)
  }
})

test('what is said about an address that something else already answers has no query string either', async (t) => {
  const foreign = await startApp()
  t.after(() => foreign.close())
  const { dir, env } = await setup(t, { port: Number(new URL(foreign.origin).port), start: 'node server.mjs 1', query: '/?token=FAKE_QUERY_SECRET' })

  const { text, data } = await call(dir, env, 'start')

  assert.match(text, /already answers/)
  assert.ok(!text.includes('FAKE_') && !JSON.stringify(data).includes('FAKE_'))
})

test('a dev.log that already exists with open permissions is made private before the server writes to it', { skip: process.getuid?.() === 0 }, async (t) => {
  const { dir, env } = await setup(t)
  await writeFile(join(dir, '.fe-kit/dev.log'), 'old', { mode: 0o644 })
  await chmod(join(dir, '.fe-kit/dev.log'), 0o644)

  await call(dir, env, 'start')

  assert.equal((await stat(join(dir, '.fe-kit/dev.log'))).mode & 0o777, 0o600)
})

test('when saving the record fails after the server was started, the server is stopped, with its children, and nothing is left', async (t) => {
  const { dir, env, port } = await setup(t, { start: (p) => `node server.mjs ${p} child` })
  const drafts = join(dir, '.fe-kit')
  const hooks = { afterSpawn: () => { throw new Error('disk full') } }

  await assert.rejects(startDev({ drafts, command: `node server.mjs ${port} child`, cwd: dir, url: `http://127.0.0.1:${port}`, target: 'local', env, timeoutMs: 5000, hooks }), /disk full/)

  await sleep(300)
  const alive2 = await execFileAsync('pgrep', ['-f', `node server.mjs ${port}`]).then(({ stdout }) => stdout.trim(), () => '')
  assert.equal(alive2, '', 'the server is still running')
  const child = await readFile(join(dir, 'child.pid'), 'utf8').catch(() => null)
  if (child !== null) assert.equal(alive(Number(child)), false)
  await assert.rejects(stat(join(drafts, 'dev.pid')), { code: 'ENOENT' })
  await assert.rejects(stat(join(drafts, 'dev.lock')), { code: 'ENOENT' })
})

test('the lock: one at a time, never an empty or half-written file, a staging file never left, and a release takes only its own lock', async (t) => {
  const { dir } = await setup(t)
  const drafts = join(dir, '.fe-kit')
  let inside = 0
  let most = 0
  let sawPartial = false
  let polling = true
  const poll = (async () => {
    while (polling) {
      const text = await readFile(join(drafts, 'dev.lock'), 'utf8').catch(() => null)
      if (text !== null) {
        try {
          if (!Number.isInteger(JSON.parse(text).pid)) sawPartial = true
        } catch {
          sawPartial = true
        }
      }
      await sleep(0)
    }
  })()

  const outcomes = await Promise.all(
    Array.from({ length: 12 }, () =>
      withLock(drafts, async () => {
        inside += 1
        most = Math.max(most, inside)
        await sleep(15)
        inside -= 1
        return 'ran'
      }).catch((error) => (error instanceof DevBusyError ? 'busy' : Promise.reject(error))),
    ),
  )
  polling = false
  await poll

  assert.ok(outcomes.includes('ran'))
  assert.equal(most, 1, 'two commands were inside at once')
  assert.equal(sawPartial, false, 'a lock file was seen empty or half written')
  assert.deepEqual((await readdir(drafts)).filter((name) => name.startsWith('dev.lock')), [])
})

test('a release does not remove a lock that belongs to someone else now', async (t) => {
  const { dir } = await setup(t)
  const drafts = join(dir, '.fe-kit')
  const other = JSON.stringify({ pid: process.pid, started: 'another start', nonce: 'someone-else' })

  await withLock(drafts, async () => {
    await writeFile(join(drafts, 'dev.lock'), other) // what a rival that took the lock over would have written
  })

  assert.equal(await readFile(join(drafts, 'dev.lock'), 'utf8'), other)
})

test('a lock whose owner pid is alive but is another process now (the pid was reused) is taken over', async (t) => {
  const { dir } = await setup(t)
  const drafts = join(dir, '.fe-kit')
  await writeFile(join(drafts, 'dev.lock'), JSON.stringify({ pid: process.pid, started: 'Mon Jan  1 00:00:00 2001', nonce: 'old' }))

  assert.equal(await withLock(drafts, async () => 'ran'), 'ran')
})

test('a lock file that cannot be read is respected while it is new, and taken over once it is old', async (t) => {
  const { dir } = await setup(t)
  const drafts = join(dir, '.fe-kit')
  await writeFile(join(drafts, 'dev.lock'), 'not json')

  await assert.rejects(withLock(drafts, async () => {}), DevBusyError)

  const longAgo = new Date(Date.now() - 10 * 60 * 1000)
  await utimes(join(drafts, 'dev.lock'), longAgo, longAgo)
  assert.equal(await withLock(drafts, async () => 'ran'), 'ran')
})

test('a server that never answers is stopped when the time is up, and nothing is left running', async (t) => {
  // A number of seconds no other test uses, so that what is found running afterwards can only be this server's.
  const { dir, env } = await setup(t, { start: 'sleep 299' })

  const { text, exitCode } = await call(dir, env, 'start', { target: 'local', timeout: '1' })

  assert.equal(exitCode, 1)
  assert.match(text, /did not answer within 1 s/)
  await assert.rejects(stat(join(dir, '.fe-kit/dev.pid')), { code: 'ENOENT' })
  const left = await execFileAsync('ps', ['-eo', 'pid,ppid,pgid,command']).then(({ stdout }) => stdout.split('\n').filter((line) => line.includes('sleep 299') && !line.includes('ps -eo')).join('\n'), () => '')
  assert.equal(left, '', 'a "sleep 299" is still running')
})

test('a server that ignores the polite request is ended anyway, children included', async (t) => {
  const { dir, env } = await setup(t, { start: (port) => `trap '' TERM; node server.mjs ${port} child` })
  await call(dir, env, 'start')
  const child = Number(await readFile(join(dir, 'child.pid'), 'utf8'))
  const { pid } = await recordOf(dir)

  await stopDev(join(dir, '.fe-kit'), { graceMs: 300 })

  assert.equal(alive(pid), false)
  assert.equal(alive(child), false)
})

test('stop does not touch a process that merely has the same pid as an old record', async (t) => {
  const { dir, env } = await setup(t)
  const bystander = spawn('sleep', ['300'], { stdio: 'ignore' })
  t.after(() => bystander.kill('SIGKILL'))
  await writeFile(join(dir, '.fe-kit/dev.pid'), JSON.stringify({ pid: bystander.pid, started: 'Mon Jan  1 00:00:00 2001', command: 'node server.mjs', url: 'http://127.0.0.1:1', target: 'local' }))

  const { text, exitCode } = await call(dir, env, 'stop')

  assert.equal(exitCode, 0)
  assert.match(text, /not the process fe-kit started/)
  assert.equal(alive(bystander.pid), true)
  await assert.rejects(stat(join(dir, '.fe-kit/dev.pid')), { code: 'ENOENT' })
})

test('stop of a record whose process is gone just removes the record', async (t) => {
  const { dir, env } = await setup(t)
  const gone = spawn('true', { stdio: 'ignore' })
  await new Promise((resolve) => gone.on('exit', resolve))
  await writeFile(join(dir, '.fe-kit/dev.pid'), JSON.stringify({ pid: gone.pid, started: 'x', command: 'x', url: 'http://127.0.0.1:1', target: 'local' }))

  const { text, exitCode } = await call(dir, env, 'stop')

  assert.equal(exitCode, 0)
  assert.match(text, /no longer running/)
  await assert.rejects(stat(join(dir, '.fe-kit/dev.pid')), { code: 'ENOENT' })
})

test('stop and status with nothing started say so', async (t) => {
  const { dir, env } = await setup(t)

  const stop = await call(dir, env, 'stop')
  const status = await call(dir, env, 'status')

  assert.equal(stop.exitCode, 0)
  assert.match(stop.text, /No dev server was started/)
  assert.equal(status.exitCode, 1)
  assert.match(status.text, /not running/)
})

test('a record that is not a record is refused without being quoted', async (t) => {
  const { dir, env } = await setup(t)
  await writeFile(join(dir, '.fe-kit/dev.pid'), 'garbage FAKE_SECRET')

  await assert.rejects(call(dir, env, 'status'), (error) => error instanceof UsageError && !error.message.includes('FAKE_SECRET'))
  await writeFile(join(dir, '.fe-kit/dev.pid'), JSON.stringify({ pid: -1, started: 'x', command: 'x', url: 'x', target: 'x' }))
  await assert.rejects(call(dir, env, 'stop'), UsageError)
  await writeFile(join(dir, '.fe-kit/dev.pid'), JSON.stringify({ pid: 1.5, started: 'x', command: 'x', url: 'x', target: 'x' }))
  await assert.rejects(call(dir, env, 'stop'), UsageError)
})

test('usage errors: a target with no start command, an unknown sub-command, several targets with one, .fe-kit not set up', async (t) => {
  const { dir, env } = await setup(t)

  await assert.rejects(call(dir, env, 'start', { target: 'staging' }), (error) => error instanceof UsageError && /no "start"/.test(error.message))
  await assert.rejects(call(dir, env, 'restart'), (error) => error instanceof UsageError && /start, stop or status/.test(error.message))
  await assert.rejects(call(dir, env, 'start', { target: 'nowhere' }), UsageError)
  await assert.rejects(call(dir, env, 'start', { target: 'local', timeout: '0' }), UsageError)
  await assert.rejects(call(dir, env, 'start', { target: 'local', timeout: 'soon' }), UsageError)

  const bare = await setup(t, { drafts: false })
  await assert.rejects(call(bare.dir, bare.env, 'start'), (error) => error instanceof UsageError && /fe-kit init/.test(error.message))
})

test('without --target the only target that has a start command is used', async (t) => {
  const { dir, env } = await setup(t)

  const { data } = await call(dir, env, 'start', {})

  assert.equal(data.target, 'local')
})

test('from the command line: start returns, the server keeps running, and stop ends it', async (t) => {
  const { dir, env, url } = await setup(t)
  const cli = (...args) => execFileAsync('node', [bin, 'dev', ...args], { cwd: dir, env, timeout: 30_000 })

  const started = await cli('start', '--target', 'local') // it must return while the server still runs: it does not hold the pipes
  assert.match(started.stdout, /Started the dev server/)
  assert.equal(await answers(url), true)

  const status = await cli('status', '--target', 'local', '--json')
  assert.equal(JSON.parse(status.stdout).running, true)
  await cli('stop', '--target', 'local')
  assert.equal(await answers(url), false)
})
