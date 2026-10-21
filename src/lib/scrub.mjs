/**
 * Takes secrets out of text before it is shown, kept or written: a console message of a page can quote a cookie, an error can
 * quote an address with a token in it, a log can quote a header. Two kinds of help: values that are known to be secret (a saved
 * login, what a step types) go wherever they are found, and what looks like a credential goes without being known. It cannot find
 * a secret it was not told about in a form it does not recognise; the kit does not promise it (plan §5.8).
 *
 * Everything here runs in one pass over the text: it is applied to what a page printed, which can be anything, and it runs
 * synchronously, out of reach of any timeout. A pattern that starts again at every character of a long run (a JWT, an address)
 * is quadratic on text made for it, so those two are found by walking the text, not by a regular expression.
 */

const MIN_SECRET_LENGTH = 4
const MIN_STORED_LENGTH = 8 // what is taken from IndexedDB: short strings there are names and flags, not credentials
const MAX_STORED = 500
const MAX_STORED_DEPTH = 12
const MAX_STORED_VISITS = 100_000
const MASK = '[REDACTED]'
const KEYS = '(?:set-)?cookie|x-api-key|api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|token|password|passwd|secret|session|sid|jwt|authorization'
const AUTHORIZATION = /(authorization\s*:\s*)(?:bearer\s+|basic\s+)?[^\s"',;]{4,}/gi
const BEARER = /(bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi
const JSON_KEY = `(\\\\?"(?:${KEYS})\\\\?"\\s*:\\s*)(\\\\?")`
const PAIR = new RegExp(`\\b(${KEYS})(\\s*[:=]\\s*)[^\\s&;,"'<>]{4,}`, 'gi')
const WORD = /[A-Za-z0-9._-]+/g
const SCHEME = /https?:\/\//g

/** A signed token has three parts (JWS), an encrypted one five (JWE, whose second part is empty when the key is agreed rather than sent). */
const isToken = (word) => {
  const parts = word.split('.')
  if (!parts[0].startsWith('eyJ') || parts[0].length < 11) return false
  if (parts.length === 3) return parts[1].length >= 8 && parts[2].length >= 4
  return parts.length === 5 && parts[2].length >= 4 && parts[3].length >= 4 && parts[4].length >= 4
}

/** A word that may be a token, with the full stop that ends a sentence left out of it and kept in the text. */
function maskToken(word) {
  let end = word.length
  while (end > 0 && word[end - 1] === '.') end-- // by hand: a regular expression for a run of full stops at the end restarts at each one
  return isToken(word.slice(0, end)) ? MASK + word.slice(end) : word
}

/**
 * Where the value of a JSON string that starts at `from` ends: at its closing quote. In plain JSON a quote is the closing one
 * when an even number of backslashes comes before it. In JSON that sits inside a string escaped once, every backslash of the
 * inner text is doubled and the quote itself is `\"`: the closing quote has an odd run of backslashes before it, of which the
 * last one is the escape of the quote and the rest, halved, an even number of inner backslashes. -1 when it never closes.
 * Each character is looked at once.
 */
function jsonValueEnd(text, from, escapedOnce) {
  let at = from
  while (at < text.length) {
    if (text[at] === '"') return at // a quote with no backslash before it: the end of the string, escaped or not
    if (text[at] !== '\\') {
      at++
      continue
    }
    let after = at
    while (text[after] === '\\') after++
    const run = after - at
    if (text[after] === '"') {
      if (escapedOnce ? run % 2 === 1 && (run - 1) / 2 % 2 === 0 : run % 2 === 0) return escapedOnce ? after - 1 : after
      at = after + 1
    } else {
      at = after
    }
  }
  return -1
}

/** The values of JSON members that look like credentials, whole: `"password":"..."`, plain or escaped once. */
function maskJsonValues(text) {
  const key = new RegExp(JSON_KEY, 'gi')
  let result = ''
  let kept = 0
  for (;;) {
    const match = key.exec(text)
    if (match === null) break
    const from = match.index + match[0].length
    const end = jsonValueEnd(text, from, match[2] === '\\"')
    const stop = end === -1 ? text.length : end
    if (stop > from) {
      result += text.slice(kept, from) + MASK
      kept = stop
      key.lastIndex = Math.max(stop, key.lastIndex)
    }
  }
  return result + text.slice(kept)
}

/** The query string and the fragment cut off every address in the text; each character is looked at once. */
function stripQueries(text) {
  let result = ''
  let from = 0
  for (;;) {
    SCHEME.lastIndex = from
    const match = SCHEME.exec(text)
    if (match === null) break
    let end = match.index + match[0].length
    while (end < text.length && !/[\s"'<>]/.test(text[end])) end++
    const address = text.slice(match.index, end)
    const cut = address.search(/[?#]/)
    result += text.slice(from, match.index) + (cut === -1 ? address : address.slice(0, cut))
    from = end
  }
  return result + text.slice(from)
}

export function createScrubber(secrets) {
  const given = secrets.filter((secret) => typeof secret === 'string' && secret.length >= MIN_SECRET_LENGTH)
  // A secret reaches the text as it is, and as JSON writes it (quotes and backslashes escaped), once or twice.
  const once = given.map((secret) => JSON.stringify(secret).slice(1, -1))
  const twice = once.map((secret) => JSON.stringify(secret).slice(1, -1))
  const known = [...new Set([...given, ...once, ...twice])].sort((a, b) => b.length - a.length)
  return (text) => {
    let result = text
    // split and join, not a regular expression: a secret is text, and `a.b+c` must match itself and nothing else.
    for (const secret of known) result = result.split(secret).join(MASK)
    return stripQueries(
      maskJsonValues(result)
        .replace(WORD, maskToken)
        .replace(AUTHORIZATION, `$1${MASK}`)
        .replace(BEARER, `$1${MASK}`)
        .replace(PAIR, `$1$2${MASK}`),
    )
  }
}

/** The strings of IndexedDB records, at any depth up to a limit: the longest of them, at most MAX_STORED. */
function storedStrings(databases) {
  const found = []
  const pending = [[databases, 0]]
  for (let visits = 0; pending.length > 0 && visits < MAX_STORED_VISITS; visits++) {
    const [value, depth] = pending.pop()
    if (typeof value === 'string') {
      if (value.length >= MIN_STORED_LENGTH) found.push(value)
    } else if (depth < MAX_STORED_DEPTH && value !== null && typeof value === 'object') {
      for (const item of Array.isArray(value) ? value : Object.values(value)) pending.push([item, depth + 1])
    }
  }
  return found.sort((a, b) => b.length - a.length).slice(0, MAX_STORED)
}

/** The values to scrub for a run: the cookies, local storage and IndexedDB of the saved login, and what the steps type. */
export function secretsOf(storageState, steps) {
  const secrets = []
  if (Array.isArray(storageState?.cookies)) for (const cookie of storageState.cookies) secrets.push(cookie?.value)
  if (Array.isArray(storageState?.origins)) {
    for (const origin of storageState.origins) {
      if (Array.isArray(origin?.localStorage)) for (const entry of origin.localStorage) secrets.push(entry?.value)
      if (origin?.indexedDB !== undefined) secrets.push(...storedStrings(origin.indexedDB))
    }
  }
  if (Array.isArray(steps)) for (const step of steps) if (step?.action === 'fill' || step?.action === 'expectValue') secrets.push(step.value)
  return secrets.filter((secret) => typeof secret === 'string')
}
