import { randomBytes } from 'node:crypto'
import { access, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { stateRoot } from './auth-store.mjs'
import { ConfigChangedError, deleteFileSafely, hashText, readTextIfExists, writeTextSafely } from './config-files.mjs'
import { UsageError } from './errors.mjs'
import { defaultLinkMode, installDirectory, removeInstalled } from './fsx.mjs'
import { applyEntries, ConfigProblem, expandHome, guardPlan, OWNED_HEADER, parseJsonConfig, removeEntries, serializeJsonConfig } from './guard-config.mjs'
import { getTarget, TOOLS } from './tools.mjs'

// `fe-kit link` and `unlink`: what is put into each tool, what is recorded about it, and how an interrupted run is
// finished. The skills carry their own proof of ownership (a link to the kit, or a marked copy). The configuration files
// do not, so before the first change a journal says what is about to happen, and a record (`install.json`) says what was
// added to which file, so that `unlink` takes out only that.

export { ConfigChangedError }

export const statePath = (stateDir) => join(stateDir, 'install.json')
export const journalPath = (stateDir) => join(stateDir, 'install.journal.json')
export const lockPath = (stateDir) => join(stateDir, 'install.lock')
export const backupsPath = (stateDir) => join(stateDir, 'backups')

export const homeOf = (env) => env.HOME ?? homedir()
export const stateDirOf = (env) => stateRoot(env)

/** The first program called `name` on the PATH, by the path it is found at (not resolved: a link that a package manager keeps pointing at the current version is what is wanted). */
export async function findOnPath(name, pathVariable = '') {
  for (const folder of pathVariable.split(delimiter).filter(Boolean)) {
    const candidate = join(folder, name)
    try {
      await access(candidate)
      return candidate
    } catch {
      // not in this folder
    }
  }
  return null
}

/** Which tools to work on: those named, or those whose folder exists. `skipped` says why the others were left out. */
export async function chooseTools(flag, home) {
  if (flag !== undefined) {
    const names = flag.split(',').map((name) => name.trim()).filter(Boolean)
    if (names.length === 0) throw new UsageError('--tools needs at least one name')
    for (const name of names) if (!Object.hasOwn(TOOLS, name)) throw new UsageError(`unknown tool "${name}": use ${Object.keys(TOOLS).join(', ')}`)
    return { tools: names, skipped: [] }
  }
  const tools = []
  const skipped = []
  for (const name of Object.keys(TOOLS)) {
    const folder = join(home, expandHome(getTarget(name).hooks.path, home).slice(home.length + 1).split('/')[0])
    if (await access(folder).then(() => true, () => false)) tools.push(name)
    else skipped.push({ tool: name, reason: `${folder} does not exist; name the tool with --tools to create it` })
  }
  return { tools, skipped }
}

async function listSkills(kitRoot) {
  const entries = await readdir(join(kitRoot, 'skills'), { withFileTypes: true }).catch(() => [])
  const names = []
  for (const entry of entries) if (entry.isDirectory() && (await access(join(kitRoot, 'skills', entry.name, 'SKILL.md')).then(() => true, () => false))) names.push(entry.name)
  return names.sort()
}

async function readJsonFile(file) {
  const text = await readFile(file, 'utf8').catch((error) => (error.code === 'ENOENT' ? null : Promise.reject(error)))
  if (text === null) return null
  try {
    return JSON.parse(text)
  } catch {
    throw new ConfigProblem(`${file} cannot be read: it is not valid JSON; remove it or fix it`)
  }
}

/** A file only the user can read, written whole or not at all. */
async function writePrivateJson(file, value) {
  await mkdir(join(file, '..'), { recursive: true, mode: 0o700 })
  const staging = `${file}.${process.pid}-${randomBytes(4).toString('hex')}.tmp`
  try {
    await writeFile(staging, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
    await rename(staging, file)
  } catch (error) {
    await rm(staging, { force: true })
    throw error
  }
}

const emptyState = () => ({ version: 1, kitRoot: null, node: null, tools: {} })

export async function readState(stateDir) {
  return (await readJsonFile(statePath(stateDir))) ?? emptyState()
}

function mergeAdded(previous, added) {
  const merged = { appends: [...(previous?.appends ?? [])], sets: [...(previous?.sets ?? [])] }
  for (const entry of added.appends) if (!merged.appends.some((known) => isDeepStrictEqual(known, entry))) merged.appends.push(entry)
  for (const entry of added.sets) if (!merged.sets.some((known) => isDeepStrictEqual(known, entry))) merged.sets.push(entry)
  return merged
}

function recordFor(item, previous) {
  const record = { file: item.file, kind: item.kind, createdFile: previous?.createdFile ?? item.createdFile, afterHash: hashText(item.after) }
  if (item.kind === 'json') record.added = mergeAdded(previous?.added, item.added)
  return record
}

/**
 * Works out, without changing anything, what linking would do. `problems` is a list of `{ file, message }`: when there is
 * one, nothing should be written for any tool.
 */
export async function buildPlan({ kitRoot, home, env, node, tools, mode = defaultLinkMode() }) {
  const problems = []
  const plan = {}
  const hook = join(kitRoot, 'hooks', 'shell-guard.mjs')
  if (!(await access(hook).then(() => true, () => false))) problems.push({ file: hook, message: 'hooks/shell-guard.mjs is missing from the kit, so the guard cannot be installed' })
  const skillNames = await listSkills(kitRoot)
  for (const tool of tools) {
    const target = getTarget(tool)
    const entry = { label: target.label, mode, skills: [], files: [] }
    for (const name of skillNames) {
      const source = join(kitRoot, 'skills', name)
      const destination = join(expandHome(target.skillsDir, home), name)
      const { action } = await installDirectory(source, destination, { mode, dryRun: true })
      if (action === 'skip-foreign') problems.push({ file: destination, message: "exists and is not a link to fe-kit's skill (or a copy made by fe-kit), so it is not replaced" })
      entry.skills.push({ name, source, target: destination, action })
    }
    for (const item of guardPlan({ tool, home, kitRoot, node, env })) {
      try {
        const current = await readTextIfExists(item.file)
        if (item.kind === 'owned') {
          if (current !== null && current !== item.text && !current.startsWith(OWNED_HEADER)) throw new ConfigProblem('not written by fe-kit (it has no fe-kit header), so it is not replaced')
          entry.files.push({ tool, file: item.file, kind: 'owned', action: current === null ? 'create' : current === item.text ? 'unchanged' : 'update', before: current, after: item.text, createdFile: current === null })
        } else {
          const { next, added } = applyEntries(parseJsonConfig(current ?? ''), item.entries)
          const changed = added.appends.length + added.sets.length > 0
          entry.files.push({ tool, file: item.file, kind: 'json', action: !changed ? 'unchanged' : current === null ? 'create' : 'update', before: current, after: serializeJsonConfig(next, current ?? ''), added, createdFile: current === null, count: added.appends.length + added.sets.length })
        }
      } catch (error) {
        if (!(error instanceof ConfigProblem) && error.code === undefined) throw error // a file system error (no permission, a folder in the way) is something to tell, anything else is a bug
        problems.push({ file: item.file, message: error instanceof ConfigProblem ? error.message : `cannot be read (${error.code})` })
      }
    }
    plan[tool] = entry
  }
  return { tools: plan, problems }
}

/** Journal first, then the skills, then each file, then the record. `deps.beforeCommit(item)` and `deps.beforeRecord()` are seams for tests. */
export async function applyPlan(plan, { stateDir, kitRoot, node, deps = {} }) {
  const changing = Object.values(plan.tools).flatMap((entry) => entry.files).filter((item) => item.action !== 'unchanged')
  const skills = Object.entries(plan.tools).flatMap(([tool, entry]) => entry.skills.filter((skill) => skill.action !== 'unchanged').map((skill) => ({ tool, name: skill.name, mode: entry.mode })))
  if (changing.length > 0 || skills.length > 0) {
    await writePrivateJson(journalPath(stateDir), {
      op: 'link',
      kitRoot,
      node,
      skills,
      items: changing.map((item) => ({ tool: item.tool, file: item.file, kind: item.kind, beforeHash: item.before === null ? null : hashText(item.before), afterHash: hashText(item.after), added: item.added ?? null, createdFile: item.createdFile })),
    })
  }
  for (const entry of Object.values(plan.tools)) for (const skill of entry.skills) if (skill.action !== 'unchanged') await installDirectory(skill.source, skill.target, { mode: entry.mode })
  const backups = []
  for (const item of changing) {
    const { backup } = await writeTextSafely(item.file, item.after, { expectedBefore: item.before, backupDir: backupsPath(stateDir), beforeCommit: () => deps.beforeCommit?.(item) })
    if (backup !== null) backups.push(backup)
  }
  await deps.beforeRecord?.()
  const state = await readState(stateDir)
  state.kitRoot = kitRoot
  state.node = node
  for (const [tool, entry] of Object.entries(plan.tools)) {
    const previous = state.tools[tool]?.files ?? []
    const files = previous.filter((record) => !entry.files.some((item) => item.file === record.file))
    for (const item of entry.files) {
      const before = previous.find((record) => record.file === item.file)
      if (item.action === 'unchanged') {
        if (before !== undefined) files.push(before)
      } else files.push(recordFor(item, before))
    }
    state.tools[tool] = { mode: entry.mode, skills: entry.skills.map((skill) => skill.name), files }
  }
  await writePrivateJson(statePath(stateDir), state)
  await rm(journalPath(stateDir), { force: true })
  return { backups }
}

/** Finishes what an earlier run began, by comparing each file with what the journal said it would be before and after. Returns what it found. */
export async function recover(stateDir) {
  const journal = await readJsonFile(journalPath(stateDir))
  if (journal === null) return { messages: [], conflicts: [] }
  const state = await readState(stateDir)
  state.kitRoot ??= journal.kitRoot ?? null
  state.node ??= journal.node ?? null
  const conflicts = []
  let done = 0
  // A run that stopped after making skills and before it wrote the record: the skills are the kit's, whatever became of the files.
  for (const skill of journal.op === 'link' ? journal.skills ?? [] : []) {
    const known = state.tools[skill.tool] ?? { mode: skill.mode, skills: [], files: [] }
    state.tools[skill.tool] = { ...known, mode: skill.mode, skills: [...new Set([...known.skills, skill.name])] } // the mode of the latest run: what it left is what the record must describe
  }
  for (const item of journal.items) {
    const current = await readTextIfExists(item.file).catch(() => undefined)
    const hash = current === undefined ? undefined : current === null ? null : hashText(current)
    if (journal.op === 'link') {
      if (hash === item.afterHash) {
        const files = state.tools[item.tool]?.files ?? []
        const before = files.find((record) => record.file === item.file)
        state.tools[item.tool] = { ...state.tools[item.tool], skills: state.tools[item.tool]?.skills ?? [], files: [...files.filter((record) => record !== before), recordFor({ ...item, after: current ?? '' }, before)] }
        done++
      } else if (hash !== item.beforeHash) conflicts.push({ file: item.file, message: 'was changed after an earlier fe-kit run stopped; anything fe-kit had added to it is not recorded, and unlink will leave it' })
    } else if (hash === item.afterHash) {
      const tool = state.tools[item.tool]
      if (tool) tool.files = tool.files.filter((record) => record.file !== item.file)
      done++
    } else if (hash !== item.beforeHash) conflicts.push({ file: item.file, message: 'was changed after an earlier fe-kit run stopped; anything fe-kit had added to it is not recorded, and unlink will leave it' })
  }
  await writePrivateJson(statePath(stateDir), state)
  await rm(journalPath(stateDir), { force: true })
  return { messages: [`finished an interrupted fe-kit ${journal.op} (${done} of ${journal.items.length} files had been written)`], conflicts }
}

/** What unlinking would do for `tools` that the record knows about. */
export async function buildRemoval({ state, home, tools }) {
  const kept = []
  const problems = []
  const plan = {}
  for (const tool of tools) {
    const recorded = state.tools[tool]
    if (recorded === undefined) continue
    const target = getTarget(tool)
    const skillNames = [...new Set([...recorded.skills, ...(state.kitRoot === null ? [] : await listSkills(state.kitRoot))])].sort()
    const skills = []
    for (const name of skillNames) {
      const destination = join(expandHome(target.skillsDir, home), name)
      const source = join(state.kitRoot ?? '', 'skills', name)
      const { action } = await removeInstalled(destination, { source, dryRun: true })
      skills.push({ name, target: destination, source, action })
    }
    const files = []
    for (const record of recorded.files) {
      try {
        const current = await readTextIfExists(record.file)
        if (current === null) files.push({ tool, file: record.file, kind: record.kind, action: 'missing', before: null, after: null })
        else if (record.kind === 'owned') {
          if (hashText(current) === record.afterHash) files.push({ tool, file: record.file, kind: 'owned', action: 'delete', before: current, after: null })
          else {
            kept.push({ file: record.file, message: 'left as it is: it was changed since fe-kit wrote it' })
            files.push({ tool, file: record.file, kind: 'owned', action: 'unchanged', before: current, after: current })
          }
        } else {
          const config = parseJsonConfig(current)
          const { next, kept: left } = removeEntries(config, record.added)
          for (const item of left) kept.push({ file: record.file, message: `${item.path.join('.')}: left as it is: ${item.reason}` })
          const changed = !isDeepStrictEqual(next, config)
          const deleteIt = changed && record.createdFile && left.length === 0 && Object.keys(next).length === 0
          files.push({ tool, file: record.file, kind: 'json', action: deleteIt ? 'delete' : changed ? 'update' : 'unchanged', before: current, after: deleteIt ? null : changed ? serializeJsonConfig(next, current) : current })
        }
      } catch (error) {
        if (!(error instanceof ConfigProblem)) throw error
        problems.push({ file: record.file, message: error.message })
      }
    }
    plan[tool] = { label: target.label, skills, files }
  }
  return { tools: plan, kept, problems }
}

export async function applyRemoval(removal, { stateDir, deps = {} }) {
  const changing = Object.values(removal.tools).flatMap((entry) => entry.files).filter((item) => item.action === 'update' || item.action === 'delete')
  if (changing.length > 0) {
    await writePrivateJson(journalPath(stateDir), { op: 'unlink', items: changing.map((item) => ({ tool: item.tool, file: item.file, kind: item.kind, beforeHash: hashText(item.before), afterHash: item.after === null ? null : hashText(item.after) })) })
  }
  for (const entry of Object.values(removal.tools)) for (const skill of entry.skills) if (skill.action === 'removed') await removeInstalled(skill.target, { source: skill.source })
  const backups = []
  for (const item of changing) {
    const beforeCommit = () => deps.beforeCommit?.(item)
    const { backup } = item.action === 'delete' ? await deleteFileSafely(item.file, { expectedBefore: item.before, backupDir: backupsPath(stateDir), beforeCommit }) : await writeTextSafely(item.file, item.after, { expectedBefore: item.before, backupDir: backupsPath(stateDir), beforeCommit })
    backups.push(backup)
  }
  await deps.beforeRecord?.()
  const state = await readState(stateDir)
  for (const tool of Object.keys(removal.tools)) delete state.tools[tool]
  if (Object.keys(state.tools).length === 0) await rm(statePath(stateDir), { force: true })
  else await writePrivateJson(statePath(stateDir), state)
  await rm(journalPath(stateDir), { force: true })
  return { backups }
}
