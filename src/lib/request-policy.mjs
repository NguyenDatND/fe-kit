import { UsageError } from './errors.mjs'
import { isValidGlob, matchesGlob } from './glob.mjs'

/**
 * Whether a scripted browser run may send a request. Pure: it looks at a request and decides, so it can be tested without a
 * browser. On a read-only target a write (anything but GET, HEAD and OPTIONS) is refused, except what the profile lists in
 * `safeRequests` and the one request that `--allow-request` names. What the profile calls GraphQL is checked down to the type
 * of the operation, because one endpoint carries queries and mutations alike.
 */

export const MAX_BODY_BYTES = 1024 * 1024
export const MAX_BATCH = 100
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const ALLOW_REQUEST = /^(POST|PUT|PATCH|DELETE) (https?:\/\/[^\s/*?#]+)(\/[^\s?#]*)$/i
const NAME_START = /[_A-Za-z]/
const NAME_PART = /[_0-9A-Za-z]/
const NUMBER_PART = /[-+.0-9A-Za-z_]/
const OPENING = { '{': '}', '(': ')', '[': ']' }
const CLOSING = new Set(Object.values(OPENING))

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * The tokens of a GraphQL document that matter for finding its operations: names and punctuation. Strings, block strings,
 * comments, numbers, commas and whitespace are read past. Null when the text is not something this can read with certainty.
 */
function tokenize(document) {
  const tokens = []
  let index = 0
  while (index < document.length) {
    const char = document[index]
    if (/[\s,﻿]/.test(char)) index++
    else if (char === '#') {
      while (index < document.length && document[index] !== '\n' && document[index] !== '\r') index++
    } else if (document.startsWith('"""', index)) {
      index += 3
      while (index < document.length && !(document.startsWith('"""', index) && document[index - 1] !== '\\')) index++
      if (index >= document.length) return null
      index += 3
    } else if (char === '"') {
      index++
      while (index < document.length && document[index] !== '"') {
        if (document[index] === '\n' || document[index] === '\r') return null
        index += document[index] === '\\' ? 2 : 1
      }
      if (index >= document.length) return null
      index++
    } else if (NAME_START.test(char)) {
      const start = index
      while (index < document.length && NAME_PART.test(document[index])) index++
      tokens.push({ kind: 'name', value: document.slice(start, index) })
    } else if (/[-0-9]/.test(char)) {
      while (index < document.length && NUMBER_PART.test(document[index])) index++
    } else if (document.startsWith('...', index)) {
      tokens.push({ kind: 'punct', value: '...' })
      index += 3
    } else if ('!$&():=@[]{|}'.includes(char)) {
      tokens.push({ kind: 'punct', value: char })
      index++
    } else return null
  }
  return tokens
}

/**
 * The operations a GraphQL document defines, as `{ type, name }` (name null for an anonymous one). Null when the document
 * is empty, is not balanced, or holds anything but operations and fragments: a body that cannot be read is not trusted.
 */
export function graphqlOperations(document) {
  const tokens = tokenize(document)
  if (tokens === null) return null
  const operations = []
  let position = 0
  const is = (value) => tokens[position]?.value === value && tokens[position].kind === 'punct'

  // Steps over the bracket group that starts at `position`; false when it is not closed by the matching bracket.
  const skipGroup = () => {
    const stack = []
    do {
      const token = tokens[position++]
      if (token?.kind !== 'punct') {
        if (token === undefined) return false
        continue
      }
      if (OPENING[token.value] !== undefined) stack.push(OPENING[token.value])
      else if (CLOSING.has(token.value) && stack.pop() !== token.value) return false
    } while (stack.length > 0)
    return true
  }
  const skipDirectives = () => {
    while (is('@')) {
      position++
      if (tokens[position]?.kind !== 'name') return false
      position++
      if (is('(') && !skipGroup()) return false
    }
    return true
  }

  while (position < tokens.length) {
    const token = tokens[position]
    if (is('{')) {
      if (!skipGroup()) return null
      operations.push({ type: 'query', name: null })
    } else if (token.kind === 'name' && ['query', 'mutation', 'subscription'].includes(token.value)) {
      position++
      let name = null
      if (tokens[position]?.kind === 'name') name = tokens[position++].value
      if (is('(') && !skipGroup()) return null
      if (!skipDirectives() || !is('{') || !skipGroup()) return null
      operations.push({ type: token.value, name })
    } else if (token.kind === 'name' && token.value === 'fragment') {
      position++
      while (position < tokens.length && !is('{')) {
        if (is('(')) {
          if (!skipGroup()) return null
        } else position++
      }
      if (!is('{') || !skipGroup()) return null
    } else return null
  }
  return operations.length === 0 ? null : operations
}

const refuse = (reason) => ({ ok: false, reason })

/** The operation that `{ query, operationName }` runs, or a refusal; only a query passes. */
function checkOperation(entry) {
  if (!isPlainObject(entry) || typeof entry.query !== 'string') return refuse('the request has no query text (a persisted query cannot be verified)')
  const operations = graphqlOperations(entry.query)
  if (operations === null) return refuse('the GraphQL document cannot be read with certainty')
  const name = entry.operationName
  if (name !== undefined && name !== null && typeof name !== 'string') return refuse('operationName is not a string')
  let operation
  if (typeof name === 'string') {
    const named = operations.filter((candidate) => candidate.name === name)
    if (named.length !== 1) return refuse('operationName does not pick exactly one operation')
    operation = named[0]
  } else {
    if (operations.length !== 1) return refuse('the document holds several operations and no operationName')
    operation = operations[0]
  }
  return operation.type === 'query' ? { ok: true } : refuse(`the operation is a ${operation.type}, and only a query is allowed`)
}

/** Whether a POST body is GraphQL that only reads. The size is checked before anything is decoded. */
export function checkGraphqlBody(contentType, body) {
  if (!(body instanceof Uint8Array)) return refuse('the request has no body to read')
  if (body.length > MAX_BODY_BYTES) return refuse(`the body is larger than ${MAX_BODY_BYTES} bytes`)
  const type = String(contentType ?? '').split(';')[0].trim().toLowerCase()
  const text = Buffer.from(body).toString('utf8')
  if (type === 'application/graphql') {
    const operations = graphqlOperations(text)
    if (operations === null || operations.length !== 1) return refuse('the GraphQL document cannot be read with certainty')
    return operations[0].type === 'query' ? { ok: true } : refuse(`the operation is a ${operations[0].type}, and only a query is allowed`)
  }
  if (type !== 'application/json') return refuse(`a body of type ${type === '' ? '(none)' : type} cannot be verified as GraphQL`)
  let value
  try {
    value = JSON.parse(text)
  } catch {
    return refuse('the body is not valid JSON')
  }
  if (!Array.isArray(value)) return checkOperation(value)
  if (value.length === 0) return refuse('the batch is empty')
  if (value.length > MAX_BATCH) return refuse(`the batch holds more than ${MAX_BATCH} operations`)
  for (const entry of value) {
    const checked = checkOperation(entry)
    if (!checked.ok) return checked
  }
  return { ok: true }
}

/** `"METHOD origin/path"` for `--allow-request`: a write method, a literal origin, a path that may hold wildcards. */
export function parseAllowRequest(text) {
  const match = ALLOW_REQUEST.exec(text)
  if (match === null || !isValidGlob(match[3].slice(1))) {
    throw new UsageError('--allow-request wants "METHOD https://host/path": POST, PUT, PATCH or DELETE, then a URL whose host has no wildcard and whose path has no query string')
  }
  return { method: match[1].toUpperCase(), origin: new URL(match[2]).origin, pathGlob: match[3] }
}

/**
 * `decide(request)` answers `{ allow: true, via }` or `{ allow: false, reason }` for a request `{ method, url, headers, body }`
 * (header names in lower case, body a Buffer or null). The one `--allow-request` permission is spent in `decide`, in the same
 * step as the answer, so two matching requests at once cannot both pass, and it is never given back: a request that fails
 * has still been sent.
 */
export function createRequestPolicy({ origin, readOnly, safeRequests = [], allowRequest }) {
  const allowed = allowRequest === undefined ? null : parseAllowRequest(allowRequest)
  const targetOrigin = new URL(origin).origin
  let permissionUsed = false
  const allow = (via) => ({ allow: true, via })
  const deny = (reason) => ({ allow: false, reason })

  return {
    decide({ method, url, headers, body }) {
      const verb = String(method).toUpperCase()
      if (READ_METHODS.has(verb)) return allow('read')
      if (!readOnly) return allow('writable')
      let address
      try {
        address = new URL(url)
      } catch {
        return deny('the target is read-only and the URL of this request cannot be read')
      }

      let reason = `the target is read-only: ${verb} requests are refused`
      for (const entry of safeRequests) {
        if (entry.method !== verb || address.origin !== targetOrigin || address.pathname !== entry.path) continue
        if (entry.body === 'any') return allow('safe-request')
        if (address.search !== '') {
          reason = 'a GraphQL request with a query string cannot be verified'
          continue
        }
        const checked = checkGraphqlBody(headers?.['content-type'], body)
        if (checked.ok) return allow('safe-request')
        reason = `the target is read-only and ${checked.reason}`
      }

      if (allowed !== null && allowed.method === verb && address.origin === allowed.origin && matchesGlob(address.pathname.slice(1), allowed.pathGlob.slice(1))) {
        if (permissionUsed) return deny('the one write request that --allow-request lets through has already been used')
        permissionUsed = true
        return allow('allow-request')
      }
      return deny(reason)
    },
  }
}
