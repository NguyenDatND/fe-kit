import { readFile, stat } from 'node:fs/promises'
import { UsageError } from './errors.mjs'

/**
 * The script of a `fe-kit ui` run: a list of steps in a JSON file. Strict, because a step that is misspelt must not be
 * skipped quietly and a selector or a value is a string someone else will type into a page. A problem names the step and the
 * field and never repeats what the file held: a `fill` value can be a password.
 */

export const MAX_STEPS = 200
export const MAX_FILE_BYTES = 256 * 1024
const MAX_PROBLEMS_SHOWN = 10
const MAX_TIMEOUT_MS = 60_000
const SAFE_NAME = /^[A-Za-z0-9_-]{1,64}$/
// eslint-disable-next-line no-control-regex -- the control characters are what this rejects
const PATH_ON_TARGET = /^\/(?!\/)[^\s\\\u0000-\u001f\u007f]*$/

const isText = (value, max) => typeof value === 'string' && value !== '' && value.length <= max
const FIELDS = {
  path: { valid: (value) => typeof value === 'string' && PATH_ON_TARGET.test(value), rule: 'a path on the target: one leading /, with no space, backslash or control character' },
  selector: { valid: (value) => isText(value, 500), rule: 'a non-empty string of at most 500 characters' },
  value: { valid: (value) => typeof value === 'string' && value.length <= 10_000, rule: 'a string of at most 10000 characters' },
  key: { valid: (value) => isText(value, 50), rule: 'a key name such as Enter or Tab' },
  text: { valid: (value) => isText(value, 500), rule: 'a non-empty string of at most 500 characters' },
  name: { valid: (value) => typeof value === 'string' && SAFE_NAME.test(value), rule: 'a file name of letters, digits, "-" and "_", at most 64 characters' },
  timeoutMs: { valid: (value) => Number.isInteger(value) && value >= 1 && value <= MAX_TIMEOUT_MS, rule: `a whole number of milliseconds from 1 to ${MAX_TIMEOUT_MS}` },
}
const ACTIONS = {
  goto: { required: ['path'], optional: [] },
  click: { required: ['selector'], optional: [] },
  fill: { required: ['selector', 'value'], optional: [] },
  press: { required: ['key'], optional: ['selector'] },
  waitFor: { required: ['selector'], optional: [] },
  screenshot: { required: ['name'], optional: [] },
  expectText: { required: ['text'], optional: ['selector'] },
  expectVisible: { required: ['selector'], optional: [] },
  expectValue: { required: ['selector', 'value'], optional: [] },
}

function stepProblemsAt(step, index) {
  const at = `steps[${index}]`
  if (step === null || typeof step !== 'object' || Array.isArray(step)) return [`${at} must be a map`]
  const spec = Object.hasOwn(ACTIONS, step.action) ? ACTIONS[step.action] : undefined // `constructor` is not an action
  if (spec === undefined) return [`${at}.action must be one of ${Object.keys(ACTIONS).join(', ')}`]

  const allowed = [...spec.required, ...spec.optional, 'timeoutMs']
  const problems = Object.keys(step)
    .filter((key) => key !== 'action' && !allowed.includes(key))
    .map((key) => `${at}.${/^\w{1,40}$/.test(key) ? key : '(invalid name)'} is not a field of "${step.action}" (fields: ${allowed.join(', ')})`)
  for (const field of allowed) {
    const given = step[field]
    const needed = spec.required.includes(field)
    if ((given === undefined && needed) || (given !== undefined && !FIELDS[field].valid(given))) problems.push(`${at}.${field} must be ${FIELDS[field].rule}`)
  }
  return problems
}

/** What is wrong with a list of steps, one line each; empty when it is good. */
export function stepProblems(steps) {
  if (!Array.isArray(steps)) return ['"steps" must be a list']
  if (steps.length === 0) return ['"steps" is empty: it needs at least one step']
  if (steps.length > MAX_STEPS) return [`"steps" holds more than ${MAX_STEPS} steps`]
  const problems = []
  steps.forEach((step, index) => {
    for (const problem of stepProblemsAt(step, index)) problems.push(problem)
  })
  return problems
}

/** The steps of a JSON text; a usage error when it is not JSON or not good steps. */
export function parseSteps(text) {
  let steps
  try {
    steps = JSON.parse(text)
  } catch {
    throw new UsageError('the steps are not valid JSON') // the parser's message can quote the text
  }
  const problems = stepProblems(steps)
  if (problems.length > 0) {
    const more = problems.length > MAX_PROBLEMS_SHOWN ? `; and ${problems.length - MAX_PROBLEMS_SHOWN} more` : ''
    throw new UsageError(`the steps have problems: ${problems.slice(0, MAX_PROBLEMS_SHOWN).join('; ')}${more}`)
  }
  return steps
}

/** The steps in a file. The file is checked before it is read, and nothing of it is quoted in an error. */
export async function loadSteps(file) {
  let found
  try {
    found = await stat(file)
  } catch {
    throw new UsageError(`cannot read the steps file ${file}`)
  }
  if (!found.isFile()) throw new UsageError(`${file} is not a file`)
  if (found.size > MAX_FILE_BYTES) throw new UsageError(`${file} is larger than ${MAX_FILE_BYTES} bytes`)
  try {
    return parseSteps(await readFile(file, 'utf8'))
  } catch (error) {
    if (error instanceof UsageError) throw new UsageError(`${file}: ${error.message}`)
    throw new UsageError(`cannot read the steps file ${file}`)
  }
}
