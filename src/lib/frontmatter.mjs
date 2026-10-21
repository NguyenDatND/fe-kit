import { parse as parseYaml } from 'yaml'

// The closing --- ends its line (trailing blanks allowed) or the text; `---oops` and `----` do not close it.
// The lazy `??` makes an empty frontmatter (--- directly followed by ---) win over a later --- in the body.
const FRONTMATTER = /^---\r?\n(?:([\s\S]*?)\r?\n)??---[ \t]*(?:\r?\n([\s\S]*)|$)/

/** Splits `---` frontmatter from the body; null when the text has none. YAML is not parsed here. */
export function splitFrontmatter(text) {
  const match = FRONTMATTER.exec(text)
  return match ? { raw: match[1] ?? '', body: match[2] ?? '' } : null
}

/**
 * First line of an error message. Enough for files that hold no secrets (skills). The YAML parser's messages quote
 * the source even on the first line, so anything that may hold a credential goes through describeYamlError.
 */
export const firstLine = (message) => message.split('\n')[0]

/** Frontmatter as an object plus the body. No frontmatter gives `{ data: {}, body: text }`; invalid YAML throws. */
export function parseFrontmatter(text) {
  const parts = splitFrontmatter(text)
  if (!parts) return { data: {}, body: text }
  // logLevel 'error': at the default level the parser prints warnings (an unresolved tag, say) to stderr, source line included.
  return { data: parseYaml(parts.raw, { logLevel: 'error' }) ?? {}, body: parts.body }
}

/**
 * A YAML error reduced to what is safe to print: its code and where it is. The parser's own message quotes the
 * source (a block scalar header, an alias name), and a profile may hold a credential.
 */
export function describeYamlError(error) {
  const position = error.linePos?.[0]
  const kind = error.code ?? (error instanceof ReferenceError ? 'alias error' : error.name)
  return `invalid YAML (${kind})${position ? ` at line ${position.line}, column ${position.col} of the frontmatter` : ''}`
}
