import { appendFile, mkdir, readFile, readlink, realpath, symlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { draftsDir, hasCatchAll } from '../lib/drafts.mjs'
import { exists, lstatOrNull } from '../lib/fsx.mjs'
import { findProjectRoot, getExcludeFile } from '../lib/git.mjs'

export const options = {
  'dry-run': { type: 'boolean' },
  'no-agents-link': { type: 'boolean' },
}

export const usage = `Usage: fe-kit init [--dry-run] [--no-agents-link] [--json]

Prepares a project for fe-kit: creates .fe-kit/ with a .gitignore that hides everything in it and, when the project has
a CLAUDE.md but no AGENTS.md, links AGENTS.md to it (the link stays out of git status; --no-agents-link skips it).
--dry-run only says what would be done.
`

const AGENTS_EXCLUDE_LINE = '/AGENTS.md'

/** Codex and Antigravity read AGENTS.md but not CLAUDE.md, so a CLAUDE.md-only repo gets a link. */
async function planAgentsLink(root) {
  const claudePath = join(root, 'CLAUDE.md')
  const agentsPath = join(root, 'AGENTS.md')
  const claude = await lstatOrNull(claudePath)
  const agents = await lstatOrNull(agentsPath)

  if (!claude) return { action: 'skipped', note: 'no CLAUDE.md to link' }
  if (agents) {
    const alreadyLinked = agents.isSymbolicLink() && (await readlink(agentsPath)) === 'CLAUDE.md'
    return alreadyLinked ? { action: 'unchanged' } : { action: 'skipped', note: 'AGENTS.md already exists' }
  }
  // AGENTS.md is absent, so a CLAUDE.md that is a symlink to nowhere may well point back at it.
  // Linking AGENTS.md to it would make a loop, however the path to AGENTS.md happens to be spelled.
  if (claude.isSymbolicLink() && !(await exists(claudePath))) {
    return { action: 'skipped', note: 'CLAUDE.md is a symlink to a missing file (possibly AGENTS.md)' }
  }
  return { action: 'created' }
}

/** Appending to a link would append to whatever it leads to, a file of the project say: throws for one. A dry run asks the same. */
async function assertAppendable(file) {
  const found = await lstatOrNull(file)
  if (found && (found.isSymbolicLink() || found.nlink > 1)) throw new Error('it is a link (symbolic or hard) to another file, which would change too')
}

async function appendLine(file, line) {
  await assertAppendable(file)
  // Only a file that is not there counts as empty: one that cannot be read must not be appended to blindly.
  const current = await readFile(file, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return ''
    throw error
  })
  const separator = current === '' || current.endsWith('\n') ? '' : '\n'
  await appendFile(file, `${separator}${line}\n`)
}

async function ensureExcluded(excludeFile, line, dryRun) {
  const current = await readFile(excludeFile, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return ''
    throw error // one that cannot be read is not an empty one
  })
  if (current.split('\n').includes(line)) return 'unchanged'
  await assertAppendable(excludeFile)
  if (!dryRun) {
    await mkdir(dirname(excludeFile), { recursive: true })
    await appendLine(excludeFile, line)
  }
  return 'updated'
}

/**
 * `.fe-kit/.gitignore` holding a catch-all `*` keeps every draft out of git status, whatever rules the project has
 * (see hasCatchAll). One that is already there keeps its own lines and gets the `*` appended when it lacks one.
 */
async function planDraftsIgnore(file) {
  const found = await lstatOrNull(file)
  if (!found) return { action: 'created' }
  if (!found.isFile()) return { action: 'skipped', note: 'not a regular file' }
  try {
    if (await hasCatchAll(file)) return { action: 'unchanged' }
    if (found.nlink > 1) return { action: 'skipped', note: 'it is a hard link to another file, which would change too' }
    return { action: 'updated', note: 'had no catch-all "*", added one' }
  } catch (error) {
    return { action: 'skipped', note: `could not read it: ${error.message}` }
  }
}

/** Create-only write: a concurrent run that got there first is not an error. */
const writeIfAbsent = (path, content) =>
  writeFile(path, content, { flag: 'wx' }).catch((error) => {
    if (error.code !== 'EEXIST') throw error
  })

function formatActions(root, actions, dryRun) {
  const lines = actions.map(({ action, path, note }) => {
    const shown = path.startsWith(root) ? relative(root, path) : path
    return `${action.padEnd(9)} ${shown}${note ? ` (${note})` : ''}`
  })
  return `${[`Project root: ${root}${dryRun ? ' (dry run, nothing written)' : ''}`, ...lines].join('\n')}\n`
}

/**
 * Prepares a project for fe-kit. `.fe-kit/.gitignore` containing `*` is enough to keep git status clean,
 * so the project's own .gitignore and info/exclude are not touched for it.
 */
export async function run({ flags, cwd, env = {} }) {
  const dryRun = Boolean(flags['dry-run'])
  const { root, isGit } = await findProjectRoot(await realpath(cwd), { home: env.HOME ?? homedir() })
  const actions = []
  const record = (action, path, note) => actions.push({ action, path, ...(note ? { note } : {}) })

  const drafts = draftsDir(root)
  const draftsFound = await lstatOrNull(drafts)
  if (draftsFound && !draftsFound.isDirectory()) {
    // A symlink or a file: writing here would go through it, possibly into somewhere else entirely.
    record('skipped', drafts, 'exists and is not a real directory')
  } else {
    if (draftsFound) {
      record('unchanged', drafts)
    } else {
      record('created', drafts)
      if (!dryRun) await mkdir(drafts, { recursive: true })
    }

    const draftsIgnore = join(drafts, '.gitignore')
    let { action, note } = await planDraftsIgnore(draftsIgnore)
    if (!dryRun && (action === 'created' || action === 'updated')) {
      try {
        await (action === 'created' ? writeIfAbsent(draftsIgnore, '*\n') : appendLine(draftsIgnore, '*'))
      } catch (error) {
        action = 'skipped'
        note = `could not write it: ${error.message}; drafts may show up in git status`
      }
    }
    record(action, draftsIgnore, note)
  }

  if (!flags['no-agents-link']) {
    const agentsPath = join(root, 'AGENTS.md')
    const plan = await planAgentsLink(root)
    let { action, note } = plan

    // Exclude first: where it cannot be written (a read-only .git inside a sandbox) the link must not be
    // created, or it would sit there untracked and one `git add -A` away from being committed.
    let exclude = null
    if (isGit && (action === 'created' || action === 'unchanged')) {
      const file = await getExcludeFile(root)
      if (file) {
        try {
          exclude = { path: file, action: await ensureExcluded(file, AGENTS_EXCLUDE_LINE, dryRun) }
        } catch (error) {
          exclude = { path: file, error: `could not update ${file}: ${error.message}` }
          if (action === 'created') {
            action = 'skipped'
            note = exclude.error
          }
        }
      }
    }

    if (action === 'created' && !dryRun) {
      try {
        await symlink('CLAUDE.md', agentsPath)
      } catch (error) {
        if (error.code === 'EEXIST' && (await planAgentsLink(root)).action === 'unchanged') {
          action = 'unchanged'
        } else {
          action = 'skipped'
          note = `could not create the link: ${error.message}`
        }
      }
    }

    record(action, agentsPath, note ?? (!isGit && action !== 'skipped' ? 'not a git repo, nothing to exclude' : undefined))
    if (exclude && !exclude.error) record(exclude.action, exclude.path)
    else if (exclude?.error && plan.action === 'unchanged') record('skipped', exclude.path, exclude.error)
  }

  return { data: { root, isGit, dryRun, actions }, text: formatActions(root, actions, dryRun) }
}
