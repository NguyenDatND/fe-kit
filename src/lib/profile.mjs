import { readdir, readFile, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { COMMAND_NAMES } from './detect.mjs'
import { isQuoted } from './exec.mjs'
import { describeYamlError, parseFrontmatter } from './frontmatter.mjs'
import { isInside } from './fsx.mjs'
import { isValidGlob } from './glob.mjs'
import { targetProblems } from './targets.mjs'

const TEST_POLICIES = ['auto', 'commit', 'local-only']

/** A profile is YAML frontmatter (read by the CLI) followed by prose (read by skills). */
export const parseProfile = parseFrontmatter

/** A cyclic YAML alias parses without complaint, but nothing can serialize or walk the result (`--json`, `envNames`). */
function assertAcyclic(data) {
  try {
    JSON.stringify(data)
  } catch {
    throw new Error('profile data cannot be serialized (cyclic YAML alias?)')
  }
}

/** Reads and parses one profile. Whatever it throws is safe to show: the YAML parser's own messages quote the source. */
async function readProfile(file) {
  const text = await readFile(file, 'utf8')
  let profile
  try {
    profile = parseProfile(text)
  } catch (error) {
    throw new Error(describeYamlError(error))
  }
  assertAcyclic(profile.data)
  return profile
}

/**
 * Reads every `*.md` in `dir` except README.md, in name order. A file that cannot be parsed carries `error`:
 * the YAML error reduced to its code and position, because a profile may hold credentials.
 */
export async function loadProfiles(dir) {
  let names
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith('.md') && name !== 'README.md').sort()
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
  return Promise.all(
    names.map(async (name) => {
      const file = join(dir, name)
      try {
        return { file, ...(await readProfile(file)) }
      } catch (error) {
        return { file, data: {}, body: '', error: error.message }
      }
    }),
  )
}

/** `git@host:a/b.git`, `ssh://git@host:22/a/b.git` and `https://user:token@host/a/b` all become `host/a/b`. */
export function normalizeRemote(url) {
  return url
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '') // scheme://
    .replace(/^[^@/]+@/, '') // user[:password]@, so credentials never survive
    .replace(/^([^/:]+):(\d+)(?=\/)/, '$1') // host:port/
    .replace(/^([^/:]+):(?!\d+\/)/, '$1/') // scp-style host:path
    .replace(/\.git\/?$/, '')
    .replace(/\/+$/, '')
    .toLowerCase()
}

function expandHome(path) {
  return path === '~' || path.startsWith('~/') ? join(homedir(), path.slice(1)) : path
}

/** `~` expanded and symlinks resolved when the path exists, so it can be compared with a real project root. */
async function realProfilePath(path) {
  const expanded = resolve(expandHome(path))
  return realpath(expanded).catch(() => expanded)
}

const isStringList = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string')
const strings = (value) => (Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [])
const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== ''
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/** The command overrides of a profile that a shell can be given: entries whose value is a non-empty string. */
export const profileCommands = (settings) =>
  Object.fromEntries(
    Object.entries(isPlainObject(settings?.commands) ? settings.commands : {}).filter(([, command]) => isNonEmptyString(command)),
  )

/** The `standards` globs of a profile. Null when it does not give a list (the caller picks defaults); a list may be empty. */
export const profileStandards = (settings) =>
  Array.isArray(settings?.standards) ? strings(settings.standards).filter(isNonEmptyString) : null

/**
 * First profile (in file order) whose `match.paths` contains the project or whose `match.remotes` equals a
 * remote. A profile is hand-written YAML, so a value of the wrong type is ignored here (validateProfile
 * reports it) rather than allowed to crash every lookup.
 */
export async function matchProfile(profiles, { root, remotes }) {
  const normalized = remotes.map(normalizeRemote)
  for (const profile of profiles) {
    if (profile.error) continue
    const { paths, remotes: wanted } = profile.data.match ?? {}
    for (const path of strings(paths)) {
      if (isInside(root, await realProfilePath(path))) return profile
    }
    if (strings(wanted).some((remote) => normalized.includes(normalizeRemote(remote)))) return profile
  }
  return null
}

const isValidPattern = (pattern) => {
  if (!isNonEmptyString(pattern)) return false
  try {
    RegExp(pattern)
    return true
  } catch {
    return false
  }
}
const isWellFormedScanRule = (entry) =>
  isPlainObject(entry) &&
  isNonEmptyString(entry.id) &&
  isValidPattern(entry.pattern) &&
  isNonEmptyString(entry.message) &&
  (entry.files === undefined || (isStringList(entry.files) && entry.files.every(isValidGlob)))

/**
 * The `scan` rules of a profile that are well formed. A rule whose `files` is wrong is dropped, not widened to every
 * file: a typo must not turn a narrow rule into a flood of findings (validateProfile reports it).
 */
export const profileScanRules = (settings) =>
  (Array.isArray(settings?.scan) ? settings.scan : [])
    .filter(isWellFormedScanRule)
    .map(({ id, pattern, message, files }) => ({ id, pattern, message, files }))

function scanProblems(scan) {
  if (scan === undefined) return []
  if (!Array.isArray(scan)) return ['"scan" must be a list of rules']
  return scan.flatMap((entry, index) => {
    const field = (name) => `"scan[${index}]${name}"`
    if (!isPlainObject(entry)) return [`${field('')} must be a map with id, pattern and message`]
    return [
      ...(isNonEmptyString(entry.id) ? [] : [`${field('.id')} must be a non-empty string`]),
      ...(isValidPattern(entry.pattern) ? [] : [`${field('.pattern')} must be a valid regular expression`]), // the pattern is never repeated
      ...(isNonEmptyString(entry.message) ? [] : [`${field('.message')} must be a non-empty string`]),
      ...(entry.files === undefined || isStringList(entry.files) ? [] : [`${field('.files')} must be a list of strings`]),
      ...(isStringList(entry.files) && !entry.files.every(isValidGlob) ? [`${field('.files')} has a glob that is not valid`] : []),
    ]
  })
}

/** What is wrong with `commands`: a command is a shell string, so its shape is checked before anything runs it. */
function commandProblems(commands) {
  if (commands === undefined) return []
  if (!isPlainObject(commands)) return ['"commands" must be a map of command strings']
  return Object.entries(commands).flatMap(([name, command]) => {
    const label = `"commands.${redactText(name)}"`
    if (!COMMAND_NAMES.includes(name)) return [`${label} is not a known command (known: ${COMMAND_NAMES.join(', ')})`]
    if (!isNonEmptyString(command)) return [`${label} must be a non-empty string`]
    // fe-kit quotes each file name it puts there; inside quotes of the profile's own, a name would be shell code.
    return isQuoted(command, '{files}') ? [`${label} has {files} inside quotes; write it bare, because fe-kit quotes each file name itself`] : []
  })
}

export function validateProfile(data) {
  const problems = []
  if (typeof data?.name !== 'string' || data.name.trim() === '') problems.push('missing "name"')

  const match = data?.match
  for (const key of ['paths', 'remotes']) {
    if (match?.[key] !== undefined && !isStringList(match[key])) problems.push(`"match.${key}" must be a list of strings`)
  }
  if (strings(match?.paths).length === 0 && strings(match?.remotes).length === 0) {
    problems.push('"match" needs at least one of "paths" or "remotes"')
  }

  const policy = data?.tests?.policy
  if (policy !== undefined && !TEST_POLICIES.includes(policy)) {
    problems.push('"tests.policy" must be auto, commit or local-only') // the value is not repeated: it could be a credential
  }
  if (data?.baseBranch !== undefined && typeof data.baseBranch !== 'string') problems.push('"baseBranch" must be a string')
  for (const problem of commandProblems(data?.commands)) problems.push(problem) // a loop: spreading a list this long overflows the call stack
  if (data?.standards !== undefined && !isStringList(data.standards)) problems.push('"standards" must be a list of strings')
  else if (isStringList(data?.standards) && !data.standards.every(isValidGlob)) problems.push('"standards" has a glob that is not valid')
  for (const problem of scanProblems(data?.scan)) problems.push(problem)
  for (const problem of targetProblems(data?.targets, data?.roles)) problems.push(problem)
  for (const path of literalPasswordPaths(data)) {
    problems.push(`"${path}" has a literal password in a URL; use \${env:NAME} instead`)
  }
  return problems
}

const ENV_PLACEHOLDER = /\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g
// `://userinfo@host`. The userinfo runs to the last @ of the authority, so a password containing @ is taken whole.
// The scheme is left out on purpose: hiding the userinfo does not need it, and a pattern that begins with a scheme
// is tried again at every letter of a long word, which takes quadratic time (seconds for a long script line).
const URL_USERINFO = /:\/\/([^\s/]*)@/g

/**
 * The userinfo of a URL is never printed, whatever it holds (a password, a token, an `${env:NAME}` reference, a
 * malformed one): `scheme://user:secret@host` reads `scheme://[REDACTED]@host`. Hiding all of it takes no parsing, so
 * no shape of userinfo can slip through. A URL that needs credentials gets them from the profile at run time, not
 * from what `context` prints.
 */
const redactText = (text) => text.replace(URL_USERINFO, '://[REDACTED]@')

/**
 * Whether a userinfo holds a literal password: anything after its first colon that is not a `${env:NAME}`
 * reference (the colon inside a reference does not count). A `${env:` that is not a complete placeholder counts
 * too, since then nobody can tell. This only decides whether to warn; printing never depends on it.
 */
function hasLiteralPassword(userinfo) {
  const masked = userinfo.replace(ENV_PLACEHOLDER, (placeholder) => '_'.repeat(placeholder.length))
  if (masked.includes('${env:')) return true
  const colon = masked.indexOf(':')
  return colon !== -1 && userinfo.slice(colon + 1).replace(ENV_PLACEHOLDER, '') !== ''
}

const hasLiteralPasswordIn = (text) => [...text.matchAll(URL_USERINFO)].some((match) => hasLiteralPassword(match[1]))

/** `label`, or `label (2)`, `label (3)` ... once a sibling has taken it, so redacting keys never merges two entries. */
function uniqueLabel(label, taken) {
  let candidate = label
  for (let count = 2; taken.has(candidate); count++) candidate = `${label} (${count})`
  taken.add(candidate)
  return candidate
}

/**
 * Calls `visit(text, path)` for every string in `value`, map keys included, and returns a copy holding what it
 * returned. `path` reads like `targets.staging.url`; its key segments are redacted (and made unique among
 * siblings), so a path is always safe to print.
 */
function mapStrings(value, visit, path = '') {
  if (typeof value === 'string') return visit(value, path)
  if (Array.isArray(value)) return value.map((item, index) => mapStrings(item, visit, `${path}[${index}]`))
  if (value !== null && typeof value === 'object') {
    const pathLabels = new Set()
    const outputKeys = new Set()
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => {
        const label = uniqueLabel(redactText(key), pathLabels)
        const here = path ? `${path}.${label}` : label
        return [uniqueLabel(visit(key, here), outputKeys), mapStrings(item, visit, here)]
      }),
    )
  }
  return value
}

/** Names used as `${env:NAME}` anywhere inside `value` (strings, lists, maps); their values are never read. */
export function envNames(value) {
  const names = []
  mapStrings(value, (text) => {
    for (const match of text.matchAll(ENV_PLACEHOLDER)) names.push(match[1])
    return text
  })
  return names
}

/** A copy of `value`, keys included, in which the userinfo of every URL is hidden: `scheme://user:secret@host` reads `scheme://[REDACTED]@host`. */
export const redactCredentials = (value) => mapStrings(value, redactText)

/** Where a literal password sits in a URL inside `value`, as paths like `targets.staging.url`; never the password. */
function literalPasswordPaths(value) {
  const paths = new Set() // a key and its string value share a path
  mapStrings(value, (text, path) => {
    if (hasLiteralPasswordIn(text)) paths.add(path)
    return text
  })
  return [...paths]
}

/** Fills `${env:NAME}`; placeholders whose variable is not set stay as they are and are listed in `missing`. */
export function interpolateEnv(text, env) {
  const missing = []
  const value = text.replace(ENV_PLACEHOLDER, (placeholder, name) => {
    if (env[name] === undefined) {
      missing.push(name)
      return placeholder
    }
    return env[name]
  })
  return { value, missing }
}
