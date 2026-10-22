import { isDeepStrictEqual } from 'node:util'
import { join } from 'node:path'
import { shellQuote } from './exec.mjs'
import { codexAllowPrefixes, codexRulePrefixes } from './guard-rules.mjs'
import { HOST_TIMEOUT_SECONDS } from './hook-supervisor.mjs'
import { getTarget } from './tools.mjs'

// What `fe-kit link` writes into each tool's own configuration so that shell-guard runs and asks, and how it takes
// that out again. The files belong to the person: things are only ever added at the end, an item that is already there
// and identical stays theirs, and `removeEntries` takes out only what `applyEntries` reported adding.

export class ConfigProblem extends Error {}

export const OWNED_HEADER = '# Managed by fe-kit (fe-kit link). fe-kit unlink removes this file; edits are overwritten.'

const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

/** The object a JSON config file holds; an empty file is an empty object. Anything else is a problem the person should look at. */
export function parseJsonConfig(text) {
  if (text.trim() === '') return {}
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    // The parser's own message quotes the text around the mistake, and this is a file that may hold a token.
    throw new ConfigProblem('not valid JSON; fix it or remove the broken part, then run the command again')
  }
  if (!isPlainObject(parsed)) throw new ConfigProblem('the file does not hold a JSON object')
  return parsed
}

/** Back to text, indented as `original` was (two spaces when it cannot be told), with a newline at the end. */
export function serializeJsonConfig(config, original = '') {
  const indent = /\n([ \t]+)\S/.exec(original)?.[1]
  return `${JSON.stringify(config, null, indent ?? 2)}\n`
}

/** The container at `path` inside `root` (made when it is not there); one that is there with another shape is a problem. */
function reach(root, path, shape) {
  let current = root
  path.forEach((key, index) => {
    const last = index === path.length - 1
    const wanted = last ? shape : 'object'
    const found = current[key]
    if (found === undefined) current[key] = wanted === 'array' ? [] : {}
    else if (wanted === 'array' ? !Array.isArray(found) : !isPlainObject(found)) throw new ConfigProblem(`${path.slice(0, index + 1).join('.')} is not ${wanted === 'array' ? 'a list' : 'an object'}`)
    current = current[key]
  })
  return current
}

/**
 * Adds `appends` (`{ path, item }`: an item at the end of the list at `path`) and `sets` (`{ path, value }`: a key
 * that is the kit's own) to a copy of `config`. Returns `{ next, added }`; `added` holds only what was not there already.
 */
export function applyEntries(config, { appends, sets }) {
  const base = config ?? {}
  if (!isPlainObject(base)) throw new ConfigProblem('the file does not hold a JSON object')
  const next = structuredClone(base)
  const added = { appends: [], sets: [] }
  for (const { path, item } of appends) {
    const list = reach(next, path, 'array')
    if (list.some((existing) => isDeepStrictEqual(existing, item))) continue
    list.push(structuredClone(item))
    added.appends.push({ path, item })
  }
  for (const { path, value } of sets) {
    const parent = reach(next, path.slice(0, -1), 'object')
    const key = path.at(-1)
    if (!Object.hasOwn(parent, key)) {
      parent[key] = structuredClone(value)
      added.sets.push({ path, value })
    } else if (!isDeepStrictEqual(parent[key], value)) throw new ConfigProblem(`${path.join('.')} already has a different value`)
  }
  return { next, added }
}

function lookup(root, path) {
  let current = root
  for (const key of path) {
    if (!isPlainObject(current)) return undefined
    current = current[key]
  }
  return current
}

/** Drops the containers along `path` that have been left empty, from the inside out. */
function prune(root, path) {
  for (let depth = path.length; depth > 0; depth--) {
    const parent = lookup(root, path.slice(0, depth - 1))
    const key = path[depth - 1]
    const value = parent?.[key]
    const empty = Array.isArray(value) ? value.length === 0 : isPlainObject(value) && Object.keys(value).length === 0
    if (!empty) return
    delete parent[key]
  }
}

/**
 * Takes out what `added` says was added, and only if it is still there as it was. Returns `{ next, kept }`: `kept`
 * lists what was changed since and is left alone.
 */
export function removeEntries(config, added) {
  const next = structuredClone(config)
  const kept = []
  for (const { path, item } of added.appends) {
    const list = lookup(next, path)
    const index = Array.isArray(list) ? list.findIndex((existing) => isDeepStrictEqual(existing, item)) : -1
    if (index === -1) kept.push({ path, item, reason: 'it was changed or removed since fe-kit added it' })
    else {
      list.splice(index, 1)
      prune(next, path)
    }
  }
  for (const { path, value } of added.sets) {
    const parent = lookup(next, path.slice(0, -1))
    if (!isPlainObject(parent) || !Object.hasOwn(parent, path.at(-1))) continue
    if (isDeepStrictEqual(parent[path.at(-1)], value)) {
      delete parent[path.at(-1)]
      prune(next, path.slice(0, -1))
    } else kept.push({ path, item: value, reason: 'it was changed since fe-kit added it' })
  }
  return { next, kept }
}

const rule = (prefix) => `prefix_rule(pattern=[${prefix.map((word) => JSON.stringify(word)).join(', ')}]`

/** The whole `fe-kit.rules` file for Codex. */
export function codexRulesText(kitRoot) {
  const lines = [OWNED_HEADER, '', '# Asks before what changes history or the kit.']
  for (const prefix of codexRulePrefixes(kitRoot)) lines.push(`${rule(prefix)}, decision="prompt")`)
  lines.push('', '# Allowed outside the sandbox, where the browser can start.')
  for (const prefix of codexAllowPrefixes(kitRoot)) lines.push(`${rule(prefix)}, decision="allow")`)
  return `${lines.join('\n')}\n`
}

export const expandHome = (path, home) => (path.startsWith('~/') ? join(home, path.slice(2)) : path)

/** The folders of secrets, as the tools' rule languages name them: the config folder and the saved logins (also where `FE_KIT_STATE_DIR` points). */
function storePaths({ home, env }) {
  const stores = ['~/.config/fe-kit', '~/.local/state/fe-kit/auth']
  const custom = env.FE_KIT_STATE_DIR
  const defaultState = join(home, '.local', 'state', 'fe-kit')
  const absolute = typeof custom === 'string' && custom.startsWith('/') && custom !== defaultState ? join(custom, 'auth') : null
  return { stores, absolute }
}

/**
 * What to put into each file of `tool`: `{ file, kind: 'json', entries }` (for `applyEntries`) or `{ file, kind: 'owned', text }`
 * (a file that is the kit's own). `node` is the program that runs the hook, as it is found on the PATH.
 */
export function guardPlan({ tool, home, kitRoot, node, env }) {
  const target = getTarget(tool)
  const command = `${shellQuote(node)} ${shellQuote(join(kitRoot, 'hooks', 'shell-guard.mjs'))}`
  const hookEntry = (matcher) => ({ matcher, hooks: [{ type: 'command', command, timeout: HOST_TIMEOUT_SECONDS }] })
  const { stores, absolute } = storePaths({ home, env })
  const prefixes = codexRulePrefixes(kitRoot)
  const appends = (path, items) => items.map((item) => ({ path, item }))

  if (tool === 'claude') {
    const deny = [...stores.map((store) => `Read(${store}/**)`), ...(absolute === null ? [] : [`Read(/${absolute}/**)`])]
    return [{ file: expandHome(target.guard.path, home), kind: 'json', entries: { sets: [], appends: [...appends(['permissions', 'ask'], prefixes.map((prefix) => `Bash(${prefix.join(' ')}:*)`)), ...appends(['permissions', 'deny'], deny), ...appends(['hooks', 'PreToolUse'], [hookEntry('Bash|Read|Grep|Glob')])] } }]
  }
  if (tool === 'codex') {
    return [
      { file: expandHome(target.guard.path, home), kind: 'owned', text: codexRulesText(kitRoot) },
      { file: expandHome(target.hooks.path, home), kind: 'json', entries: { sets: [], appends: appends(['hooks', 'PreToolUse'], [hookEntry('Bash')]) } },
    ]
  }
  if (tool === 'antigravity') {
    const deny = [...stores.map((store) => `read_file(${store}/**)`), ...(absolute === null ? [] : [`read_file(${absolute}/**)`])]
    return [
      { file: expandHome(target.hooks.path, home), kind: 'json', entries: { appends: [], sets: [{ path: ['fe-kit'], value: { PreToolUse: [hookEntry('run_command|view_file')] } }] } },
      { file: expandHome(target.guard.path, home), kind: 'json', entries: { sets: [], appends: [...appends(['permissions', 'ask'], prefixes.map((prefix) => `command(${prefix.join(' ')})`)), ...appends(['permissions', 'deny'], deny)] } },
    ]
  }
  throw new Error(`unknown tool: ${tool}`)
}
