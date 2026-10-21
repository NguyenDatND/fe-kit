import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createScrubber, secretsOf } from '../src/lib/scrub.mjs'

test('a value that is known to be a secret goes wherever it appears, as many times as it appears', () => {
  const scrub = createScrubber(['FAKE_COOKIE_VALUE', 'a.b+c(d)[e]'])

  assert.equal(scrub('x FAKE_COOKIE_VALUE y FAKE_COOKIE_VALUE'), 'x [REDACTED] y [REDACTED]')
  assert.equal(scrub('the value was a.b+c(d)[e] here'), 'the value was [REDACTED] here') // not read as a pattern
  assert.equal(scrub('aXb+c(d)[e]'), 'aXb+c(d)[e]')
})

test('a short value is not scrubbed, because it would shred ordinary text; the limit is four characters', () => {
  assert.equal(createScrubber(['abc', '', 'a']).call(null, 'abc a'), 'abc a')
  assert.equal(createScrubber(['abcd'])('xabcdx'), 'x[REDACTED]x')
})

test('of two secrets where one holds the other, the longer goes first', () => {
  assert.equal(createScrubber(['abcd', 'abcdefgh'])('abcdefgh abcd'), '[REDACTED] [REDACTED]')
})

test('a Bearer token, a JWT and name=value pairs that look like credentials are scrubbed without being known', () => {
  const scrub = createScrubber([])

  assert.equal(scrub('Authorization: Bearer abc123DEF456ghi'), 'Authorization: [REDACTED]')
  assert.equal(scrub('sent Bearer abc123DEF456ghi to the server'), 'sent Bearer [REDACTED] to the server')
  assert.equal(scrub('jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVP'), 'jwt [REDACTED]')
  assert.equal(scrub('failed: token=ABCD1234&x=1'), 'failed: token=[REDACTED]&x=1')
  assert.equal(scrub('password: hunter22'), 'password: [REDACTED]')
  assert.equal(scrub('Cookie: sid=abc12345; theme=dark'), 'Cookie: [REDACTED]; theme=dark')
  assert.equal(scrub('api_key=KEY12345 and access_token=TOK12345'), 'api_key=[REDACTED] and access_token=[REDACTED]')
})

test('a credential in a JSON string is scrubbed whole, whatever the string holds: quotes, backslashes, unicode escapes, and not just a prefix', () => {
  const scrub = createScrubber([])

  assert.equal(scrub('{"password":"a\\"b\\\\c d tail","x":1}'), '{"password":"[REDACTED]","x":1}')
  assert.equal(scrub('{"token":"\\u0041BCDEFGH","x":1}'), '{"token":"[REDACTED]","x":1}')
  assert.equal(scrub('{"token":"ab","x":1}'), '{"token":"[REDACTED]","x":1}')
  assert.equal(scrub('{"password":"ends with a backslash\\\\","x":1}'), '{"password":"[REDACTED]","x":1}')
  assert.equal(scrub('{"token":"","x":1}'), '{"token":"","x":1}')
  assert.equal(scrub('{"token":"never closed'), '{"token":"[REDACTED]') // what cannot be bounded is not left behind
})

test('the same, with the JSON inside a string that is itself escaped once', () => {
  const scrub = createScrubber([])

  assert.equal(scrub(String.raw`{\"password\":\"a\\\"b tail\",\"x\":1}`), String.raw`{\"password\":\"[REDACTED]\",\"x\":1}`)
  assert.equal(scrub(String.raw`{\"token\":\"ends\\\\\",\"x\":1}`), String.raw`{\"token\":\"[REDACTED]\",\"x\":1}`)
})

test('a known secret goes in the forms JSON gives it too: with its quotes and backslashes escaped, once or twice', () => {
  const secret = 'a"b\\SECRET'
  const scrub = createScrubber([secret])

  for (const text of [secret, JSON.stringify({ note: secret }), JSON.stringify(JSON.stringify({ note: secret }))]) assert.ok(!scrub(text).includes('SECRET'), text)
})

test('JSON scanning is linear on text made to restart it', () => {
  const scrub = createScrubber([])
  for (const text of ['.'.repeat(100_000) + 'x', '"password":"'.repeat(40_000), '"token":"' + 'a'.repeat(200_000), '"token":"' + '\\'.repeat(100_000) + '"', '\\"token\\":\\"'.repeat(30_000)]) {
    const started = performance.now()
    scrub(text)
    assert.ok(performance.now() - started < 400, `${text.slice(0, 14)}… took ${Math.round(performance.now() - started)} ms`)
  }
})

test('an encrypted token with an empty key part is a token, and a token at the end of a sentence is one with its full stop kept', () => {
  const scrub = createScrubber([])

  assert.equal(scrub('jwe eyJhbGciOiJkaXIiLCJlbmMiOiJBMTI4R0NNIn0..dGhlaXY.Y2lwaGVydGV4dA.dGFndGFn done'), 'jwe [REDACTED] done')
  assert.equal(scrub('token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0.dBjftJeZ4CVP. Next sentence.'), 'token [REDACTED]. Next sentence.')
  assert.equal(scrub('ends here.'), 'ends here.')
  assert.equal(scrub('jwe-like eyJhbGciOiJkaXIiLCJlbmMiOiJBMTI4R0NNIn0..a.b.c here'), 'jwe-like eyJhbGciOiJkaXIiLCJlbmMiOiJBMTI4R0NNIn0..a.b.c here') // five parts, but the rest is far too short
})

test('only a word that is a token is taken for one: three or five parts, the first beginning eyJ, none of them tiny', () => {
  const scrub = createScrubber([])

  assert.equal(scrub('a eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0.dBjftJeZ4CVP b'), 'a [REDACTED] b')
  assert.equal(scrub('a eyJhbGciOiJ.eyJzdWIiOiIxMjM0.dBjftJeZ4CVP.ZW5jcnlwdGVk.dGFn b'), 'a [REDACTED] b') // five parts: encrypted
  assert.equal(scrub('see abcdefghijkl.abcdefgh.abcd here'), 'see abcdefghijkl.abcdefgh.abcd here') // three parts, but not eyJ
  assert.equal(scrub('see eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0.dBjf.ZW5j here'), 'see eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0.dBjf.ZW5j here') // four parts
  assert.equal(scrub('see eyJhbGci.eyJzdWIiOiI.dBjf here'), 'see eyJhbGci.eyJzdWIiOiI.dBjf here') // the first part is too short
  assert.equal(scrub('see eyJhbGciOiJIUzI1NiJ9.eyJzdWI.dBjf here'), 'see eyJhbGciOiJIUzI1NiJ9.eyJzdWI.dBjf here') // the second is
  assert.equal(scrub('see eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIx.dBj here'), 'see eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIx.dBj here') // the third is
})

test('an address ends at a space, a quote or an angle bracket, and the text around it is kept', () => {
  assert.equal(createScrubber([])('see "https://x.example.com/a?b=1" and <https://y.example.com/b#f> and \'http://z.example.com/c?d\' ok'), 'see "https://x.example.com/a" and <https://y.example.com/b> and \'http://z.example.com/c\' ok')
})

test('a query string and a fragment are cut off every address in a text, and the rest of the text is kept', () => {
  const scrub = createScrubber([])

  assert.equal(scrub('GET https://shop.example.com/cb?code=XYZ&state=1#frag failed'), 'GET https://shop.example.com/cb failed')
  assert.equal(scrub('see http://localhost:5173/a/b?x=1 and https://x.example.com/'), 'see http://localhost:5173/a/b and https://x.example.com/')
  assert.equal(scrub('what? this is a sentence, not an address'), 'what? this is a sentence, not an address')
})

test('ordinary text passes unchanged', () => {
  const scrub = createScrubber(['SECRETSECRET'])

  for (const text of ['Something broke', 'TypeError: Cannot read properties of undefined (reading \'send\')', 'tokens are fine, and so is a passport', 'session started', '']) assert.equal(scrub(text), text)
})

test('a credential in JSON is scrubbed, in quotes and with the quotes escaped', () => {
  const scrub = createScrubber([])

  assert.equal(scrub('{"access_token":"OPAQUE_SECRET_VALUE","expires":3600}'), '{"access_token":"[REDACTED]","expires":3600}')
  assert.equal(scrub('{ "password" : "hunter22x" }'), '{ "password" : "[REDACTED]" }')
  assert.equal(scrub(String.raw`body={\"refresh_token\":\"OPAQUE_SECRET_VALUE\",\"x\":1}`), String.raw`body={\"refresh_token\":\"[REDACTED]\",\"x\":1}`)
  assert.equal(scrub('{"name":"Ada","token_count":5}'), '{"name":"Ada","token_count":5}')
})

test('scrubbing is linear: text built to make a pattern start over and over does not take long', () => {
  const scrub = createScrubber(['SECRETSECRET'])
  for (const text of ['eyJ'.repeat(60_000), 'https://x/'.repeat(30_000), 'eyJaaaaaaaaa.'.repeat(20_000), 'Bearer '.repeat(30_000), 'authorization:'.padEnd(100_000, ' '), `token=${'a'.repeat(100_000)}`.repeat(2)]) {
    const started = performance.now()
    scrub(text)
    assert.ok(performance.now() - started < 400, `${text.slice(0, 12)}… took ${Math.round(performance.now() - started)} ms`)
  }
})

test('scrubbing is linear: a long text with nothing to scrub does not take long', () => {
  const started = performance.now()
  createScrubber(['SECRETSECRET'])('a'.repeat(200_000) + ' https://x.example.com/' + 'b'.repeat(100_000))

  assert.ok(performance.now() - started < 500, `took ${Math.round(performance.now() - started)} ms`)
})

test('secretsOf also takes the strings out of the IndexedDB records of a saved login, however deep, and not the short ones', () => {
  const state = {
    cookies: [],
    origins: [{ origin: 'https://x', indexedDB: [{ name: 'db', version: 1, stores: [{ name: 's', records: [{ key: 'k', value: { token: 'IDB_TOKEN_VALUE', nested: { list: ['IDB_DEEP_VALUE', 'ab'] } } }, { key: 'plain', value: 'IDB_PLAIN_VALUE' }] }] }] }],
  }

  assert.deepEqual(secretsOf(state, []).sort(), ['IDB_DEEP_VALUE', 'IDB_PLAIN_VALUE', 'IDB_TOKEN_VALUE'])
})

test('secretsOf takes at most 500 strings from IndexedDB, the longest first, and does not follow a structure for ever', () => {
  const records = Array.from({ length: 2000 }, (_, index) => ({ key: index, value: `value-${String(index).padStart(5, '0')}` }))
  const deep = {}
  let at = deep
  for (let level = 0; level < 5000; level++) at = at.next = {}
  at.end = 'DEEP_END_VALUE'

  const found = secretsOf({ cookies: [], origins: [{ indexedDB: [{ stores: [{ records }] }, { stores: [{ records: [{ value: deep }] }] }] }] }, [])

  assert.equal(found.length, 500)
  assert.ok(!found.includes('DEEP_END_VALUE'))
})

test('secretsOf takes the values out of a saved login and of the steps that type', () => {
  const state = {
    cookies: [{ name: 'sid', value: 'COOKIE_ONE' }, { name: 'b', value: 'COOKIE_TWO' }],
    origins: [{ origin: 'https://x', localStorage: [{ name: 'token', value: 'LOCAL_ONE' }] }, { origin: 'https://y' }],
  }
  const steps = [{ action: 'fill', selector: '#p', value: 'TYPED_ONE' }, { action: 'expectValue', selector: '#p', value: 'TYPED_TWO' }, { action: 'click', selector: '#go' }, { action: 'expectText', text: 'Hello there' }]

  assert.deepEqual(secretsOf(state, steps).sort(), ['COOKIE_ONE', 'COOKIE_TWO', 'LOCAL_ONE', 'TYPED_ONE', 'TYPED_TWO'])
  assert.deepEqual(secretsOf(undefined, undefined), [])
  assert.deepEqual(secretsOf({ cookies: 'nope', origins: [{ localStorage: 7 }] }, [null, 3]), [])
})
