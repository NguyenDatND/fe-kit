import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { UsageError } from '../src/lib/errors.mjs'
import { loadSteps, MAX_FILE_BYTES, MAX_STEPS, parseSteps, stepProblems } from '../src/lib/ui-steps.mjs'
import { tempDir } from './helpers.mjs'

const kitRoot = fileURLToPath(new URL('..', import.meta.url))
const allActions = [
  { action: 'goto', path: '/orders?page=2' },
  { action: 'click', selector: 'text=Save' },
  { action: 'fill', selector: '#name', value: '' },
  { action: 'press', key: 'Enter' },
  { action: 'press', selector: '#name', key: 'Tab', timeoutMs: 500 },
  { action: 'waitFor', selector: '.done', timeoutMs: 60_000 },
  { action: 'screenshot', name: 'after-save' },
  { action: 'expectText', text: 'Saved' },
  { action: 'expectText', text: 'Saved', selector: '.toast' },
  { action: 'expectVisible', selector: '.toast' },
  { action: 'expectValue', selector: '#name', value: 'kept' },
]

test('every action, in its documented form, is accepted', () => {
  assert.deepEqual(stepProblems(allActions), [])
})

test('the template that ships with the kit is a valid steps file', async () => {
  const steps = await loadSteps(join(kitRoot, 'templates/ui-steps.json'))

  assert.ok(steps.length > 0)
})

test('steps must be a non-empty list of at most MAX_STEPS', () => {
  assert.deepEqual(stepProblems({}), ['"steps" must be a list'])
  assert.deepEqual(stepProblems([]), ['"steps" is empty: it needs at least one step'])
  assert.deepEqual(stepProblems(Array.from({ length: MAX_STEPS }, () => ({ action: 'press', key: 'Tab' }))), [])
  assert.deepEqual(stepProblems(Array.from({ length: MAX_STEPS + 1 }, () => ({ action: 'press', key: 'Tab' }))), [`"steps" holds more than ${MAX_STEPS} steps`])
})

test('a step is a map with a known action and only the fields of that action', () => {
  assert.deepEqual(stepProblems(['click']), ['steps[0] must be a map'])
  assert.deepEqual(stepProblems([['click']]), ['steps[0] must be a map'])
  assert.deepEqual(stepProblems([{ selector: '#a' }]), ['steps[0].action must be one of goto, click, fill, press, waitFor, screenshot, expectText, expectVisible, expectValue'])
  assert.deepEqual(stepProblems([{ action: 'hover', selector: '#a' }]), ['steps[0].action must be one of goto, click, fill, press, waitFor, screenshot, expectText, expectVisible, expectValue'])
  assert.deepEqual(stepProblems([{ action: 'click', selecter: '#a', selector: '#a' }]), ['steps[0].selecter is not a field of "click" (fields: selector, timeoutMs)'])
  assert.deepEqual(stepProblems([{ action: 'goto', selector: '#a', path: '/' }]), ['steps[0].selector is not a field of "goto" (fields: path, timeoutMs)'])
})

test('an action that is a property of every object is not an action', () => {
  for (const action of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 5, null, {}]) assert.equal(stepProblems([{ action }]).length, 1, String(action))
})

test('required fields are required and strings are bounded', () => {
  const problem = (step) => stepProblems([step])
  assert.equal(problem({ action: 'click' }).length, 1)
  assert.equal(problem({ action: 'click', selector: '' }).length, 1)
  assert.equal(problem({ action: 'click', selector: 'x'.repeat(501) }).length, 1)
  assert.equal(problem({ action: 'click', selector: 'x'.repeat(500) }).length, 0)
  assert.equal(problem({ action: 'fill', selector: '#a' }).length, 1)
  assert.equal(problem({ action: 'fill', selector: '#a', value: 5 }).length, 1)
  assert.equal(problem({ action: 'fill', selector: '#a', value: 'x'.repeat(10_001) }).length, 1)
  assert.equal(problem({ action: 'press' }).length, 1)
  assert.equal(problem({ action: 'press', key: '' }).length, 1)
  assert.equal(problem({ action: 'waitFor' }).length, 1)
  assert.equal(problem({ action: 'expectText' }).length, 1)
  assert.equal(problem({ action: 'expectText', text: '' }).length, 1)
  assert.equal(problem({ action: 'expectVisible' }).length, 1)
  assert.equal(problem({ action: 'expectValue', selector: '#a' }).length, 1)
  assert.equal(problem({ action: 'expectValue', value: 'x' }).length, 1)
  assert.equal(problem({ action: 'expectValue', selector: '#a', value: '' }).length, 0)
})

test('timeoutMs is a whole number of milliseconds from 1 to 60000', () => {
  for (const timeoutMs of [0, -1, 60_001, 1.5, '100', null]) assert.equal(stepProblems([{ action: 'click', selector: '#a', timeoutMs }]).length, 1, String(timeoutMs))
  for (const timeoutMs of [1, 60_000]) assert.deepEqual(stepProblems([{ action: 'click', selector: '#a', timeoutMs }]), [])
})

test('goto takes a path on the target: one leading /, no backslash, no space, no control character', () => {
  for (const path of ['', 'orders', '//evil.example.com/x', 'https://evil.example.com/', '/\\evil.example.com', '/a b', '/a\nb', '/a\tb', '/a\u0000b', 5]) {
    assert.equal(stepProblems([{ action: 'goto', path }]).length, 1, JSON.stringify(path))
  }
  for (const path of ['/', '/orders', '/orders/42?tab=1#top', '/a%20b']) assert.deepEqual(stepProblems([{ action: 'goto', path }]), [], path)
})

test('a screenshot name is a safe file name', () => {
  for (const name of ['', '../x', 'a/b', 'a b', 'a.png', 'x'.repeat(65)]) assert.equal(stepProblems([{ action: 'screenshot', name }]).length, 1, name)
  assert.deepEqual(stepProblems([{ action: 'screenshot', name: 'x'.repeat(64) }]), [])
})

test('every problem names its step, and what the profile typed is not repeated', () => {
  const problems = stepProblems([{ action: 'fill', selector: '#a', value: 1 }, { action: 'fill', selector: '#b', value: 'ok' }, { action: 'click', selector: 'FAKE_SECRET'.repeat(100) }])

  assert.equal(problems.length, 2)
  assert.ok(problems[0].startsWith('steps[0].value'))
  assert.ok(problems[1].startsWith('steps[2].selector'))
  assert.ok(!problems.join('').includes('FAKE_SECRET'))
})

test('parseSteps returns the steps, and says invalid JSON without quoting it', () => {
  assert.deepEqual(parseSteps(JSON.stringify(allActions)), allActions)
  assert.throws(() => parseSteps('[{ "action": FAKE_SECRET'), (error) => error instanceof UsageError && /not valid JSON/.test(error.message) && !error.message.includes('FAKE_SECRET'))
})

test('parseSteps lists the problems, ten at most, and counts the rest', () => {
  const steps = Array.from({ length: 25 }, () => ({ action: 'click' }))

  assert.throws(
    () => parseSteps(JSON.stringify(steps)),
    (error) => error instanceof UsageError && error.message.includes('steps[0].selector') && error.message.includes('steps[9].selector') && !error.message.includes('steps[10].selector') && /and 15 more/.test(error.message),
  )
})

test('loadSteps reads a file, and refuses one that is missing, too large or not a file, without quoting any of them', async (t) => {
  const dir = await tempDir(t)
  await writeFile(join(dir, 'ok.json'), JSON.stringify(allActions))
  await writeFile(join(dir, 'big.json'), ' '.repeat(MAX_FILE_BYTES + 1))
  const exact = '[{"action":"press","key":"Tab"}]'
  await writeFile(join(dir, 'exact.json'), exact + ' '.repeat(MAX_FILE_BYTES - exact.length))
  await writeFile(join(dir, 'bad.json'), 'FAKE_SECRET')
  await mkdir(join(dir, 'folder.json'))

  assert.deepEqual(await loadSteps(join(dir, 'ok.json')), allActions)
  assert.equal((await loadSteps(join(dir, 'exact.json'))).length, 1)
  await assert.rejects(loadSteps(join(dir, 'missing.json')), (error) => error instanceof UsageError && /cannot read/.test(error.message))
  await assert.rejects(loadSteps(join(dir, 'big.json')), (error) => error instanceof UsageError && /larger than/.test(error.message))
  await assert.rejects(loadSteps(join(dir, 'folder.json')), (error) => error instanceof UsageError && /not a file/.test(error.message))
  await assert.rejects(loadSteps(join(dir, 'bad.json')), (error) => error instanceof UsageError && error.message.includes('bad.json') && !error.message.includes('FAKE_SECRET'))
})
