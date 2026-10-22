import assert from 'node:assert/strict'
import { lstat, mkdir, readFile, readdir, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { run as link } from '../src/commands/link.mjs'
import { run as unlink } from '../src/commands/unlink.mjs'
import { UsageError } from '../src/lib/errors.mjs'
import { canTestPermissions, tempDir, writeTree } from './helpers.mjs'
import { chmod } from 'node:fs/promises'

const kitRoot = fileURLToPath(new URL('..', import.meta.url))
const NODE = '/opt/node/bin/node'

/** A home with the three tools' folders, a state folder, and the calls bound to them. */
async function setup(t, { folders = ['.claude', '.codex', '.gemini'], files = {} } = {}) {
  const home = await tempDir(t)
  const state = await tempDir(t)
  for (const folder of folders) await mkdir(join(home, folder), { recursive: true })
  await writeTree(home, files)
  const env = { HOME: home, FE_KIT_STATE_DIR: state, PATH: '/usr/bin' }
  const call = (command, flags = {}, extra = {}) => command({ args: [], flags, cwd: home, env, kitRoot, deps: { node: NODE, ...extra } })
  return { home, state, env, link: (flags, extra) => call(link, flags, extra), unlink: (flags, extra) => call(unlink, flags, extra) }
}

const read = (file) => readFile(file, 'utf8')
const readJson = async (file) => JSON.parse(await read(file))
const exists = (file) => lstat(file).then(() => true, () => false)

/** Every file and link below `dir`, with its content, to compare before and after. */
async function snapshot(dir) {
  const result = {}
  async function walk(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name)
      if (entry.isSymbolicLink()) result[path] = `link:${await readlink(path)}`
      else if (entry.isDirectory()) {
        result[path] = 'dir'
        await walk(path)
      } else result[path] = await read(path)
    }
  }
  await walk(dir)
  return result
}

const SKILLS = (await readdir(join(kitRoot, 'skills'))).sort() // whatever skills the kit has

test('without --yes nothing is changed, and what would be done is said', async (t) => {
  const { home, state, link: run } = await setup(t)
  const before = await snapshot(home)
  const { data, text, exitCode } = await run({})
  assert.equal(exitCode, 0)
  assert.deepEqual(await snapshot(home), before)
  assert.deepEqual(await readdir(state), [])
  assert.equal(data.dryRun, true)
  assert.match(text, /Dry run: nothing was changed\. Run `fe-kit link --yes` to apply\./)
  assert.match(text, /Claude Code/)
  assert.match(text, /~\/\.claude\/settings\.json/)
  assert.ok(!text.includes(home), 'paths are shown with ~')
  assert.equal(data.tools.claude.skills.every((skill) => skill.action === 'create'), true)
})

test('--yes puts the skills and the guard into every tool', async (t) => {
  const { home, state, link: run } = await setup(t)
  const { exitCode, data } = await run({ yes: true })
  assert.equal(exitCode, 0)
  assert.equal(data.dryRun, false)
  for (const dir of ['.claude/skills', '.agents/skills', '.gemini/config/skills']) {
    for (const skill of SKILLS) assert.equal(await readlink(join(home, dir, skill)), join(kitRoot, 'skills', skill), `${dir}/${skill}`)
  }
  const claude = await readJson(join(home, '.claude/settings.json'))
  assert.ok(claude.permissions.ask.includes('Bash(git commit:*)'))
  assert.ok(claude.permissions.deny.includes('Read(~/.config/fe-kit/**)'))
  assert.equal(claude.hooks.PreToolUse.at(-1).hooks[0].command, `${NODE} ${join(kitRoot, 'hooks/shell-guard.mjs')}`)
  assert.match(await read(join(home, '.codex/rules/fe-kit.rules')), /^# Managed by fe-kit/)
  assert.equal((await readJson(join(home, '.codex/hooks.json'))).hooks.PreToolUse[0].matcher, 'Bash')
  assert.equal((await readJson(join(home, '.gemini/config/hooks.json')))['fe-kit'].PreToolUse[0].matcher, 'run_command|view_file')
  assert.ok((await readJson(join(home, '.gemini/antigravity-cli/settings.json'))).permissions.ask.includes('command(git push)'))
  const installed = await readJson(join(state, 'install.json'))
  assert.equal(installed.kitRoot, kitRoot)
  assert.deepEqual(Object.keys(installed.tools).sort(), ['antigravity', 'claude', 'codex'])
  assert.deepEqual(installed.tools.claude.skills.sort(), SKILLS)
  assert.ok(installed.tools.claude.files[0].createdFile)
  assert.ok(!(await exists(join(state, 'install.journal.json'))))
})

test('running it again changes nothing at all', async (t) => {
  const { home, state, link: run } = await setup(t)
  await run({ yes: true })
  const before = { home: await snapshot(home), state: await snapshot(state) }
  const again = await run({ yes: true })
  assert.equal(again.exitCode, 0)
  assert.deepEqual({ home: await snapshot(home), state: await snapshot(state) }, before)
  assert.match(again.text, /Nothing to change\./)
  assert.ok(!(await exists(join(state, 'backups'))))
})

test('what the person already has is kept where it is, backed up, and given back whole by unlink', async (t) => {
  const settings = `${JSON.stringify({ model: 'x', permissions: { allow: ['Bash(ls:*)'], ask: ['Bash(rm:*)'] }, hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'herdr' }] }], PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '/work/fe-kit-custom/check.mjs' }] }] } }, null, 2)}\n`
  const { home, state, link: run, unlink: undo } = await setup(t, { files: { '.claude/settings.json': settings, '.codex/hooks.json': '{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"herdr"}]}]}}\n', '.gemini/config/hooks.json': '{"herdr":{"SessionStart":[]}}\n' } })
  await run({ yes: true })
  const after = await readJson(join(home, '.claude/settings.json'))
  assert.equal(after.model, 'x')
  assert.deepEqual(after.permissions.ask.slice(0, 1), ['Bash(rm:*)'])
  assert.deepEqual(after.hooks.PreToolUse.map((entry) => entry.hooks[0].command).slice(0, 1), ['/work/fe-kit-custom/check.mjs'])
  assert.deepEqual(after.hooks.SessionStart, JSON.parse(settings).hooks.SessionStart)
  assert.deepEqual(Object.keys(await readJson(join(home, '.gemini/config/hooks.json'))), ['herdr', 'fe-kit'])
  const backups = await readdir(join(state, 'backups'))
  assert.equal(backups.length, 3)
  assert.equal(await read(join(state, 'backups', backups.find((name) => name.startsWith('settings.json')))), settings)

  const removed = await undo({ yes: true })
  assert.equal(removed.exitCode, 0)
  assert.equal(await read(join(home, '.claude/settings.json')), settings)
  assert.deepEqual(await readJson(join(home, '.codex/hooks.json')), { hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'herdr' }] }] } })
  assert.deepEqual(await readJson(join(home, '.gemini/config/hooks.json')), { herdr: { SessionStart: [] } })
})

test('unlink removes what link made and leaves nothing behind where it created the file', async (t) => {
  const { home, state, link: run, unlink: undo } = await setup(t)
  const before = await snapshot(home)
  await run({ yes: true })
  const { exitCode } = await undo({ yes: true })
  assert.equal(exitCode, 0)
  const after = await snapshot(home)
  const left = Object.keys(after).filter((path) => !(path in before) && after[path] !== 'dir')
  assert.deepEqual(left, [], 'every file and link fe-kit made is gone (the folders above them stay)')
  assert.ok(!(await exists(join(state, 'install.json'))))
})

test('unlink without --yes only says what it would do', async (t) => {
  const { home, link: run, unlink: undo } = await setup(t)
  await run({ yes: true })
  const before = await snapshot(home)
  const { text, data, exitCode } = await undo({})
  assert.equal(exitCode, 0)
  assert.equal(data.dryRun, true)
  assert.match(text, /Dry run: nothing was changed\. Run `fe-kit unlink --yes` to apply\./)
  assert.deepEqual(await snapshot(home), before)
})

test('unlink when fe-kit installed nothing says so', async (t) => {
  const { unlink: undo } = await setup(t)
  const { text, exitCode } = await undo({ yes: true })
  assert.equal(exitCode, 0)
  assert.match(text, /fe-kit has not installed anything/)
})

test('a file that cannot be read as the tool writes it stops everything, before anything is written', async (t) => {
  const { home, state, link: run } = await setup(t, { files: { '.codex/hooks.json': '{ not json' } })
  const before = await snapshot(home)
  const { exitCode, text, data } = await run({ yes: true })
  assert.equal(exitCode, 1)
  assert.deepEqual(await snapshot(home), before)
  assert.deepEqual(await readdir(state), [])
  assert.match(text, /~\/\.codex\/hooks\.json: not valid JSON/)
  assert.equal(data.problems.length, 1)
})

test('the shapes a file must have, a link, a skill folder that is not ours and a rules file that is not ours are all problems', async (t) => {
  const cases = [
    { files: { '.claude/settings.json': '{"permissions":{"ask":"x"}}' }, expect: /permissions\.ask is not a list/ },
    { files: { '.claude/settings.json': '[]' }, expect: /does not hold a JSON object/ },
    { files: { '.codex/rules/fe-kit.rules': '# mine\n' }, expect: /fe-kit\.rules.*not written by fe-kit/ },
    { files: { '.claude/skills/fe-verify/SKILL.md': 'mine' }, expect: /skills\/fe-verify.*not a link to fe-kit/ },
  ]
  for (const { files, expect } of cases) {
    const { home, link: run } = await setup(t, { files })
    const before = await snapshot(home)
    const { exitCode, text } = await run({ yes: true })
    assert.equal(exitCode, 1, JSON.stringify(files))
    assert.match(text, expect)
    assert.deepEqual(await snapshot(home), before)
  }
  const { home, link: run } = await setup(t)
  await writeFile(join(home, 'real.json'), '{}')
  await symlink(join(home, 'real.json'), join(home, '.claude/settings.json'))
  const result = await run({ yes: true })
  assert.equal(result.exitCode, 1)
  assert.match(result.text, /is a link/)
  assert.equal(await read(join(home, 'real.json')), '{}')
})

test('--tools limits the work to those tools; a tool whose folder is missing is skipped unless it is named', async (t) => {
  const { home, link: run } = await setup(t, { folders: ['.claude'] })
  const first = await run({ yes: true })
  assert.deepEqual(Object.keys(first.data.tools), ['claude'])
  assert.match(first.text, /Codex: skipped/)
  assert.ok(!(await exists(join(home, '.codex'))))
  const second = await run({ yes: true, tools: 'codex' })
  assert.deepEqual(Object.keys(second.data.tools), ['codex'])
  assert.ok(await exists(join(home, '.codex/rules/fe-kit.rules')))
  await assert.rejects(run({ tools: 'vim' }), UsageError)
  await assert.rejects(run({ tools: '' }), UsageError)
})

test('--with is not available yet: the rules wait for the person to read them', async (t) => {
  const { link: run } = await setup(t)
  await assert.rejects(run({ with: 'rules' }), /not available yet/)
  await assert.rejects(run({ with: 'x' }), UsageError)
})

test('the node that runs the hook is the one on the PATH, found by name; none on the PATH is a usage error', async (t) => {
  const { home, env } = await setup(t)
  const bin = await tempDir(t)
  await writeFile(join(bin, 'node'), '#!/bin/sh\n', { mode: 0o755 })
  const withPath = { ...env, PATH: `${bin}:/usr/bin` }
  const result = await link({ args: [], flags: { yes: true }, cwd: home, env: withPath, kitRoot, deps: {} })
  assert.equal(result.exitCode, 0)
  assert.equal((await readJson(join(home, '.claude/settings.json'))).hooks.PreToolUse[0].hooks[0].command, `${join(bin, 'node')} ${join(kitRoot, 'hooks/shell-guard.mjs')}`)
  await assert.rejects(link({ args: [], flags: {}, cwd: home, env: { ...env, PATH: '/nonexistent' }, kitRoot, deps: {} }), /node is not on the PATH/)
})

test('a kit without its hook script cannot be linked', async (t) => {
  const { home, env } = await setup(t)
  const fake = await tempDir(t)
  await mkdir(join(fake, 'skills/fe-verify'), { recursive: true })
  await writeFile(join(fake, 'skills/fe-verify/SKILL.md'), 'x')
  const result = await link({ args: [], flags: { yes: true }, cwd: home, env, kitRoot: fake, deps: { node: NODE } })
  assert.equal(result.exitCode, 1)
  assert.match(result.text, /hooks\/shell-guard\.mjs is missing/)
})

test('two commands at once: the second is told to wait', async (t) => {
  const { state, link: run } = await setup(t)
  let release
  let waiting = false
  const first = run({ yes: true }, { beforeCommit: () => (waiting ? undefined : ((waiting = true), new Promise((resolve) => (release = resolve)))) })
  await new Promise((resolve) => setTimeout(resolve, 300))
  const second = await run({ yes: true })
  assert.equal(second.exitCode, 1)
  assert.match(second.text, /another fe-kit link or unlink is running/)
  release()
  assert.equal((await first).exitCode, 0)
  assert.ok(await exists(join(state, 'install.json')))
})

test('copy mode (as on Windows) makes marked copies, and unlink removes them', async (t) => {
  const { home, link: run, unlink: undo } = await setup(t)
  await run({ yes: true, copy: true })
  const copy = join(home, '.claude/skills/fe-verify')
  assert.equal((await lstat(copy)).isDirectory(), true)
  assert.ok(await exists(join(copy, '.fe-kit-managed')))
  assert.match((await run({ yes: true, copy: true })).text, /Nothing to change\./)
  await undo({ yes: true })
  assert.ok(!(await exists(copy)))
})

test('a file changed by the tool while fe-kit works on it is left as the tool wrote it', async (t) => {
  const { home, state, link: run } = await setup(t, { files: { '.claude/settings.json': '{"model":"x"}\n' } })
  const file = join(home, '.claude/settings.json')
  const result = await run({ yes: true }, { beforeCommit: async (item) => { if (item.file === file) await writeFile(file, '{"model":"y"}\n') } })
  assert.equal(result.exitCode, 1)
  assert.equal(await read(file), '{"model":"y"}\n')
  assert.match(result.text, /changed while fe-kit was working on it/)
  assert.ok(await exists(join(state, 'install.journal.json')), 'what was started is remembered')
  const retry = await run({ yes: true })
  assert.equal(retry.exitCode, 0)
  assert.match(retry.text, /Note: ~\/\.claude\/settings\.json was changed after an earlier fe-kit run stopped/)
  assert.equal((await readJson(file)).model, 'y')
  assert.ok((await readJson(file)).permissions.ask.includes('Bash(git push:*)'))
  assert.ok(!(await exists(join(state, 'install.journal.json'))))
})

test('a run that stops after the files are written and before the record is, is finished by the next run, and unlink then removes everything', async (t) => {
  const settings = '{\n  "model": "x"\n}\n'
  const { home, state, link: run, unlink: undo } = await setup(t, { files: { '.claude/settings.json': settings } })
  const before = await snapshot(home)
  const crashed = await run({ yes: true }, { beforeRecord: () => { throw new Error('disk full') } }).catch((error) => ({ crashed: error.message }))
  assert.equal(crashed.crashed ?? 'completed', 'disk full')
  assert.ok(!(await exists(join(state, 'install.json'))))
  assert.ok(await exists(join(state, 'install.journal.json')))

  const next = await run({ yes: true })
  assert.equal(next.exitCode, 0)
  assert.match(next.text, /finished an interrupted/)
  assert.ok(!(await exists(join(state, 'install.journal.json'))))
  const installed = await readJson(join(state, 'install.json'))
  assert.equal(installed.tools.claude.files[0].createdFile, false, 'the file was the person\'s, so it is not deleted by unlink')
  assert.ok(installed.tools.claude.files[0].added.appends.length > 0, 'what was added is still known')

  await undo({ yes: true })
  const after = await snapshot(home)
  assert.deepEqual(Object.keys(after).filter((path) => !(path in before) && after[path] !== 'dir'), [])
  assert.equal(await read(join(home, '.claude/settings.json')), settings)
})

test('unlink leaves what was changed since, and says so', async (t) => {
  const { home, link: run, unlink: undo } = await setup(t)
  await run({ yes: true })
  const settings = join(home, '.claude/settings.json')
  const edited = await readJson(settings)
  edited.hooks.PreToolUse.at(-1).hooks[0].timeout = 99
  edited.theirs = true
  await writeFile(settings, `${JSON.stringify(edited, null, 2)}\n`)
  await writeFile(join(home, '.codex/rules/fe-kit.rules'), '# Managed by fe-kit (fe-kit link). fe-kit unlink removes this file; edits are overwritten.\nprefix_rule(pattern=["x"], decision="allow")\n')
  const { exitCode, text, data } = await undo({ yes: true })
  assert.equal(exitCode, 1)
  assert.match(text, /left as it is: it was changed/)
  assert.ok(data.kept.length >= 2)
  const after = await readJson(settings)
  assert.equal(after.theirs, true)
  assert.equal(after.hooks.PreToolUse.length, 1)
  assert.ok(await exists(join(home, '.codex/rules/fe-kit.rules')))
  assert.ok(!(await exists(join(home, '.claude/skills/fe-verify'))))
})

test('a skill folder that is a link to somewhere else is not removed by unlink', async (t) => {
  const { home, link: run, unlink: undo } = await setup(t)
  await run({ yes: true })
  const skill = join(home, '.claude/skills/fe-verify')
  await rm(skill)
  await symlink('/tmp', skill)
  await undo({ yes: true })
  assert.equal(await readlink(skill), '/tmp')
})

test('the home folder the commands work in comes from HOME, and the real one is never needed', async (t) => {
  const { home, env } = await setup(t)
  const result = await link({ args: [], flags: {}, cwd: home, env: { ...env }, kitRoot, deps: { node: NODE } })
  assert.equal(result.exitCode, 0)
  assert.ok(!result.text.includes(home))
})

const installedState = async (state) => readJson(join(state, 'install.json'))

test('only folders with a SKILL.md are skills', async (t) => {
  const { home, env } = await setup(t)
  const fake = await tempDir(t)
  await writeTree(fake, { 'skills/real/SKILL.md': 'x', 'skills/not-a-skill/notes.txt': 'x', 'hooks/shell-guard.mjs': '' })
  const result = await link({ args: [], flags: { yes: true, tools: 'claude' }, cwd: home, env, kitRoot: fake, deps: { node: NODE } })
  assert.equal(result.exitCode, 0)
  assert.deepEqual(await readdir(join(home, '.claude/skills')), ['real'])
})

test('a record that cannot be read stops the command and is not overwritten', async (t) => {
  const { home, state, link: run, unlink: undo } = await setup(t)
  await run({ yes: true })
  await rm(join(home, '.codex/rules/fe-kit.rules'))
  await writeFile(join(state, 'install.json'), 'garbage')
  const before = await snapshot(home)
  for (const command of [run, undo]) {
    const result = await command({ yes: true })
    assert.equal(result.exitCode, 1)
    assert.match(result.text, /install\.json cannot be read/)
  }
  assert.deepEqual(await snapshot(home), before)
  assert.equal(await read(join(state, 'install.json')), 'garbage')
})

test('a file that cannot be read for lack of permission is a problem to tell, not a crash', { skip: !canTestPermissions }, async (t) => {
  const { home, link: run } = await setup(t, { files: { '.claude/settings.json': '{}' } })
  await chmod(join(home, '.claude/settings.json'), 0o000)
  const result = await run({ yes: true })
  await chmod(join(home, '.claude/settings.json'), 0o644)
  assert.equal(result.exitCode, 1)
  assert.match(result.text, /settings\.json: cannot be read \(EACCES\)/)
})

test('an older version of the rules file (it has the header) is brought up to date', async (t) => {
  const header = '# Managed by fe-kit (fe-kit link). fe-kit unlink removes this file; edits are overwritten.'
  const { home, link: run } = await setup(t, { files: { '.codex/rules/fe-kit.rules': `${header}\nprefix_rule(pattern=["old"], decision="prompt")\n` } })
  const result = await run({ yes: true })
  assert.equal(result.exitCode, 0)
  assert.match(await read(join(home, '.codex/rules/fe-kit.rules')), /"git", "commit"/)
  assert.ok(!(await read(join(home, '.codex/rules/fe-kit.rules'))).includes('"old"'))
})

test('a file that already has everything is not rewritten, whatever its formatting', async (t) => {
  const { home, link: run } = await setup(t)
  await run({ yes: true })
  const file = join(home, '.claude/settings.json')
  const reformatted = `${JSON.stringify(await readJson(file), null, 4)}\n`
  await writeFile(file, reformatted)
  const result = await run({ yes: true })
  assert.match(result.text, /Nothing to change\./)
  assert.equal(await read(file), reformatted)
})

test('what is recorded survives a later run: the record of an unchanged file, of a file the plan no longer has, and the fact that the file was made by fe-kit', async (t) => {
  const { home, state, link: run, unlink: undo } = await setup(t)
  await run({ yes: true })
  const first = await installedState(state)
  first.tools.claude.files.push({ file: join(home, '.claude/old-file.json'), kind: 'json', createdFile: true, afterHash: 'x', added: { appends: [], sets: [] } })
  await writeFile(join(state, 'install.json'), JSON.stringify(first))
  await rm(join(home, '.codex/rules/fe-kit.rules'))
  const settings = join(home, '.claude/settings.json')
  const edited = await readJson(settings)
  edited.permissions.ask = edited.permissions.ask.slice(1)
  await writeFile(settings, `${JSON.stringify(edited, null, 2)}\n`)
  await run({ yes: true })
  const second = await installedState(state)
  const claude = second.tools.claude.files
  assert.equal(claude.length, 2, 'the record of the file that is not in the plan is kept')
  const record = claude.find((item) => item.file === settings)
  assert.equal(record.createdFile, true)
  const askAdded = record.added.appends.filter((item) => item.path.join('.') === 'permissions.ask').map((item) => item.item)
  assert.equal(new Set(askAdded.map((item) => JSON.stringify(item))).size, askAdded.length, 'nothing is recorded twice')
  assert.ok(second.tools.codex.files.length >= 2)
  await undo({ yes: true })
  assert.ok(!(await exists(settings)), 'the file fe-kit made is deleted when nothing else is in it')
})

test('a file the person made and left empty stays, and a file that is gone is not an error', async (t) => {
  const { home, link: run, unlink: undo } = await setup(t, { files: { '.claude/settings.json': '{}\n', '.codex/hooks.json': '{}\n' } })
  await run({ yes: true })
  await rm(join(home, '.codex/hooks.json'))
  const result = await undo({ yes: true })
  assert.equal(result.exitCode, 0)
  assert.equal(await read(join(home, '.claude/settings.json')), '{}\n')
  assert.ok(!(await exists(join(home, '.codex/hooks.json'))))
})

test('the closing words name what only the person can do', async (t) => {
  const { link: run } = await setup(t)
  const { text, data } = await run({ yes: true })
  assert.match(text, /Codex: open \/hooks in Codex and approve the fe-kit hook/)
  assert.match(text, /Restart the sessions of the tools that are already open/)
  assert.equal(data.checklist.length, 2)
})

test('unlink --tools takes out only those tools', async (t) => {
  const { home, state, link: run, unlink: undo } = await setup(t)
  await run({ yes: true })
  await undo({ yes: true, tools: 'codex' })
  assert.ok(!(await exists(join(home, '.codex/rules/fe-kit.rules'))))
  assert.ok(await exists(join(home, '.claude/settings.json')))
  assert.deepEqual(Object.keys((await installedState(state)).tools).sort(), ['antigravity', 'claude'])
})

test('unlink stops, changing nothing, when a recorded file cannot be read as JSON any more', async (t) => {
  const { home, link: run, unlink: undo } = await setup(t)
  await run({ yes: true })
  await writeFile(join(home, '.claude/settings.json'), '{ broken')
  const before = await snapshot(home)
  const result = await undo({ yes: true })
  assert.equal(result.exitCode, 1)
  assert.match(result.text, /settings\.json: not valid JSON/)
  assert.deepEqual(await snapshot(home), before)
})

test('two unlinks at once, or a link and an unlink: the second is told to wait', async (t) => {
  const { link: run, unlink: undo } = await setup(t)
  await run({ yes: true })
  let release
  let waiting = false
  const first = undo({ yes: true }, { beforeCommit: () => (waiting ? undefined : ((waiting = true), new Promise((resolve) => (release = resolve)))) })
  await new Promise((resolve) => setTimeout(resolve, 300))
  const second = await undo({ yes: true })
  assert.equal(second.exitCode, 1)
  assert.match(second.text, /another fe-kit link or unlink is running/)
  release()
  assert.equal((await first).exitCode, 0)
})

test('an unlink that stops before the record is updated is finished by the next one', async (t) => {
  const { home, state, link: run, unlink: undo } = await setup(t)
  await run({ yes: true })
  const crashed = await undo({ yes: true }, { beforeRecord: () => { throw new Error('disk full') } }).catch((error) => error.message)
  assert.equal(crashed, 'disk full')
  assert.ok(await exists(join(state, 'install.journal.json')))
  assert.ok(await exists(join(state, 'install.json')), 'the record still lists what the files no longer have')
  const next = await undo({ yes: true })
  assert.equal(next.exitCode, 0)
  assert.match(next.text, /finished an interrupted fe-kit unlink/)
  const [, written, total] = /\((\d+) of (\d+) files had been written\)/.exec(next.text)
  assert.ok(Number(written) > 0 && written === total, next.text)
  assert.ok(!(await exists(join(state, 'install.journal.json'))))
  assert.ok(!(await exists(join(state, 'install.json'))))
  assert.ok(!(await exists(join(home, '.claude/settings.json'))))
})

test('a file fe-kit made stays when the person has put something of their own in it', async (t) => {
  const { home, link: run, unlink: undo } = await setup(t)
  await run({ yes: true })
  const file = join(home, '.claude/settings.json')
  const config = await readJson(file)
  config.theirs = true
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`)
  const result = await undo({ yes: true })
  assert.equal(result.exitCode, 0)
  assert.deepEqual(await readJson(file), { theirs: true })
})

test('a config file that is not valid JSON is a problem that does not repeat what the file holds', async (t) => {
  const secret = 'SECRET42'
  const broken = `{"token":${secret}}`
  const { home, link: run, unlink: undo } = await setup(t, { files: { '.claude/settings.json': broken } })

  const planned = await run({})
  const refused = await run({ yes: true })
  assert.equal(refused.exitCode, 1)
  assert.match(refused.text, /settings\.json: not valid JSON/)
  for (const output of [planned, refused]) assert.ok(!output.text.includes(secret) && !JSON.stringify(output.data).includes(secret), 'the text and the data leave the content out')

  await writeFile(join(home, '.claude/settings.json'), '{}\n')
  await run({ yes: true })
  await writeFile(join(home, '.claude/settings.json'), broken)
  const undone = await undo({ yes: true })
  assert.equal(undone.exitCode, 1)
  assert.ok(!undone.text.includes(secret) && !JSON.stringify(undone.data).includes(secret))
})

test('a run that stops after the skills are made and before any file is written: unlink on its own still takes the skills out', async (t) => {
  const { home, state, link: run, unlink: undo } = await setup(t)
  const before = await snapshot(home)
  const crashed = await run({ yes: true }, { beforeCommit: () => { throw new Error('killed') } }).catch((error) => error.message)
  assert.equal(crashed, 'killed')
  const made = Object.keys(await snapshot(home)).filter((path) => !(path in before))
  assert.ok(made.some((path) => path.endsWith(`/${SKILLS[0]}`)), 'the skills were made before the stop')
  assert.ok(await exists(join(state, 'install.journal.json')))

  const undone = await undo({ yes: true })

  assert.equal(undone.exitCode, 0, undone.text)
  assert.match(undone.text, /finished an interrupted/)
  const after = await snapshot(home)
  assert.deepEqual(Object.keys(after).filter((path) => !(path in before) && after[path] !== 'dir'), [], 'nothing of fe-kit is left')
  assert.ok(!(await exists(join(state, 'install.journal.json'))))
})

test('a run that only has skills to make writes its journal first too', async (t) => {
  const { home, state, link: run, unlink: undo } = await setup(t)
  await run({ yes: true })
  const removed = join(home, '.claude/skills', SKILLS[0])
  await rm(removed, { recursive: true, force: true })
  const crashed = await run({ yes: true }, { beforeRecord: () => { throw new Error('killed') } }).catch((error) => error.message)
  assert.equal(crashed, 'killed')
  const journal = await readJson(join(state, 'install.journal.json'))
  assert.deepEqual(journal.skills.map((skill) => [skill.tool, skill.name]), [['claude', SKILLS[0]]])
  assert.ok(await exists(removed), 'the skill was made again before the stop')
  await undo({ yes: true })
  assert.ok(!(await exists(removed)))
})

test('what an interrupted run made is written into the record when the next command finishes it', async (t) => {
  const { state, link: run, unlink: undo } = await setup(t)
  await run({ yes: true }, { beforeCommit: () => { throw new Error('killed') } }).catch(() => {})
  await undo({ yes: true, tools: 'claude' }) // the other tools stay recorded
  const recorded = await readJson(join(state, 'install.json'))
  assert.deepEqual(Object.keys(recorded.tools).sort(), ['antigravity', 'codex'])
  for (const tool of ['codex', 'antigravity']) assert.deepEqual(recorded.tools[tool].skills, SKILLS, tool)
})

test('a switch from links to copies that stops before the record is written is recorded as copies by the run that finishes it', async (t) => {
  const { state, link: run } = await setup(t)
  await run({ yes: true })
  assert.equal((await readJson(join(state, 'install.json'))).tools.claude.mode, 'symlink')
  await run({ yes: true, copy: true }, { beforeRecord: () => { throw new Error('killed') } }).catch(() => {})
  const next = await run({ yes: true, copy: true })
  assert.equal(next.exitCode, 0, next.text)
  for (const tool of ['claude', 'codex', 'antigravity']) assert.equal((await readJson(join(state, 'install.json'))).tools[tool].mode, 'copy', tool)
})

test('the mode of an interrupted switch is recorded only for what the skills really are', async (t) => {
  const modeOf = async (state, tool) => (await readJson(join(state, 'install.json'))).tools[tool].mode
  // stopped before any skill was changed: still links, and a command about other tools must not call them copies
  const first = await setup(t)
  await first.link({ yes: true })
  const crashedEarly = await first.link({ yes: true, copy: true }, { beforeSkill: () => { throw new Error('killed') } }).catch((error) => error.message)
  assert.equal(crashedEarly, 'killed')
  await first.unlink({ yes: true, tools: 'codex' })
  assert.equal(await modeOf(first.state, 'claude'), 'symlink')
  assert.equal(await modeOf(first.state, 'antigravity'), 'symlink')

  // stopped between two skills of one tool: not yet all copies, so the old mode stands until the run is finished
  const second = await setup(t)
  await second.link({ yes: true })
  let seen = 0
  const crashedMid = await second.link({ yes: true, copy: true }, { beforeSkill: (skill) => { if (skill.target.includes('/.claude/') && ++seen === 3) throw new Error('killed') } }).catch((error) => error.message)
  assert.equal(crashedMid, 'killed')
  await second.unlink({ yes: true, tools: 'codex' })
  assert.equal(await modeOf(second.state, 'claude'), 'symlink')
  const finished = await second.link({ yes: true, copy: true })
  assert.equal(finished.exitCode, 0, finished.text)
  for (const tool of ['claude', 'antigravity']) assert.equal(await modeOf(second.state, tool), 'copy', tool)
})
