import assert from 'node:assert/strict'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { withProcessLock } from '../src/lib/process-lock.mjs'
import { tempDir } from './helpers.mjs'

class Busy extends Error {
  constructor(pid) {
    super(`busy ${pid}`)
    this.pid = pid
  }
}
const busy = (pid) => new Busy(pid)

test('the work runs with the lock held, and the lock is gone afterwards, also after a failure', async (t) => {
  const dir = await tempDir(t)
  const lock = join(dir, 'x.lock')
  const inside = await withProcessLock(lock, async () => JSON.parse(await readFile(lock, 'utf8')).pid, busy)
  assert.equal(inside, process.pid)
  assert.deepEqual(await readdir(dir), [])
  await assert.rejects(withProcessLock(lock, async () => { throw new Error('work failed') }, busy), /work failed/)
  assert.deepEqual(await readdir(dir), [])
})

test('a second command while the first runs gets the error the caller made, with the pid of the first', async (t) => {
  const dir = await tempDir(t)
  const lock = join(dir, 'x.lock')
  let release
  const first = withProcessLock(lock, () => new Promise((resolve) => (release = resolve)), busy)
  await new Promise((resolve) => setTimeout(resolve, 100))
  await assert.rejects(withProcessLock(lock, async () => 'never', busy), (error) => error instanceof Busy && error.pid === process.pid)
  release()
  await first
  assert.equal(await withProcessLock(lock, async () => 'again', busy), 'again')
})

test('a lock whose owner is gone is taken over; one that cannot be read is respected while it is new', async (t) => {
  const dir = await tempDir(t)
  const lock = join(dir, 'x.lock')
  await writeFile(lock, JSON.stringify({ pid: 2 ** 22 - 3, started: 'long ago', nonce: 'n' }))
  assert.equal(await withProcessLock(lock, async () => 'taken', busy), 'taken')
  await writeFile(lock, 'not json')
  await assert.rejects(withProcessLock(lock, async () => 'never', busy), Busy)
})
