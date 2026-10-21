import assert from 'node:assert/strict'
import { test } from 'node:test'
import { UsageError } from '../src/lib/errors.mjs'
import { checkGraphqlBody, createRequestPolicy, graphqlOperations, MAX_BATCH, MAX_BODY_BYTES, parseAllowRequest } from '../src/lib/request-policy.mjs'

const ORIGIN = 'https://staging.example.com'
const json = (value) => Buffer.from(JSON.stringify(value))
const post = (path, body, contentType = 'application/json') => ({ method: 'POST', url: `${ORIGIN}${path}`, headers: { 'content-type': contentType }, body })
const policy = (options = {}) =>
  createRequestPolicy({
    origin: ORIGIN,
    readOnly: true,
    safeRequests: [
      { method: 'POST', path: '/graphql', body: 'graphql' },
      { method: 'POST', path: '/search', body: 'any' },
    ],
    ...options,
  })

test('reads always pass, and a target that is not read-only lets everything through', () => {
  const readOnly = policy()

  for (const method of ['GET', 'HEAD', 'OPTIONS', 'get']) assert.equal(readOnly.decide({ method, url: `${ORIGIN}/a`, headers: {}, body: null }).allow, true, method)
  assert.equal(policy({ readOnly: false }).decide(post('/orders', json({ a: 1 }))).allow, true)
})

test('the policy says whether its target is read-only', () => {
  assert.equal(policy().readOnly, true)
  assert.equal(policy({ readOnly: false }).readOnly, false)
})

test('on a read-only target every write method is refused, with the reason', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'TRACE', 'CONNECT', 'PURGE', 'post']) {
    const decision = policy().decide({ method, url: `${ORIGIN}/orders`, headers: {}, body: null })

    assert.equal(decision.allow, false, method)
    assert.match(decision.reason, /read-only/)
  }
})

test('a request that cannot be understood is refused, not an error', () => {
  assert.equal(policy().decide({ method: 'POST', url: 'not a url', headers: {}, body: null }).allow, false)
  assert.equal(policy().decide({ method: 'POST', url: `${ORIGIN}/graphql`, body: null }).allow, false)
})

test('safeRequests "any" lets that method and path through, and only that', () => {
  assert.equal(policy().decide(post('/search', Buffer.from('anything at all'), 'text/plain')).allow, true)
  assert.equal(policy().decide({ ...post('/search', null), method: 'PUT' }).allow, false)
  assert.equal(policy().decide(post('/search/', null)).allow, false)
  assert.equal(policy().decide({ ...post('/search', null), url: 'https://other.example.com/search' }).allow, false)
})

test('a GraphQL safe request passes a query and refuses a mutation or a subscription', () => {
  assert.equal(policy().decide(post('/graphql', json({ query: 'query Q { me { id } }' }))).allow, true)
  assert.equal(policy().decide(post('/graphql', json({ query: '{ me { id } }' }))).allow, true)
  const mutation = policy().decide(post('/graphql', json({ query: 'mutation M { drop }' })))
  assert.equal(mutation.allow, false)
  assert.match(mutation.reason, /mutation/)
  assert.equal(policy().decide(post('/graphql', json({ query: 'subscription S { tick }' }))).allow, false)
})

test('a GraphQL safe request is exact about the path and carries nothing in the query string', () => {
  const body = json({ query: '{ a }' })

  assert.equal(policy().decide(post('/graphql/', body)).allow, false)
  assert.equal(policy().decide(post('/graphql?query=mutation%20M%7Bx%7D', body)).allow, false)
  assert.equal(policy().decide({ ...post('/graphql', body), url: 'https://other.example.com/graphql' }).allow, false)
})

test('operationName picks the operation that runs; ambiguity and a missing name are refused', () => {
  const document = 'query A { a } mutation B { b }'

  assert.equal(checkGraphqlBody('application/json', json({ query: document, operationName: 'A' })).ok, true)
  assert.equal(checkGraphqlBody('application/json', json({ query: document, operationName: 'B' })).ok, false)
  assert.equal(checkGraphqlBody('application/json', json({ query: document, operationName: 'C' })).ok, false)
  assert.equal(checkGraphqlBody('application/json', json({ query: document })).ok, false)
  assert.equal(checkGraphqlBody('application/json', json({ query: document, operationName: null })).ok, false)
  assert.equal(checkGraphqlBody('application/json', json({ query: 'query A { a } query B { b }' })).ok, false) // two operations, no name
})

test('an operationName that is not a string, or that two operations share, is refused', () => {
  assert.equal(checkGraphqlBody('application/json', json({ query: '{ a }', operationName: 5 })).ok, false)
  assert.equal(checkGraphqlBody('application/json', json({ query: 'query A { a } query A { b }', operationName: 'A' })).ok, false)
})

test('application/graphql with more than one operation is refused, since no operationName can say which runs', () => {
  assert.equal(checkGraphqlBody('application/graphql', Buffer.from('query A { a } query B { b }')).ok, false)
})

test('a batch passes only when every operation is a query, and is capped', () => {
  const query = { query: '{ a }' }

  assert.equal(checkGraphqlBody('application/json', json([query, query])).ok, true)
  assert.equal(checkGraphqlBody('application/json', json([query, { query: 'mutation M { b }' }])).ok, false)
  assert.equal(checkGraphqlBody('application/json', json([])).ok, false)
  assert.equal(checkGraphqlBody('application/json', json(Array.from({ length: MAX_BATCH }, () => query))).ok, true)
  const tooMany = checkGraphqlBody('application/json', json(Array.from({ length: MAX_BATCH + 1 }, () => query)))
  assert.equal(tooMany.ok, false)
  assert.match(tooMany.reason, /batch/)
})

test('a body that is too large is refused before it is parsed, and one at the limit is read', () => {
  const padded = (size) => {
    const base = JSON.stringify({ query: '{ a }', variables: { pad: '' } }).length
    return Buffer.from(JSON.stringify({ query: '{ a }', variables: { pad: 'x'.repeat(size - base) } }))
  }

  assert.equal(padded(MAX_BODY_BYTES).length, MAX_BODY_BYTES)
  assert.equal(checkGraphqlBody('application/json', padded(MAX_BODY_BYTES)).ok, true)
  const over = checkGraphqlBody('application/json', padded(MAX_BODY_BYTES + 1))
  assert.equal(over.ok, false)
  assert.match(over.reason, /larger than/)
  const unparsable = Buffer.alloc(MAX_BODY_BYTES + 1, '[')
  assert.match(checkGraphqlBody('application/json', unparsable).reason, /larger than/)
})

test('a GraphQL body that cannot be verified is refused: persisted queries, bad JSON, other content types', () => {
  assert.equal(checkGraphqlBody('application/json', json({ extensions: { persistedQuery: { sha256Hash: 'abc' } } })).ok, false)
  assert.equal(checkGraphqlBody('application/json', json({ query: 5 })).ok, false)
  assert.equal(checkGraphqlBody('application/json', Buffer.from('{ nope')).ok, false)
  assert.equal(checkGraphqlBody('application/json', json(7)).ok, false)
  assert.equal(checkGraphqlBody('application/json', json(null)).ok, false)
  assert.equal(checkGraphqlBody('multipart/form-data; boundary=x', json({ query: '{ a }' })).ok, false)
  assert.equal(checkGraphqlBody('application/x-www-form-urlencoded', Buffer.from('query=%7Ba%7D')).ok, false)
  assert.equal(checkGraphqlBody(undefined, json({ query: '{ a }' })).ok, false)
  assert.equal(checkGraphqlBody('application/json', null).ok, false)
})

test('the content type may carry a charset and any case; application/graphql holds a bare document', () => {
  assert.equal(checkGraphqlBody('Application/JSON; charset=utf-8', json({ query: '{ a }' })).ok, true)
  assert.equal(checkGraphqlBody('application/graphql', Buffer.from('{ a }')).ok, true)
  assert.equal(checkGraphqlBody('application/graphql', Buffer.from('mutation M { b }')).ok, false)
})

test('graphqlOperations reads the operation types, ignoring strings, block strings, comments and fragments', () => {
  assert.deepEqual(graphqlOperations('{ a }'), [{ type: 'query', name: null }])
  assert.deepEqual(graphqlOperations('query Q($x: Int = 1) @d { a(s: "mutation { b }") } # mutation N { c }'), [{ type: 'query', name: 'Q' }])
  assert.deepEqual(graphqlOperations('query { a(s: """ mutation { b } """) }'), [{ type: 'query', name: null }])
  assert.deepEqual(graphqlOperations('fragment F on T { a } query Q { ...F }'), [{ type: 'query', name: 'Q' }])
  assert.deepEqual(graphqlOperations('{ a }\n# c\nmutation M { b }'), [
    { type: 'query', name: null },
    { type: 'mutation', name: 'M' },
  ])
  assert.deepEqual(graphqlOperations('subscription { s }'), [{ type: 'subscription', name: null }])
})

test('graphqlOperations reads an escaped quote inside a string and an escaped triple quote inside a block string as text', () => {
  assert.deepEqual(graphqlOperations(String.raw`query Q { a(s: "say \" mutation M { b } \" ok") }`), [{ type: 'query', name: 'Q' }])
  assert.deepEqual(graphqlOperations(String.raw`query Q { a(s: """ x \""" mutation M { b } \""" y """) }`), [{ type: 'query', name: 'Q' }])
})

test('graphqlOperations gives up (null) on what it cannot read with certainty', () => {
  for (const document of ['fragment F on T { a }', '{ a(s: "x\ny") }', '{ a ( } )', '{ a ) }', '{ a ] }', '', '   ', '{ a ', 'query { a }}', 'type T { a: Int }', 'extend schema { query: Q }', 'query { a(s: "open) }', 'queryy { a }', '{ a } }', 'mutation { a ', '"""never closed']) {
    assert.equal(graphqlOperations(document), null, JSON.stringify(document))
  }
})

test('--allow-request lets one matching write through, once, and ignores reads', () => {
  const allowing = policy({ allowRequest: `POST ${ORIGIN}/api/orders/*` })

  assert.equal(allowing.decide({ method: 'GET', url: `${ORIGIN}/api/orders/1`, headers: {}, body: null }).allow, true)
  const first = allowing.decide(post('/api/orders/42', json({ a: 1 })))
  assert.deepEqual([first.allow, first.via], [true, 'allow-request'])
  const second = allowing.decide(post('/api/orders/42', json({ a: 1 })))
  assert.equal(second.allow, false)
  assert.match(second.reason, /already been used/)
  assert.equal(allowing.decide(post('/api/orders/43', json({ a: 1 }))).allow, false)
})

test('--allow-request does not match another method, path or origin, and an unmatched request does not use the permission up', () => {
  const allowing = policy({ allowRequest: `POST ${ORIGIN}/api/orders/*` })

  assert.equal(allowing.decide({ ...post('/api/orders/1', null), method: 'DELETE' }).allow, false)
  assert.equal(allowing.decide(post('/api/users/1', null)).allow, false)
  assert.equal(allowing.decide({ ...post('/api/orders/1', null), url: 'https://other.example.com/api/orders/1' }).allow, false)
  assert.equal(allowing.decide(post('/api/orders/1', null)).allow, true)
})

test('a request that a safe entry already allows does not spend the --allow-request permission', () => {
  const allowing = policy({ allowRequest: `POST ${ORIGIN}/search` })

  assert.equal(allowing.decide(post('/search', null)).via, 'safe-request')
  assert.equal(allowing.decide(post('/search', null)).via, 'safe-request')
  assert.equal(allowing.decide({ ...post('/search', null), method: 'POST' }).allow, true)
})

test('the permission is spent when it is decided, so two matching requests at the same moment let one through', () => {
  const allowing = policy({ allowRequest: `POST ${ORIGIN}/api/orders` })
  const decisions = [post('/api/orders', null), post('/api/orders', null)].map((request) => allowing.decide(request))

  assert.deepEqual(decisions.map((decision) => decision.allow), [true, false])
})

test('parseAllowRequest wants "METHOD origin/path": a write method and a literal origin; the path may hold wildcards', () => {
  assert.deepEqual(parseAllowRequest('post https://a.example.com:8443/api/*'), { method: 'POST', origin: 'https://a.example.com:8443', pathGlob: '/api/*' })
  for (const bad of ['GET https://a.example.com/x', 'POST /api/x', 'POST https://*.example.com/x', 'POST https://a.example.com', 'POST https://a.example.com/x?y=1', 'https://a.example.com/x', '', 'POST  https://a.example.com/x', 'POST ftp://a.example.com/x']) {
    assert.throws(() => parseAllowRequest(bad), UsageError, bad)
  }
})
