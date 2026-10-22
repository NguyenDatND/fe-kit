import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { test } from 'node:test'
import { chmod, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DEADLINE_MS, HOST_TIMEOUT_SECONDS, supervise } from '../src/lib/hook-supervisor.mjs'
import { tempDir } from './helpers.mjs'

const worker = async (t, source) => {
  const file = join(await tempDir(t), 'worker.mjs')
  await writeFile(file, source)
  return file
}
const answer = (exitCode, stdout = '') => `process.stdout.write(JSON.stringify({ exitCode: ${exitCode}, stdout: ${JSON.stringify(stdout)} }))`
const input = (text) => Readable.from([Buffer.from(text)])
const accepts = () => true
const blocked = (result) => assert.deepEqual([result.exitCode, result.stdout], [2, ''])

test('the deadline leaves the host time to read the answer', () => {
  assert.ok(DEADLINE_MS <= HOST_TIMEOUT_SECONDS * 1000 - 2000)
  assert.ok(DEADLINE_MS >= 2000)
})

test('what the worker answers is what the supervisor answers', async (t) => {
  const allow = await supervise({ input: input('{}'), workerPath: await worker(t, answer(0)), deadlineMs: 5000 })
  assert.deepEqual([allow.exitCode, allow.stdout], [0, ''])
  const asked = await supervise({ input: input('{}'), workerPath: await worker(t, answer(0, '{"decision":"force_ask"}')), deadlineMs: 5000, accepts })
  assert.deepEqual([asked.exitCode, asked.stdout], [0, '{"decision":"force_ask"}'])
  const denied = await supervise({ input: input('{}'), workerPath: await worker(t, answer(2, '')), deadlineMs: 5000 })
  assert.deepEqual([denied.exitCode, denied.stdout, denied.stderr], [2, '', '']) // the worker's own answer, not a block
})

test('the worker is given what the tool sent, whole', async (t) => {
  const echo = await worker(t, `let t = ''; for await (const c of process.stdin) t += c; process.stdout.write(JSON.stringify({ exitCode: 0, stdout: t }))`)
  const result = await supervise({ input: input('{"a":"é€"}'), workerPath: echo, deadlineMs: 5000, accepts })
  assert.equal(result.stdout, '{"a":"é€"}')
})

test('a worker that fails, answers wrongly or says something else is a block', async (t) => {
  for (const source of [
    'process.exit(1)', 'process.exit(0)', 'throw new Error("x")', 'process.stdout.write("not json")', 'process.stdout.write("{}")', 'process.stdout.write(JSON.stringify({ exitCode: 1, stdout: "" }))',
    'process.stdout.write(JSON.stringify({ exitCode: 0, stdout: 5 }))', 'process.stdout.write(JSON.stringify({ exitCode: 3, stdout: "" }))', 'process.stdout.write("[]")', 'process.stdout.write("null")',
    'process.stdout.write(JSON.stringify({ exitCode: 0, stdout: [] }))', 'syntax error here', 'process.kill(process.pid, "SIGKILL")',
  ]) {
    const began = performance.now()
    blocked(await supervise({ input: input('{}'), workerPath: await worker(t, source), deadlineMs: 5000 }))
    assert.ok(performance.now() - began < 2500, `${source} was not noticed until the deadline`)
  }
  blocked(await supervise({ input: input('{}'), workerPath: join(await tempDir(t), 'missing.mjs'), deadlineMs: 5000 }))
})

test('a worker that never answers is killed at the deadline, even if it ignores SIGTERM', async (t) => {
  for (const source of ['setInterval(() => {}, 1000)', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)', 'while (true) {}']) {
    const began = performance.now()
    const result = await supervise({ input: input('{}'), workerPath: await worker(t, source), deadlineMs: 600 })
    blocked(result)
    assert.ok(performance.now() - began < 2500, source)
    assert.match(result.stderr, /did not answer in time/)
  }
})

test('the deadline counts from the start, so an input that never ends is a block too', async (t) => {
  const never = new Readable({ read() {} })
  const began = performance.now()
  const result = await supervise({ input: never, workerPath: await worker(t, answer(0)), deadlineMs: 500 })
  blocked(result)
  assert.ok(performance.now() - began < 2500)
  assert.match(result.stderr, /did not answer in time/)
  const trickle = new Readable({ read() {} })
  const timer = setInterval(() => trickle.push(' '), 100)
  const slow = await supervise({ input: trickle, workerPath: await worker(t, answer(0)), deadlineMs: 500 })
  clearInterval(timer)
  blocked(slow)
})

test('an input or an answer over the limit is a block', async (t) => {
  const big = await supervise({ input: input('x'.repeat(5000)), workerPath: await worker(t, answer(0)), deadlineMs: 5000, maxInput: 1000 })
  blocked(big)
  assert.match(big.stderr, /too large/)
  const began = performance.now()
  const loud = await supervise({ input: input('{}'), workerPath: await worker(t, `process.stdout.write('x'.repeat(100000)); setInterval(() => {}, 1000)`), deadlineMs: 5000, maxOutput: 1000 })
  blocked(loud)
  assert.ok(performance.now() - began < 2500)
  const loudAnswer = await supervise({ input: input('{}'), workerPath: await worker(t, answer(0, 'y'.repeat(5000))), deadlineMs: 5000, maxOutput: 1000 })
  blocked(loudAnswer)
})

test('a block says why, in a way the person can act on', async (t) => {
  const result = await supervise({ input: input('{}'), workerPath: await worker(t, 'process.exit(1)'), deadlineMs: 5000 })
  assert.match(result.stderr, /^fe-kit shell-guard: blocked because the guard could not decide/)
  assert.match(result.stderr, /run the command yourself/)
})

test('a worker that is not left running after it answers', async (t) => {
  const file = await worker(t, `${answer(0)}; setInterval(() => {}, 1000)`)
  const began = performance.now()
  const result = await supervise({ input: input('{}'), workerPath: file, deadlineMs: 3000 })
  assert.equal(result.exitCode, 0)
  assert.ok(performance.now() - began < 2500)
})

test('an unreadable worker file is a block', async (t) => {
  const file = await worker(t, answer(0))
  await chmod(file, 0o000)
  const result = await supervise({ input: input('{}'), workerPath: file, deadlineMs: 5000 })
  await chmod(file, 0o644)
  if (process.getuid?.() !== 0) blocked(result)
})

test('an input that fails while it is read, and a program that cannot be started, are blocks', async (t) => {
  const workerPath = await worker(t, answer(0))
  const broken = new Readable({ read() {} })
  setImmediate(() => broken.destroy(new Error('boom')))
  const failed = await supervise({ input: broken, workerPath, deadlineMs: 5000 })
  blocked(failed)
  assert.match(failed.stderr, /could not be read/)
  const began = performance.now()
  const missing = await supervise({ input: input('{}'), workerPath: await worker(t, answer(0)), command: join(await tempDir(t), 'no-such-program'), deadlineMs: 5000 })
  blocked(missing)
  assert.match(missing.stderr, /could not be started/)
  assert.ok(performance.now() - began < 2500)
})

test('an answer the tool would not understand is a block, whatever the envelope says', async (t) => {
  const seen = []
  const accepting = (stdout, body) => (seen.push([stdout, body]), stdout === 'good')
  const good = await supervise({ input: input('{"call":1}'), workerPath: await worker(t, answer(0, 'good')), deadlineMs: 5000, accepts: accepting })
  assert.deepEqual([good.exitCode, good.stdout], [0, 'good'])
  assert.deepEqual(seen, [['good', '{"call":1}']], 'it is asked with the answer and with what the tool sent')
  blocked(await supervise({ input: input('{}'), workerPath: await worker(t, answer(0, 'not json')), deadlineMs: 5000, accepts: accepting }))
  const silent = await supervise({ input: input('{}'), workerPath: await worker(t, answer(0, '')), deadlineMs: 5000, accepts: (stdout) => stdout === '' })
  assert.deepEqual([silent.exitCode, silent.stdout], [0, ''])
  blocked(await supervise({ input: input('{}'), workerPath: await worker(t, answer(0, '')), deadlineMs: 5000, accepts: () => false }))
})

test('with nothing said about what to accept, only silence is', async (t) => {
  blocked(await supervise({ input: input('{}'), workerPath: await worker(t, answer(0, '{"decision":"deny"}')), deadlineMs: 5000 }))
  const silent = await supervise({ input: input('{}'), workerPath: await worker(t, answer(0)), deadlineMs: 5000 })
  assert.deepEqual([silent.exitCode, silent.stdout], [0, ''])
})

test('a worker that blocks by itself is not asked about: its own block stands', async (t) => {
  const result = await supervise({ input: input('{}'), workerPath: await worker(t, answer(2, '')), deadlineMs: 5000, accepts: () => false })
  assert.deepEqual([result.exitCode, result.stdout, result.stderr], [2, '', ''])
})

test('a check of the answer that throws is a block, not a crash', async (t) => {
  blocked(await supervise({ input: input('{}'), workerPath: await worker(t, answer(0, 'x')), deadlineMs: 5000, accepts: () => { throw new Error('bug') } }))
  blocked(await supervise({ input: input('{}'), workerPath: await worker(t, answer(0, 'x')), deadlineMs: 5000, accepts: () => 'yes' })) // only true is yes
})
