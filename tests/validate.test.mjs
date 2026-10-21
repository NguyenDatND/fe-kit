import assert from 'node:assert/strict'
import { symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { run } from '../src/commands/validate.mjs'
import { tempDir, writeTree } from './helpers.mjs'

const kitRoot = fileURLToPath(new URL('..', import.meta.url))
const POLICY = 'policy:\n  allow_implicit_invocation: false\n'

async function validate(t, skills) {
  const dir = await tempDir(t)
  const files = {}
  for (const [name, spec] of Object.entries(skills)) {
    if (spec === null) {
      files[`${name}/notes.txt`] = 'a skill directory without SKILL.md'
      continue
    }
    const { frontmatter, body = 'Do the thing.\n', openai, references = {} } = spec
    files[`${name}/SKILL.md`] = frontmatter === undefined ? body : `---\n${frontmatter}\n---\n${body}`
    if (openai !== undefined) files[`${name}/agents/openai.yaml`] = openai
    for (const [file, text] of Object.entries(references)) files[`${name}/references/${file}`] = text
  }
  await writeTree(dir, files)
  const result = await run({ args: [], flags: { 'skills-dir': dir }, cwd: dir, env: {}, kitRoot })
  return { ...result, problems: result.data.problems.map((p) => `${p.skill} ${p.rule}`) }
}

const modelSkill = (name = 'fe-verify') => ({
  frontmatter: `name: ${name}\ndescription: Use when about to report a task as done.`,
})
const invokerSkill = (name = 'fe-setup') => ({
  frontmatter: `name: ${name}\ndescription: Set up fe-kit for a repository.\ndisable-model-invocation: true`,
  openai: POLICY,
})

test('valid model-invoked and user-invoked skills pass', async (t) => {
  const { data, problems, exitCode } = await validate(t, { 'fe-verify': modelSkill(), 'fe-setup': invokerSkill() })

  assert.equal(data.checked, 2)
  assert.deepEqual(problems, [])
  assert.equal(exitCode ?? 0, 0)
})

test('missing frontmatter and a missing SKILL.md are reported', async (t) => {
  const { problems, exitCode } = await validate(t, { 'no-front': { body: 'just text' }, empty: null })

  assert.deepEqual(problems, ['empty skill-md-missing', 'no-front frontmatter-missing'])
  assert.equal(exitCode, 1)
})

test('a description with an unquoted colon is invalid YAML (it made skills fail to load in agy)', async (t) => {
  const { problems } = await validate(t, {
    'fe-bad': { frontmatter: 'name: fe-bad\ndescription: Use when you fix a bug: always reproduce it first.' },
  })

  assert.deepEqual(problems, ['fe-bad frontmatter-yaml'])
})

test('only name, description and disable-model-invocation are allowed', async (t) => {
  const { data } = await validate(t, {
    'fe-x': { frontmatter: 'name: fe-x\ndescription: Use when x.\nallowed-tools: Read\nmodel: opus' },
  })

  assert.deepEqual(data.problems.map((p) => p.rule), ['frontmatter-keys'])
  assert.match(data.problems[0].message, /allowed-tools, model/)
})

test('disable-model-invocation must be a boolean', async (t) => {
  const { problems } = await validate(t, {
    'fe-x': { frontmatter: 'name: fe-x\ndescription: Use when x.\ndisable-model-invocation: "yes"' },
  })

  assert.deepEqual(problems, ['fe-x disable-model-invocation'])
})

test('name must exist, match the directory, be kebab-case and fit in 64 characters', async (t) => {
  const tooLong = `fe-${'a'.repeat(62)}`
  const { data } = await validate(t, {
    'no-name': { frontmatter: 'description: Use when x.' },
    'dir-name': { frontmatter: 'name: other\ndescription: Use when x.' },
    Upper: { frontmatter: 'name: Upper\ndescription: Use when x.' },
    [tooLong]: { frontmatter: `name: ${tooLong}\ndescription: Use when x.` },
  })

  const byRule = data.problems.map((p) => `${p.skill}: ${p.message}`)
  assert.equal(byRule.length, 4)
  assert.match(byRule.find((m) => m.startsWith('no-name')), /name is required/)
  assert.match(byRule.find((m) => m.startsWith('dir-name')), /must match the directory/)
  assert.match(byRule.find((m) => m.startsWith('Upper')), /lowercase/)
  assert.match(byRule.find((m) => m.startsWith(tooLong)), /65 characters/)
})

test('description must exist, fit in 1024 characters and start with "Use when" for model-invoked skills', async (t) => {
  const longDescription = `Use when ${'x'.repeat(1020)}`
  const { data } = await validate(t, {
    'no-desc': { frontmatter: 'name: no-desc' },
    long: { frontmatter: `name: long\ndescription: ${longDescription}` },
    'wrong-start': { frontmatter: 'name: wrong-start\ndescription: Runs the checks.' },
  })

  const messages = Object.fromEntries(data.problems.map((p) => [p.skill, p.message]))
  assert.match(messages['no-desc'], /description is required/)
  assert.match(messages.long, new RegExp(`${longDescription.length} characters`))
  assert.match(messages['wrong-start'], /starts with "Use when"/)
})

test('a user-invoked skill needs agents/openai.yaml that disables implicit invocation', async (t) => {
  const { problems, data } = await validate(t, {
    'fe-a': { ...invokerSkill('fe-a'), openai: undefined },
    'fe-b': { ...invokerSkill('fe-b'), openai: 'policy:\n  allow_implicit_invocation: true\n' },
    'fe-c': { ...invokerSkill('fe-c'), openai: 'policy: [unclosed' },
    'fe-d': invokerSkill('fe-d'),
  })

  assert.deepEqual(problems, ['fe-a openai-yaml', 'fe-b openai-yaml', 'fe-c openai-yaml'])
  assert.match(data.problems[0].message, /required/)
})

test('a body of 499 lines is fine and 500 lines is not', async (t) => {
  const lines = (count) => `${Array.from({ length: count }, (_, i) => `line ${i}`).join('\n')}\n`
  const { problems } = await validate(t, {
    'fe-ok': { ...modelSkill('fe-ok'), body: lines(499) },
    'fe-big': { ...modelSkill('fe-big'), body: lines(500) },
  })

  assert.deepEqual(problems, ['fe-big body-length'])
})

test('no skills directory means nothing to check', async (t) => {
  const dir = await tempDir(t)

  const { data, exitCode } = await run({ args: [], flags: { 'skills-dir': join(dir, 'nope') }, cwd: dir, env: {}, kitRoot })

  assert.equal(data.checked, 0)
  assert.deepEqual(data.problems, [])
  assert.equal(exitCode ?? 0, 0)
})

test('the text form names each problem and summarizes', async (t) => {
  const { text } = await validate(t, { 'no-front': { body: 'x' } })

  assert.match(text, /no-front: frontmatter-missing/)
  assert.match(text, /1 skill checked, 1 problem/)
})

test('a skill installed as a symlink is checked too', async (t) => {
  const dir = await tempDir(t)
  const real = await tempDir(t)
  await writeTree(real, { 'fe-bad/SKILL.md': 'no frontmatter' })
  await symlink(join(real, 'fe-bad'), join(dir, 'fe-bad'))

  const { data } = await run({ args: [], flags: { 'skills-dir': dir }, cwd: dir, env: {}, kitRoot })

  assert.equal(data.checked, 1)
  assert.deepEqual(data.problems.map((p) => p.rule), ['frontmatter-missing'])
})

const withReferences = (references) => ({ 'fe-standards': { ...modelSkill('fe-standards'), references } })

test('a reference may have no frontmatter, or paths and frameworks of the right shape', async (t) => {
  const { problems } = await validate(
    t,
    withReferences({
      'plain.md': '# Plain\n',
      'one.md': '---\npaths: "**/*.ts"\n---\n# One\n',
      'many.md': '---\npaths:\n  - "**/*.tsx"\n  - "**/*.jsx"\nframeworks: [next, vite]\n---\n# Many\n',
      'notes.txt': '---\npaths: 7\n---\nnot a reference, so not read as one',
    }),
  )

  assert.deepEqual(problems, [])
})

test('a reference with frontmatter that rules would misread is reported, naming the file', async (t) => {
  const { data, problems } = await validate(
    t,
    withReferences({
      'yaml.md': '---\npaths: [oops\n---\n',
      'paths.md': '---\npaths: 7\n---\n',
      'list.md': '---\npaths: ["**/*.ts", 4]\n---\n',
      'frameworks.md': '---\nframeworks: {a: b}\n---\n',
      'name.md': '---\nframeworks: [nextjs]\n---\n',
      'key.md': '---\npath: "**/*.ts"\n---\n',
      'glob.md': '---\npaths: ["src/[z-a]/*.ts"]\n---\n',
      'scalar.md': '---\njust text\n---\n',
    }),
  )

  assert.equal(problems.length, 8)
  assert.ok(problems.every((problem) => problem === 'fe-standards reference-frontmatter'))
  const messages = data.problems.map((problem) => problem.message).sort()
  assert.match(messages.join('\n'), /references\/yaml\.md: frontmatter is not valid YAML/)
  assert.match(messages.join('\n'), /references\/paths\.md: "paths" must be a glob or a list of globs/)
  assert.match(messages.join('\n'), /references\/list\.md: "paths" must be a glob or a list of globs/)
  assert.match(messages.join('\n'), /references\/frameworks\.md: "frameworks" must be a name or a list of names/)
  assert.match(messages.join('\n'), /references\/name\.md: unknown framework "nextjs" \(known: next, nuxt, remix, astro, sveltekit, angular-cli, cra, vite\)/)
  assert.match(messages.join('\n'), /references\/glob\.md: "paths" has a glob that is not valid/)
  assert.match(messages.join('\n'), /references\/key\.md: unknown frontmatter key "path" \(allowed: paths, frameworks\)/)
  assert.match(messages.join('\n'), /references\/scalar\.md: frontmatter must be a YAML mapping/)
})

test('the references that ship with the kit pass validation', async () => {
  const { data } = await run({ args: [], flags: {}, cwd: kitRoot, env: {}, kitRoot })

  assert.deepEqual(data.problems.filter((problem) => problem.rule === 'reference-frontmatter'), [])
})
