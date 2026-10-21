import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseFrontmatter, splitFrontmatter } from '../src/lib/frontmatter.mjs'

test('splitFrontmatter returns the raw YAML and the body, and null when there is none', () => {
  assert.deepEqual(splitFrontmatter('---\nname: a\n---\nbody\n'), { raw: 'name: a', body: 'body\n' })
  assert.deepEqual(splitFrontmatter('---\r\nname: a\r\n---\r\nbody'), { raw: 'name: a', body: 'body' })
  assert.equal(splitFrontmatter('no frontmatter here'), null)
  assert.equal(splitFrontmatter('text\n---\nname: a\n---\n'), null)
})

test('parseFrontmatter gives an object, treats no frontmatter as all body, and throws on invalid YAML', () => {
  assert.deepEqual(parseFrontmatter('---\nname: a\nn: 2\n---\nbody'), { data: { name: 'a', n: 2 }, body: 'body' })
  assert.deepEqual(parseFrontmatter('plain'), { data: {}, body: 'plain' })
  assert.throws(() => parseFrontmatter('---\ndescription: Use when x: y\n---\n'))
})

test('splitFrontmatter needs the closing --- on a line of its own', () => {
  assert.equal(splitFrontmatter('---\nname: x\n---oops\nbody'), null)
  assert.equal(splitFrontmatter('---\nname: x\n----\nbody'), null)
  assert.deepEqual(splitFrontmatter('---\nname: x\n---   \nbody'), { raw: 'name: x', body: 'body' })
  assert.deepEqual(splitFrontmatter('---\nname: x\n---'), { raw: 'name: x', body: '' })
  assert.deepEqual(splitFrontmatter('---\n---\nbody'), { raw: '', body: 'body' })
  assert.deepEqual(splitFrontmatter('---\n---\nbody\n---\nmore'), { raw: '', body: 'body\n---\nmore' })
})
