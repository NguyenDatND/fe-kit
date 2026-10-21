import assert from 'node:assert/strict'
import { test } from 'node:test'
import { codeView, compileProfileRules, GENERAL_RULES, scanLines } from '../src/lib/scan-rules.mjs'

/** The ids of the general rules that fire on one added line of `file`. */
const hits = (file, text) => scanLines([{ file, line: 1, text }], GENERAL_RULES).map((finding) => finding.rule)

// [file, line, rule]: the line must be reported by that rule and by no other.
const POSITIVE = [
  // conflict markers sit at the start of the line, in any kind of file
  ['a.ts', '<<<<<<< HEAD', 'conflict-marker'],
  ['a.ts', '<<<<<<<', 'conflict-marker'],
  ['a.css', '=======', 'conflict-marker'],
  ['a.ts', '>>>>>>> feature/login', 'conflict-marker'],
  ['README.md', '<<<<<<< HEAD', 'conflict-marker'],

  // explicit any, in the places a type can stand
  ['a.ts', 'const x: any = 1', 'no-explicit-any'],
  ['a.tsx', 'function f(a: any) {}', 'no-explicit-any'],
  ['a.ts', 'function f(): any {', 'no-explicit-any'],
  ['a.ts', 'const y = z as any', 'no-explicit-any'],
  ['a.ts', '(z as any).foo = 1', 'no-explicit-any'],
  ['a.ts', 'const m: Record<string, any> = {}', 'no-explicit-any'],
  ['a.ts', 'const p: Promise<any> = load()', 'no-explicit-any'],
  ['a.ts', 'let list: any[] = []', 'no-explicit-any'],
  ['a.ts', 'const list = new Array<any>()', 'no-explicit-any'],
  ['a.ts', 'const v = <any>value', 'no-explicit-any'],
  ['a.ts', 'type T = string | any', 'no-explicit-any'],
  ['a.ts', 'function f<T = any>() {}', 'no-explicit-any'],
  ['a.ts', '} catch (error: any) {', 'no-explicit-any'],
  ['a.ts', 'interface P { value?: any }', 'no-explicit-any'],
  ['a.mts', 'export const handler: any = null', 'no-explicit-any'],
  ['a.ts', 'type Payload = any', 'no-explicit-any'],
  ['a.ts', 'type Payload = any;', 'no-explicit-any'],
  ['a.ts', 'type Handler = (event: Event) => any', 'no-explicit-any'],
  ['a.ts', 'type Fn = () => any;', 'no-explicit-any'],
  ['a.ts', 'const pair: [any, string] = value', 'no-explicit-any'],
  ['a.ts', 'let list: readonly any[] = []', 'no-explicit-any'],
  ['a.ts', 'type Key = keyof any', 'no-explicit-any'],
  ['a.ts', 'function isThing(x): x is any {', 'no-explicit-any'],

  ['a.tsx', '<div dangerouslySetInnerHTML={{ __html: html }} />', 'dangerously-set-inner-html'],
  ['a.jsx', 'return <p dangerouslySetInnerHTML={markup} />', 'dangerously-set-inner-html'],

  ['a.ts', 'eval(code)', 'no-eval'],
  ['a.js', 'const r = eval ("1 + 1")', 'no-eval'],
  ['a.ts', 'const f = new Function("a", "return a")', 'no-eval'],
  ['a.ts', 'const g = new  Function(body)', 'no-eval'],
  ['a.ts', 'window.eval(code)', 'no-eval'],
  ['a.ts', '(0, eval)(code)', 'no-eval'],

  ['a.ts', 'el.innerHTML = html', 'inner-html-assignment'],
  ['a.js', 'el.innerHTML += more', 'inner-html-assignment'],
  ['a.js', 'this.root.innerHTML=""', 'inner-html-assignment'],
  ['a.ts', 'el.outerHTML = html', 'inner-html-assignment'],
  ['a.ts', "el.insertAdjacentHTML('beforeend', html)", 'inner-html-assignment'],
  ['a.js', 'document.write(markup)', 'inner-html-assignment'],

  ['a.test.ts', "describe.only('x', () => {", 'focused-or-skipped-test'],
  ['a.test.ts', "it.skip('x', () => {})", 'focused-or-skipped-test'],
  ['a.spec.ts', "test.only('x', async () => {})", 'focused-or-skipped-test'],
  ['a.spec.ts', "test.describe.only('x', () => {})", 'focused-or-skipped-test'],
  ['a.test.ts', "it.concurrent.only('x', () => {})", 'focused-or-skipped-test'],
  ['a.test.js', "fit('x', () => {})", 'focused-or-skipped-test'],
  ['a.test.js', "xdescribe('x', () => {})", 'focused-or-skipped-test'],

  ['a.ts', 'console.log(value)', 'console-log'],
  ['src/a.tsx', '    console.log ("here")', 'console-log'],

  ['a.ts', '// see .fe-kit/specs/login.md', 'fe-kit-leak'],
  ['a.ts', "import data from '../.fe-kit/tests/data'", 'fe-kit-leak'],
  ['docs/notes.md', 'The plan is in .fe-kit/plans/x.md', 'fe-kit-leak'],
  ['a.ts', 'const dir = ".fe-kit"', 'fe-kit-leak'],
]

for (const [file, text, rule] of POSITIVE) {
  test(`${rule} fires on ${JSON.stringify(text)} in ${file}`, () => {
    assert.deepEqual(hits(file, text), [rule])
  })
}

const NEGATIVE = [
  // not at the start of the line, or not seven characters
  ['a.ts', '  <<<<<<< HEAD'],
  ['a.ts', '<<<<<< six'],
  ['a.ts', '======== eight'],
  ['a.ts', 'const eq = a ======= b'],
  ['README.md', '======='], // an underline of a heading, not a marker

  // any: words, comments, strings, prose, other languages
  ['a.ts', 'const company = many(1)'],
  ['a.ts', '// x: any thing goes here'],
  ['a.ts', '/* value as any */ run()'],
  ['a.ts', "const s = ': any'"],
  ['a.ts', 'const s = `x as any`'],
  ['a.ts', 'expect(fn).toHaveBeenCalledWith(expect.any(Number))'],
  ['a.tsx', '<p>Note: any change is saved at once</p>'],
  ['a.ts', 'const anyone = 1'],
  ['a.ts', 'if (list.any(isOk)) {}'],
  ['a.js', 'const x = y // value: any'],
  ['a.js', 'function f(a: any) {}'], // not TypeScript, so not this rule's business
  ['a.ts', ' * @param value any value is accepted'],
  ['a.ts', 'const label = "any"'],
  ['a.ts', 'const anything = items.map((item) => anyOf(item))'],
  ['a.ts', 'const handler = () => anyone.say()'],
  ['a.ts', 'type Many = Array<manyThings>'],
  ['a.ts', 'const ok = value => any.length'],

  ['a.ts', '// dangerouslySetInnerHTML is banned here'],
  ['a.tsx', "const warning = 'never use dangerouslySetInnerHTML'"],
  ['a.ts', 'const dangerouslySetInnerHTMLCount = 0'],

  ['a.ts', "await page.$eval('a', (el) => el.href)"],
  ['a.ts', 'obj.eval(x)'],
  ['a.ts', '// eval(x)'],
  ['a.ts', 'const medieval = retrieval(x)'],
  ['a.ts', 'evaluate(x)'],
  ['a.ts', 'const s = "eval("'],
  ['a.ts', 'new FunctionComponent()'],
  ['src/legacy/runner.d.ts', 'export function eval(code: string): unknown'],
  ['a.ts', 'function eval(code) {}'],

  ['a.ts', 'if (el.innerHTML === html) {}'],
  ['a.ts', 'const html = el.innerHTML'],
  ['a.ts', '// el.innerHTML = html'],
  ['a.ts', "const s = 'el.innerHTML = x'"],
  ['a.ts', 'if (el.outerHTML === html) {}'],
  ['a.ts', 'const html = el.outerHTML'],
  ['a.ts', "el.insertAdjacentElement('beforeend', child)"],
  ['a.ts', 'logger.write(markup)'],

  ['a.test.ts', 'const only = 1'],
  ['a.test.ts', 'list.skip(2)'],
  ['a.test.ts', "it('should skip the intro', () => {})"],
  ['a.test.ts', "it.each([1, 2])('adds %i', () => {})"],
  ['a.test.ts', "// it.only('x', () => {})"],
  ['Terminal.test.tsx', 'fitAddon.fit()'],
  ['model.test.ts', 'await model.fit(xs, ys, { epochs: 5 })'],
  ['map.test.ts', 'map.fit(bounds)'],
  ['chart.test.ts', 'chart.xit(1)'],
  ['Terminal.tsx', 'fit("x", () => {})'], // the legacy names are rules for test files; a component may have a function called fit

  ['a.ts', 'console.error(value)'],
  ['a.ts', '// console.log(value)'],
  ['a.ts', "const s = 'console.log('"],
  ['a.test.ts', 'console.log(value)'],
  ['Button.stories.tsx', 'console.log(value)'],
  ['src/__tests__/a.ts', 'console.log(value)'],
  ['scripts/build.mjs', 'console.log(value)'],
  ['vite.config.ts', 'console.log(value)'],

  ['a.ts', 'run("fe-kit scan")'],
  ['a.ts', 'const kitten = ".fe-kitten"'],
  ['.gitignore', '.fe-kit/'],
  ['packages/web/.gitignore', '/.fe-kit/'],
]

for (const [file, text] of NEGATIVE) {
  test(`nothing fires on ${JSON.stringify(text)} in ${file}`, () => {
    assert.deepEqual(hits(file, text), [])
  })
}

test('a finding names the rule, the place, the line and what to do about it', () => {
  const [finding] = scanLines([{ file: 'src/a.ts', line: 12, text: '  const x: any = 1  ' }], GENERAL_RULES)

  assert.equal(finding.rule, 'no-explicit-any')
  assert.equal(finding.file, 'src/a.ts')
  assert.equal(finding.line, 12)
  assert.equal(finding.text, 'const x: any = 1')
  assert.match(finding.message, /any/)
})

test('one line can break several rules, and each is reported', () => {
  assert.deepEqual(hits('a.ts', 'console.log(el.innerHTML = (x as any))'), ['no-explicit-any', 'inner-html-assignment', 'console-log'])
})

test('a very long line is generated or minified code and is left alone', () => {
  assert.deepEqual(hits('bundle.js', `eval(${'x'.repeat(5000)})`), [])
})

test('the general rules have unique ids and a message each', () => {
  const ids = GENERAL_RULES.map((rule) => rule.id)

  assert.equal(new Set(ids).size, ids.length)
  assert.ok(GENERAL_RULES.every((rule) => rule.message.length > 10))
  assert.deepEqual(ids, ['conflict-marker', 'no-explicit-any', 'dangerously-set-inner-html', 'no-eval', 'inner-html-assignment', 'focused-or-skipped-test', 'console-log', 'fe-kit-leak'])
})

test('a rule of a profile is matched against the raw line and only in the files it names', () => {
  const rules = compileProfileRules([
    { id: 'no-moment', pattern: "from ['\"]moment['\"]", message: 'use date-fns', files: ['src/**/*.ts'] },
    { id: 'no-lodash', pattern: 'lodash', message: 'use the platform' },
  ])
  const lines = [
    { file: 'src/a.ts', line: 1, text: "import moment from 'moment'" },
    { file: 'scripts/a.ts', line: 1, text: "import moment from 'moment'" },
    { file: 'scripts/b.js', line: 4, text: "import _ from 'lodash'" },
  ]

  assert.deepEqual(
    scanLines(lines, rules).map((finding) => `${finding.rule}@${finding.file}:${finding.line}`),
    ['no-moment@src/a.ts:1', 'no-lodash@scripts/b.js:4'],
  )
})

test('codeView drops comments and the inside of strings, and keeps the code', () => {
  const blank = (count) => ' '.repeat(count)

  assert.equal(codeView('const a = 1 // note'), 'const a = 1 ')
  assert.equal(codeView("const a = 'x: any'"), `const a = '${blank(6)}'`)
  assert.equal(codeView('const a = "q\\"x" + b'), `const a = "${blank(4)}" + b`)
  assert.equal(codeView('run(/* any */ x)'), 'run(  x)')
  assert.equal(codeView('  // all comment'), '')
  assert.equal(codeView(' * continued comment'), '')
  assert.equal(codeView('a * b'), 'a * b')
  assert.equal(codeView('const t = `a${b}c`'), `const t = \`${blank(6)}\``)
})

test('an apostrophe in JSX text or a quote in a regular expression does not blank the rest of the line', () => {
  assert.deepEqual(hits('a.tsx', "const x = <p>Don't</p>; const y: any = 1"), ['no-explicit-any'])
  assert.deepEqual(hits('a.ts', "const re = /'/g; const y: any = 1"), ['no-explicit-any'])
  assert.deepEqual(hits('a.ts', 'const re = /\\"/g; const y: any = 1'), ['no-explicit-any'])
  assert.equal(codeView("<p>Don't use any</p>; run(x)"), "<p>Don't use any</p>; run(x)")
})

test('a template literal may run over several lines, so an open backtick still blanks what follows', () => {
  assert.equal(codeView('const t = `start of a template as any'), `const t = \`${' '.repeat('start of a template as any'.length)}`)
})

test('a string that does close on its line is still blanked', () => {
  assert.equal(codeView("run('x: any', y)"), `run('${' '.repeat(6)}', y)`)
})

test('a block comment that closes at the start of a line does not hide the code after it', () => {
  assert.equal(codeView('/* annotation */ const value: any = 1'), '  const value: any = 1')
  assert.deepEqual(scanLines([{ file: 'a.ts', line: 1, text: '/* @__PURE__ */ eval(input)' }], GENERAL_RULES).map((finding) => finding.rule), ['no-eval'])
  assert.equal(codeView('/* still open'), '')
  assert.equal(codeView('/* only a comment */'), ' ')
})
