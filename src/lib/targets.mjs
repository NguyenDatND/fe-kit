/**
 * The `targets` and `roles` of a profile: where `fe-kit ui` looks at the app, whether it may change data there and how it
 * tells that a saved login has run out. Validation is strict on purpose: a field that is wrong or misspelt must never turn
 * a guard off, so it is a problem rather than something ignored.
 */

const TARGET_FIELDS = ['url', 'start', 'readOnly', 'safeRequests', 'session']
const SESSION_FIELDS = ['loginPath', 'loginMarker', 'loggedInMarker', 'probe']
const PROBE_FIELDS = ['path', 'expired', 'loggedIn']
const WRITE_REQUEST = /^(POST|PUT|PATCH|DELETE) (\/[^\s*?#]*)$/i
const SAFE_NAME = /^[A-Za-z0-9_-]+$/
const NAME_RULE = 'letters, digits, "-" and "_"'

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== ''
const isStatus = (value) => Number.isInteger(value) && value >= 100 && value <= 599
// A key is printed only when it looks like a plain field name: a profile can hold anything there, a password included.
const printable = (key) => (/^[\w.-]{1,40}$/.test(key) ? key : '(invalid name)')

/** `"POST /graphql"` is a GraphQL request, `{ request, body: "any" }` is a request the profile author vouches for; else null. */
export function parseSafeRequest(entry) {
  const parse = (text) => {
    const match = typeof text === 'string' ? WRITE_REQUEST.exec(text) : null
    return match === null ? null : { method: match[1].toUpperCase(), path: match[2] }
  }
  if (typeof entry === 'string') {
    const request = parse(entry)
    return request === null ? null : { ...request, body: 'graphql' }
  }
  if (isPlainObject(entry) && Object.keys(entry).length === 2 && entry.body === 'any') {
    const request = parse(entry.request)
    return request === null ? null : { ...request, body: 'any' }
  }
  return null
}

/** Read-only unless the kit starts the server itself (then it is yours) or the target says `readOnly: false`. */
export const isReadOnly = (target) => target.readOnly ?? target.start === undefined

/** The way to tell a lost login, with the defaults filled in. */
export function sessionConfig(target) {
  const session = target.session ?? {}
  return {
    loginPath: session.loginPath ?? '/login',
    loginMarker: session.loginMarker,
    loggedInMarker: session.loggedInMarker,
    probe: session.probe === undefined ? undefined : { path: session.probe.path, expired: session.probe.expired ?? [401], loggedIn: session.probe.loggedIn ?? [200] },
  }
}

function unknownFields(map, known, path) {
  return Object.keys(map)
    .filter((key) => !known.includes(key))
    .map((key) => `"${path}.${printable(key)}" is not a known field (known: ${known.join(', ')})`)
}

function probeProblems(probe, path) {
  if (!isPlainObject(probe)) return [`"${path}" must be a map`]
  const problems = unknownFields(probe, PROBE_FIELDS, path)
  if (typeof probe.path !== 'string' || !probe.path.startsWith('/')) problems.push(`"${path}.path" must be a path that starts with /`)
  for (const field of ['expired', 'loggedIn']) {
    if (probe[field] !== undefined && !(Array.isArray(probe[field]) && probe[field].length > 0 && probe[field].every(isStatus))) {
      problems.push(`"${path}.${field}" must be a list of HTTP status codes`)
    }
  }
  return problems
}

function sessionProblems(session, path) {
  if (!isPlainObject(session)) return [`"${path}" must be a map`]
  const problems = unknownFields(session, SESSION_FIELDS, path)
  if (session.loginPath !== undefined && !(typeof session.loginPath === 'string' && session.loginPath.startsWith('/'))) {
    problems.push(`"${path}.loginPath" must be a path that starts with /`)
  }
  for (const field of ['loginMarker', 'loggedInMarker']) {
    if (session[field] !== undefined && !isNonEmptyString(session[field])) problems.push(`"${path}.${field}" must be a non-empty string (a CSS selector)`)
  }
  if (session.probe !== undefined) problems.push(...probeProblems(session.probe, `${path}.probe`))
  return problems
}

function targetFieldProblems(target, path) {
  if (!isPlainObject(target)) return [`"${path}" must be a map`]
  const problems = unknownFields(target, TARGET_FIELDS, path)
  for (const field of ['url', 'start']) {
    if (target[field] !== undefined && !isNonEmptyString(target[field])) problems.push(`"${path}.${field}" must be a non-empty string`)
  }
  if (target.readOnly !== undefined && typeof target.readOnly !== 'boolean') problems.push(`"${path}.readOnly" must be true or false`)
  if (target.safeRequests !== undefined) {
    if (!Array.isArray(target.safeRequests)) problems.push(`"${path}.safeRequests" must be a list`)
    else {
      target.safeRequests.forEach((entry, index) => {
        if (parseSafeRequest(entry) === null) problems.push(`"${path}.safeRequests[${index}]" must be "METHOD /path" (POST, PUT, PATCH or DELETE) or { request: "METHOD /path", body: "any" }`)
      })
    }
  }
  if (target.session !== undefined) problems.push(...sessionProblems(target.session, `${path}.session`))
  return problems
}

/** What is wrong with `targets` and `roles`. A name that is not safe is reported without being repeated. */
export function targetProblems(targets, roles) {
  const problems = []
  if (targets !== undefined) {
    if (!isPlainObject(targets)) problems.push('"targets" must be a map of targets')
    else {
      for (const [name, target] of Object.entries(targets)) {
        if (!SAFE_NAME.test(name)) problems.push(`"targets" has a target name that is not valid: a target name may hold only ${NAME_RULE}`)
        else problems.push(...targetFieldProblems(target, `targets.${name}`))
      }
    }
  }
  if (roles !== undefined) {
    if (!Array.isArray(roles)) problems.push('"roles" must be a list of names')
    else {
      roles.forEach((role, index) => {
        if (typeof role !== 'string' || !SAFE_NAME.test(role)) problems.push(`"roles[${index}]" must be a name of ${NAME_RULE}`)
      })
    }
  }
  return problems
}
