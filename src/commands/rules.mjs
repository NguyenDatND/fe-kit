import { readdir, readFile, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { UsageError } from '../lib/errors.mjs'
import { plural, warningsBlock } from '../lib/format.mjs'
import { describeYamlError, parseFrontmatter } from '../lib/frontmatter.mjs'
import { isValidGlob, matchesAny, toPosix } from '../lib/glob.mjs'
import { profileStandards, redactCredentials } from '../lib/profile.mjs'
import { resolveProject } from '../lib/project.mjs'
import { expandGlobs } from '../lib/walk.mjs'

export const options = { files: { type: 'string', multiple: true } }

export const usage = `Usage: fe-kit rules --files <path> [<path>...] [--json]

Lists the standards documents that apply to the files about to be changed: the documents of the project (the standards
of its profile, else CONTRIBUTING.md, CLAUDE.md, AGENTS.md) first, then the references of the kit. Files may also be
given without --files. A file that does not exist yet is fine. Read the listed documents and no others.
Exit code: 0, or 2 for a usage error.
`

// Where a project keeps its conventions when its profile does not say. Order is priority, and AGENTS.md is often a link to CLAUDE.md.
const DEFAULT_STANDARDS = ['CONTRIBUTING.md', 'CLAUDE.md', 'AGENTS.md']
const REFERENCES_DIR = 'skills/fe-standards/references'

/** `path` with symlinks resolved as far as it exists: a file about to be created sits in folders that may not be there yet. */
async function realPathEvenIfMissing(path) {
  const missing = []
  for (let current = path; ; current = dirname(current)) {
    try {
      return join(await realpath(current), ...missing.reverse())
    } catch {
      if (dirname(current) === current) return path
      missing.push(basename(current))
    }
  }
}

/** A path given on the command line as a project-relative path with `/`; null when it is outside the project. */
async function projectRelative(project, given) {
  // Resolved, so that a path spelled through a symlink (a /var that is really /private/var) still lands inside.
  const inside = relative(project.projectRoot, await realPathEvenIfMissing(resolve(project.here, given)))
  return inside === '..' || inside.startsWith(`..${'/'}`) || inside.startsWith('..\\') || isAbsolute(inside) ? null : toPosix(inside)
}

/** A frontmatter value that is one string or a list of strings, as a list; null when absent or of another kind (then `onInvalid` runs). */
function stringList(value, onInvalid) {
  if (value === undefined) return null
  if (typeof value === 'string') return [value]
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return value
  onInvalid()
  return null
}

/**
 * What a rule document says about what it covers: `paths` (globs of files) and `frameworks` (the detected framework of
 * the project), each a list or null for "everything". A document that cannot be read as it was meant covers
 * everything, and says so in `warnings`: reading too much is better than silently reading too little.
 */
async function readScope(path, name, warnings) {
  const everything = { paths: null, frameworks: null }
  let text
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    warnings.push(`${name}: could not be read (${error.code ?? 'error'})`)
    return everything
  }
  let data
  try {
    data = parseFrontmatter(text).data
  } catch (error) {
    warnings.push(`${name}: ${describeYamlError(error)}`)
    return everything
  }
  let paths = stringList(data?.paths, () => warnings.push(`${name}: "paths" must be a glob or a list of globs`))
  if (paths && !paths.every(isValidGlob)) {
    warnings.push(`${name}: "paths" has a glob that is not valid`)
    paths = null
  }
  return {
    paths,
    frameworks: stringList(data?.frameworks, () => warnings.push(`${name}: "frameworks" must be a name or a list of names`)),
  }
}

/** The documents of the project, in the order the profile (or the defaults) lists them, each real file once. */
async function projectDocuments(project, warnings) {
  const globs = profileStandards(project.settings) ?? DEFAULT_STANDARDS
  const seen = new Set()
  const documents = []
  for (const glob of globs) {
    const { files, rejected, unreadable } = await expandGlobs(project.projectRoot, [glob])
    for (const entry of rejected) warnings.push(`standards entry "${entry}" leaves the project; ignored`)
    for (const { path, code } of unreadable) warnings.push(`${path}: could not be read, so documents in it are missing (${code})`)
    for (const file of files) {
      const path = join(project.projectRoot, file)
      const real = await realpath(path).catch(() => path)
      if (seen.has(real)) continue
      seen.add(real)
      documents.push({ origin: 'project', path, relative: file })
    }
  }
  return documents
}

async function kitDocuments(kitRoot, warnings) {
  const names = await readdir(join(kitRoot, REFERENCES_DIR)).catch((error) => {
    // A kit without the folder has no references of its own; one that cannot be read is a broken install, and the answer would be silently thinner.
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') warnings.push(`${REFERENCES_DIR}: could not be read, so the kit's documents are missing (${error.code ?? 'error'})`)
    return []
  })
  return names
    .filter((name) => name.endsWith('.md'))
    .sort()
    .map((name) => ({ origin: 'kit', path: join(kitRoot, REFERENCES_DIR, name), relative: `${REFERENCES_DIR}/${name}` }))
}

function formatRules(data) {
  const lines = [`Rules for ${plural(data.files.length, 'file')} (project documents come first and win over the kit's):`]
  for (const rule of data.rules) {
    const shown = rule.origin === 'project' ? rule.relative : rule.path
    const scope = rule.paths ? `, paths ${rule.paths.join(' ')}` : ''
    const subset = rule.appliesTo.length < data.files.length ? ` for ${rule.appliesTo.join(', ')}` : ''
    lines.push(`${shown} (${rule.origin}${scope})${subset}`)
  }
  if (data.rules.length === 0) lines.push('No rules apply.')
  if (data.warnings.length > 0) lines.push(warningsBlock(data.warnings))
  return `${lines.join('\n')}\n`
}

/**
 * Which rule documents apply to the files about to be changed, so that an agent reads those and not all of them.
 * A document says what it covers with `paths:` (globs) and `frameworks:` (detected framework names) in its
 * frontmatter; one without them covers every file of every project.
 */
export async function run({ args, flags, cwd, env, kitRoot }) {
  const given = [...(flags.files ?? []), ...args]
  if (given.length === 0) throw new UsageError('give the files you are about to change: fe-kit rules --files <path> [<path>...]')

  const project = await resolveProject({ cwd, env, kitRoot })
  const warnings = [...project.warnings]
  const files = []
  for (const path of given) {
    const inside = await projectRelative(project, path)
    if (inside === null) warnings.push(`${path} is outside the project; ignored`)
    else if (!files.includes(inside)) files.push(inside)
  }

  const rules = []
  for (const document of [...(await projectDocuments(project, warnings)), ...(await kitDocuments(kitRoot, warnings))]) {
    const { paths, frameworks } = await readScope(document.path, document.relative, warnings)
    if (frameworks !== null && !frameworks.includes(project.stack.framework)) continue
    const appliesTo = paths === null ? files : files.filter((file) => matchesAny(file, paths))
    if (appliesTo.length > 0) rules.push({ ...document, paths, frameworks, appliesTo })
  }

  const data = redactCredentials({ projectRoot: project.projectRoot, files, rules, warnings })
  return { data, text: formatRules(data) }
}
