import { sep } from 'node:path'

/**
 * Globs for the `paths` of rule files and the `standards` of a profile. Node 20 has no glob matcher of its own, and
 * this is all that is needed: `**`, `*`, `?`, `[abc]`, `{a,b}` and `\` to escape. A glob matches a whole relative
 * path, written with `/`. Dot files and dot directories are matched like any other, because `.fe-kit/` is one.
 */

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Index of the `}` that closes the `{` at `open`, or -1. Nested braces and escaped characters are skipped. */
function closingBrace(glob, open) {
  let depth = 0
  for (let index = open; index < glob.length; index++) {
    if (glob[index] === '\\') index++
    else if (glob[index] === '{') depth++
    else if (glob[index] === '}' && --depth === 0) return index
  }
  return -1
}

/** The top-level parts of a brace body: `a,b{c,d}` gives `a` and `b{c,d}`. */
function splitAlternatives(body) {
  const parts = []
  let depth = 0
  let start = 0
  for (let index = 0; index < body.length; index++) {
    if (body[index] === '\\') index++
    else if (body[index] === '{') depth++
    else if (body[index] === '}') depth--
    else if (body[index] === ',' && depth === 0) {
      parts.push(body.slice(start, index))
      start = index + 1
    }
  }
  parts.push(body.slice(start))
  return parts
}

/** Index of the `]` that closes the `[` at `open`, or -1. A `]` right after the opening (or after `!`/`^`) is a member. */
function classEnd(glob, open) {
  let index = open + 1
  if (glob[index] === '!' || glob[index] === '^') index++
  if (glob[index] === ']') index++
  return glob.indexOf(']', index)
}

function classSource(inner) {
  const negated = inner[0] === '!' || inner[0] === '^'
  const members = (negated ? inner.slice(1) : inner).replace(/\\/g, '\\\\').replace(/]/g, '\\]')
  return negated ? `[^${members}/]` : `[${members}]`
}

function toSource(glob) {
  let source = ''
  let index = 0
  while (index < glob.length) {
    const char = glob[index]
    if (char === '\\' && index + 1 < glob.length) {
      source += escape(glob[index + 1])
      index += 2
    } else if (char === '*') {
      let end = index
      while (glob[end] === '*') end++
      const alone = end - index >= 2 && (index === 0 || glob[index - 1] === '/') && (end === glob.length || glob[end] === '/')
      if (alone && end === glob.length) {
        source += '.*' // `src/**`: everything beneath
        index = end
      } else if (alone) {
        source += '(?:.*/)?' // `**/`: zero or more directories
        index = end + 1
        while (glob.startsWith('**/', index)) index += 3 // `**/**/` says the same, and each copy would multiply the work
      } else {
        source += '[^/]*'
        index = end
      }
    } else if (char === '?') {
      source += '[^/]'
      index++
    } else if (char === '[' && classEnd(glob, index) !== -1) {
      const end = classEnd(glob, index)
      source += classSource(glob.slice(index + 1, end))
      index = end + 1
    } else if (char === '{') {
      const end = closingBrace(glob, index)
      const parts = end === -1 ? [] : splitAlternatives(glob.slice(index + 1, end))
      if (parts.length < 2) {
        source += '\\{' // not an alternation, so just a character
        index++
      } else {
        source += `(?:${parts.map(toSource).join('|')})`
        index = end + 1
      }
    } else {
      source += escape(char)
      index++
    }
  }
  return source
}

const compiled = new Map()

/** Runs of `*` in a glob, counting for a brace group only its richest alternative: only one of them is ever in play. */
function wildcards(glob) {
  let count = 0
  let index = 0
  while (index < glob.length) {
    if (glob[index] === '\\') index += 2
    else if (glob[index] === '*') {
      while (glob[index] === '*') index++
      count++
    } else if (glob[index] === '{' && closingBrace(glob, index) !== -1) {
      const end = closingBrace(glob, index)
      count += Math.max(...splitAlternatives(glob.slice(index + 1, end)).map(wildcards))
      index = end + 1
    } else index++
  }
  return count
}
// Every `*` can try every position of the path, so a glob made of many of them takes exponential time on a path that
// almost matches (eight `*a` took ten seconds on a short path). No real glob has this many, so such a glob is invalid.
const MAX_WILDCARDS = 6

/** `./` and a leading `/` mean nothing: every path is relative to the project root. */
const stripLeading = (text) => text.replace(/^(?:\.\/)+/, '').replace(/^\/+/, '')

/** The RegExp of a glob. Throws when the glob cannot be compiled (a class such as `[z-a]`) or has too many wildcards. */
export function globToRegExp(glob) {
  if (!compiled.has(glob)) {
    if (wildcards(glob) > MAX_WILDCARDS) throw new Error('too many wildcards')
    compiled.set(glob, new RegExp(`^${toSource(stripLeading(glob))}$`))
  }
  return compiled.get(glob)
}

export function isValidGlob(glob) {
  try {
    globToRegExp(glob)
    return true
  } catch {
    return false
  }
}

/** An invalid glob matches nothing: a glob written by hand in a profile or a document must not stop a command. */
export const matchesGlob = (path, glob) => isValidGlob(glob) && globToRegExp(glob).test(path.replace(/^(?:\.\/)+/, ''))

export const matchesAny = (path, globs) => globs.some((glob) => matchesGlob(path, glob))

/** A path as the globs above expect it: `/` between segments, whatever the platform's separator is. */
export const toPosix = (path) => (sep === '/' ? path : path.split(sep).join('/'))
