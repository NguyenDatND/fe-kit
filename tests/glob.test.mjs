import assert from 'node:assert/strict'
import { test } from 'node:test'
import { globToRegExp, isValidGlob, matchesAny, matchesGlob, toPosix } from '../src/lib/glob.mjs'

// [glob, path, matches]: a glob matches a whole relative path, like the `paths` of a rule file.
const CASES = [
  // star and double star
  ['**/*.tsx', 'a.tsx', true],
  ['**/*.tsx', 'src/a/b.tsx', true],
  ['**/*.tsx', 'a.ts', false],
  ['*.ts', 'a.ts', true],
  ['*.ts', 'src/a.ts', false],
  ['src/**', 'src/a.ts', true],
  ['src/**', 'src/x/y.ts', true],
  ['src/**', 'srcx/a.ts', false],
  ['src/**/*.ts', 'src/a.ts', true],
  ['src/**/*.ts', 'src/x/y/a.ts', true],
  ['src/**/*.ts', 'srcx/a.ts', false],
  ['a/**/b', 'a/b', true],
  ['a/**/b', 'a/x/y/b', true],
  ['a/**/b', 'a/xb', false],
  ['**/app/**/page.tsx', 'app/page.tsx', true],
  ['**/app/**/page.tsx', 'web/app/blog/[id]/page.tsx', true],
  ['**', 'anything/at/all.ts', true],
  ['a**b', 'axxb', true],
  ['a**b', 'a/b', false],
  ['a**', 'axx', true],
  ['a**', 'a/b', false],
  ['**b', 'xb', true],
  ['**b', 'x/b', false],
  // single character, classes, escapes
  ['file?.md', 'file1.md', true],
  ['file?.md', 'file10.md', false],
  ['file?.md', 'file/.md', false],
  ['[ab].ts', 'a.ts', true],
  ['[ab].ts', 'c.ts', false],
  ['[!ab].ts', 'c.ts', true],
  ['[^ab].ts', 'a.ts', false],
  ['[a-c].ts', 'b.ts', true],
  ['[]a].ts', '].ts', true],
  ['[]a].ts', 'a.ts', true],
  ['[]a].ts', 'b.ts', false],
  ['a[!x]b', 'ayb', true],
  ['a[!x]b', 'a/b', false],
  ['\\*.ts', '*.ts', true],
  ['\\*.ts', 'a.ts', false],
  // braces
  ['**/*.{ts,tsx}', 'a/b.tsx', true],
  ['**/*.{ts,tsx}', 'a/b.js', false],
  ['{src,lib}/**/*.ts', 'lib/a.ts', true],
  ['{src,lib}/**/*.ts', 'app/a.ts', false],
  ['{a,b{c,d}}.ts', 'bd.ts', true],
  ['{a,b{c,d}}.ts', 'b.ts', false],
  ['x/{a/b,c}/y', 'x/a/b/y', true],
  // characters that mean something to a RegExp are plain characters here
  ['a.b+c(d)^$|.ts', 'a.b+c(d)^$|.ts', true],
  ['a.ts', 'axts', false],
  // dot files and dot directories are matched, because `.fe-kit/` is one
  ['**/*.test.*', '.fe-kit/tests/x.test.ts', true],
  ['*', '.env', true],
  // `./` and a leading `/` mean the same as nothing: paths are relative to the project root
  ['./src/a.ts', 'src/a.ts', true],
  ['/src/a.ts', 'src/a.ts', true],
  ['src/a.ts', './src/a.ts', true],
  // what is not a pattern stays literal
  ['[', '[', true],
  ['{a', '{a', true],
  ['{a}', '{a}', true],
  ['{a}', 'a', false],
]

for (const [glob, path, expected] of CASES) {
  test(`glob ${JSON.stringify(glob)} ${expected ? 'matches' : 'does not match'} ${JSON.stringify(path)}`, () => {
    assert.equal(matchesGlob(path, glob), expected)
  })
}

test('matchesAny is true when one of the globs matches, and false for no globs', () => {
  assert.equal(matchesAny('src/a.tsx', ['**/*.ts', '**/*.tsx']), true)
  assert.equal(matchesAny('src/a.css', ['**/*.ts', '**/*.tsx']), false)
  assert.equal(matchesAny('src/a.css', []), false)
})

test('globToRegExp is anchored, so a glob never matches part of a path', () => {
  assert.equal(globToRegExp('a.ts').test('xa.ts'), false)
  assert.equal(globToRegExp('a.ts').test('a.tsx'), false)
})

test('toPosix leaves a posix path alone and turns the platform separator into /', () => {
  assert.equal(toPosix('src/a.ts'), 'src/a.ts')
  assert.equal(toPosix(['src', 'a.ts'].join(process.platform === 'win32' ? '\\' : '/')), 'src/a.ts')
})

test('repeated ** segments do not make matching slow', () => {
  const started = performance.now()
  const matched = matchesGlob(`${'a/'.repeat(60)}x.ts`, '**/**/**/**/**/**/y.ts')

  assert.equal(matched, false)
  assert.ok(performance.now() - started < 500, 'took too long')
})

test('a glob that cannot be compiled is invalid and matches nothing, instead of throwing', () => {
  assert.equal(isValidGlob('src/[z-a]/*.ts'), false)
  assert.equal(matchesGlob('src/q/a.ts', 'src/[z-a]/*.ts'), false)
  assert.equal(matchesAny('src/q/a.ts', ['src/[z-a]/*.ts', '**/*.ts']), true) // the other globs still count
  assert.equal(isValidGlob('src/[a-z]/*.ts'), true)
  assert.equal(isValidGlob(''), true)
})

test('a glob with a great many wildcards is invalid: it would take exponential time on a path that almost matches', () => {
  const many = '*a'.repeat(8)
  const started = performance.now()

  assert.equal(isValidGlob('*a'.repeat(6)), true)
  assert.equal(isValidGlob(many), false)
  assert.equal(matchesGlob('a'.repeat(40) + 'b', many), false)
  assert.ok(performance.now() - started < 500, 'took too long')
  assert.equal(isValidGlob('**/a/'.repeat(8)), false)
  assert.equal(isValidGlob('src/**/components/**/*.stories.{ts,tsx}'), true)
})

test('wildcards are counted per alternative of a brace group, so real-world globs are not refused', () => {
  assert.equal(isValidGlob('**/{*.test.*,*.spec.*,*.stories.*}'), true)
  assert.equal(isValidGlob('{apps,packages}/*/src/**/{*.test.*,*.spec.*}/**/*'), true)
  assert.equal(isValidGlob('{*a*a*a*a,b}*a*a*a'), false)
})
