import assert from 'node:assert/strict'
import { test } from 'node:test'
import { UsageError } from '../src/lib/errors.mjs'
import { parseViewports } from '../src/lib/ui-viewports.mjs'

const mobile = { name: 'mobile', width: 375, height: 812 }
const tablet = { name: 'tablet', width: 768, height: 1024 }
const desktop = { name: 'desktop', width: 1280, height: 800 }

test('without --viewports a plain run takes pictures at mobile, tablet and desktop sizes', () => {
  assert.deepEqual(parseViewports(undefined, { hasSteps: false }), [mobile, tablet, desktop])
})

test('a run with steps takes desktop only: the steps run once', () => {
  assert.deepEqual(parseViewports(undefined, { hasSteps: true }), [desktop])
})

test('names and WIDTHxHEIGHT sizes can be mixed, in the order given', () => {
  assert.deepEqual(parseViewports('desktop,390x844,mobile', { hasSteps: false }), [desktop, { name: '390x844', width: 390, height: 844 }, mobile])
})

test('a size repeated is taken once', () => {
  assert.deepEqual(parseViewports('mobile,mobile,375x812', { hasSteps: false }), [mobile, { name: '375x812', width: 375, height: 812 }])
})

test('steps and several viewports together are a usage error, since the steps would run for each', () => {
  assert.throws(() => parseViewports('mobile,desktop', { hasSteps: true }), (error) => error instanceof UsageError && /steps/.test(error.message))
  assert.deepEqual(parseViewports('mobile', { hasSteps: true }), [mobile])
})

test('an unknown name, a size out of range or a malformed one is a usage error that lists the choices', () => {
  for (const bad of ['phone', '99x800', '800x99', '4001x800', '800x4001', '800', '800x', 'x800', '800X600', '-1x5', '1e3x800', '', ',', 'mobile,', ' mobile']) {
    assert.throws(() => parseViewports(bad, { hasSteps: false }), (error) => error instanceof UsageError && /mobile, tablet, desktop/.test(error.message), JSON.stringify(bad))
  }
})

test('the limits themselves are accepted, and no more than 6 viewports', () => {
  assert.deepEqual(parseViewports('100x100,4000x4000', { hasSteps: false }).map((viewport) => viewport.name), ['100x100', '4000x4000'])
  assert.equal(parseViewports('100x100,101x100,102x100,103x100,104x100,105x100', { hasSteps: false }).length, 6)
  assert.throws(() => parseViewports('100x100,101x100,102x100,103x100,104x100,105x100,106x100', { hasSteps: false }), UsageError)
})
