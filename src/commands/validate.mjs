import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { firstLine, splitFrontmatter } from '../lib/frontmatter.mjs'
import { FRAMEWORK_NAMES } from '../lib/detect.mjs'
import { plural } from '../lib/format.mjs'
import { isValidGlob } from '../lib/glob.mjs'

export const options = { 'skills-dir': { type: 'string' } }

export const usage = `Usage: fe-kit validate [--skills-dir <dir>] [--json]

Checks the skills of the kit: frontmatter, names, descriptions, size and the references of each skill.
Exit code: 0 when all is well, 1 when a problem is found.
`

const ALLOWED_KEYS = ['name', 'description', 'disable-model-invocation']
const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/
const MAX_NAME_LENGTH = 64
const MAX_DESCRIPTION_LENGTH = 1024
const MAX_BODY_LINES = 499
const REFERENCE_KEYS = ['paths', 'frameworks'] // what `fe-kit rules` reads from a reference document

async function checkOpenaiYaml(skillDir, add) {
  let text
  try {
    text = await readFile(join(skillDir, 'agents', 'openai.yaml'), 'utf8')
  } catch {
    add('openai-yaml', 'agents/openai.yaml is required for a skill only the user can invoke')
    return
  }
  let policy
  try {
    policy = parseYaml(text)?.policy
  } catch (error) {
    add('openai-yaml', `agents/openai.yaml is not valid YAML: ${firstLine(error.message)}`)
    return
  }
  if (policy?.allow_implicit_invocation !== false) {
    add('openai-yaml', 'agents/openai.yaml must set policy.allow_implicit_invocation: false')
  }
}

const isGlobOrList = (value) => typeof value === 'string' || (Array.isArray(value) && value.every((item) => typeof item === 'string'))

/** `references/*.md` may say what they cover (`paths`, `frameworks`); a typo there would silently make them cover everything or nothing. */
async function checkReferences(skillDir, add) {
  let names
  try {
    names = (await readdir(join(skillDir, 'references'))).filter((name) => name.endsWith('.md')).sort()
  } catch {
    return // no references folder
  }
  for (const name of names) {
    const problem = (message) => add('reference-frontmatter', `references/${name}: ${message}`)
    const text = await readFile(join(skillDir, 'references', name), 'utf8').catch(() => null)
    const parts = text === null ? null : splitFrontmatter(text)
    if (!parts) continue
    let data
    try {
      data = parseYaml(parts.raw)
    } catch (error) {
      problem(`frontmatter is not valid YAML: ${firstLine(error.message)}`)
      continue
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      problem('frontmatter must be a YAML mapping')
      continue
    }
    for (const key of Object.keys(data)) {
      if (!REFERENCE_KEYS.includes(key)) problem(`unknown frontmatter key "${key}" (allowed: ${REFERENCE_KEYS.join(', ')})`)
    }
    if (data.paths !== undefined && !isGlobOrList(data.paths)) problem('"paths" must be a glob or a list of globs')
    else if (data.paths !== undefined && ![data.paths].flat().every(isValidGlob)) problem('"paths" has a glob that is not valid')
    if (data.frameworks === undefined) continue
    if (!isGlobOrList(data.frameworks)) {
      problem('"frameworks" must be a name or a list of names')
      continue
    }
    for (const framework of [data.frameworks].flat()) {
      if (!FRAMEWORK_NAMES.includes(framework)) problem(`unknown framework "${framework}" (known: ${FRAMEWORK_NAMES.join(', ')})`)
    }
  }
}

async function checkSkill(skillsDir, dirName) {
  const problems = []
  const add = (rule, message) => problems.push({ skill: dirName, rule, message })
  const skillDir = join(skillsDir, dirName)

  let text
  try {
    text = await readFile(join(skillDir, 'SKILL.md'), 'utf8')
  } catch {
    add('skill-md-missing', 'SKILL.md not found')
    return problems
  }
  const parts = splitFrontmatter(text)
  if (!parts) {
    add('frontmatter-missing', 'SKILL.md must start with --- frontmatter')
    return problems
  }
  let data
  try {
    data = parseYaml(parts.raw)
  } catch (error) {
    add('frontmatter-yaml', `frontmatter is not valid YAML: ${firstLine(error.message)}`)
    return problems
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    add('frontmatter-yaml', 'frontmatter must be a YAML mapping')
    return problems
  }

  const unknown = Object.keys(data).filter((key) => !ALLOWED_KEYS.includes(key))
  if (unknown.length > 0) {
    add('frontmatter-keys', `unknown frontmatter keys: ${unknown.join(', ')} (allowed: ${ALLOWED_KEYS.join(', ')})`)
  }

  const flag = data['disable-model-invocation']
  if (flag !== undefined && typeof flag !== 'boolean') add('disable-model-invocation', 'must be true or false')
  const userInvokedOnly = flag === true

  const { name, description } = data
  if (typeof name !== 'string' || name === '') {
    add('name', 'name is required')
  } else {
    if (name !== dirName) add('name', `name "${name}" must match the directory "${dirName}"`)
    if (!KEBAB_CASE.test(name)) add('name', `name "${name}" must be lowercase letters, digits and hyphens`)
    if (name.length > MAX_NAME_LENGTH) add('name', `name is ${name.length} characters, the limit is ${MAX_NAME_LENGTH}`)
  }

  if (typeof description !== 'string' || description.trim() === '') {
    add('description', 'description is required')
  } else {
    if (description.length > MAX_DESCRIPTION_LENGTH) {
      add('description', `description is ${description.length} characters, the limit is ${MAX_DESCRIPTION_LENGTH}`)
    }
    if (!userInvokedOnly && !description.startsWith('Use when')) {
      add('description', 'a skill the model can invoke must have a description that starts with "Use when"')
    }
  }

  if (userInvokedOnly) await checkOpenaiYaml(skillDir, add)

  const body = parts.body.trimEnd()
  const bodyLines = body === '' ? 0 : body.split('\n').length
  if (bodyLines > MAX_BODY_LINES) add('body-length', `body is ${bodyLines} lines, the limit is ${MAX_BODY_LINES}`)

  await checkReferences(skillDir, add)
  return problems
}

/** Checks every skill directory under `skills/` (or `--skills-dir`) against the rules in plan §11. */
export async function run({ flags, kitRoot }) {
  const skillsDir = flags['skills-dir'] ? resolve(flags['skills-dir']) : join(kitRoot, 'skills')
  let names = []
  try {
    const entries = await readdir(skillsDir, { withFileTypes: true })
    // A symlink counts: that is how skills are installed. A dangling one is reported as a missing SKILL.md.
    names = entries
      .filter((entry) => (entry.isDirectory() || entry.isSymbolicLink()) && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .sort()
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }

  const problems = (await Promise.all(names.map((name) => checkSkill(skillsDir, name)))).flat()
  const summary = `${plural(names.length, 'skill')} checked, ${plural(problems.length, 'problem')}`
  const lines = problems.map(({ skill, rule, message }) => `${skill}: ${rule}: ${message}`)
  return {
    data: { skillsDir, checked: names.length, problems },
    text: `${[...lines, summary].join('\n')}\n`,
    exitCode: problems.length > 0 ? 1 : 0,
  }
}
