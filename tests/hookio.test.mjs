import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { answerFor, decideRequest, detectTool, requestOf } from '../src/lib/hookio.mjs'
import { codexRulePrefixes, isCoveredByRules } from '../src/lib/guard-rules.mjs'
import { decideCommand } from '../src/lib/shell-policy.mjs'
import { tempDir, writeTree } from './helpers.mjs'

const fixtures = fileURLToPath(new URL('./fixtures/hooks/', import.meta.url))
const fixture = async (tool, name) => JSON.parse(await readFile(join(fixtures, tool, `${name}.json`), 'utf8'))
const kitRoot = fileURLToPath(new URL('..', import.meta.url))

test('the tool is told from the shape of what it sends', async () => {
  assert.equal(detectTool(await fixture('claude', 'Bash')), 'claude')
  assert.equal(detectTool(await fixture('claude', 'Read')), 'claude')
  assert.equal(detectTool(await fixture('codex', 'Bash')), 'codex')
  assert.equal(detectTool(await fixture('codex', 'apply_patch')), 'codex')
  assert.equal(detectTool(await fixture('agy', 'run_command')), 'agy')
  assert.equal(detectTool(await fixture('agy', 'view_file')), 'agy')
  for (const unknown of [null, undefined, 'text', 42, [], {}, { tool_name: 'Bash' }, { hook_event_name: 'PreToolUse' }, { toolCall: {} }, { toolCall: { name: 5 } }, { turn_id: 1, tool_name: 'Bash' }, { hook_event_name: 'PreToolUse', tool_name: 'Bash', turn_id: 5 }]) {
    assert.equal(detectTool(unknown), null, JSON.stringify(unknown))
  }
})

test('what a tool is about to do is read from the fields that tool uses', async () => {
  const claudeBash = await fixture('claude', 'Bash')
  assert.deepEqual(requestOf(claudeBash, 'claude'), { shell: { command: 'echo hello-fixture', cwd: claudeBash.cwd } })
  const claudeRead = await fixture('claude', 'Read')
  assert.deepEqual(requestOf(claudeRead, 'claude').paths.map((entry) => [entry.path.endsWith('package.json'), entry.search]), [[true, false]])
  assert.equal(requestOf(claudeRead, 'claude').cwd, claudeRead.cwd)
  assert.deepEqual(requestOf({ ...claudeBash, tool_name: 'Grep', tool_input: { pattern: 'x', path: '/a/b' } }, 'claude'), { paths: [{ path: '/a/b', search: true }], cwd: claudeBash.cwd })
  assert.deepEqual(requestOf({ ...claudeBash, tool_name: 'Grep', tool_input: { pattern: 'x' } }, 'claude').paths, [{ path: claudeBash.cwd, search: true }])
  assert.deepEqual(requestOf({ ...claudeBash, tool_name: 'Glob', tool_input: { pattern: '~/.config/**', path: '/a' } }, 'claude').paths, [{ path: '/a', search: true }, { path: '~/.config/**', search: true }])
  assert.deepEqual(requestOf(await fixture('claude', 'Write'), 'claude'), {})

  const codexBash = await fixture('codex', 'Bash')
  assert.deepEqual(requestOf(codexBash, 'codex'), { shell: { command: 'echo hello-fixture', cwd: codexBash.cwd } })
  assert.deepEqual(requestOf(await fixture('codex', 'apply_patch'), 'codex'), {})

  const agyRun = await fixture('agy', 'run_command')
  assert.deepEqual(requestOf(agyRun, 'agy'), { shell: { command: 'echo hello-fixture', cwd: agyRun.toolCall.args.Cwd } })
  const agyView = await fixture('agy', 'view_file')
  assert.deepEqual(requestOf(agyView, 'agy'), { paths: [{ path: agyView.toolCall.args.AbsolutePath, search: false }], cwd: agyView.workspacePaths[0] })
  assert.deepEqual(requestOf(await fixture('agy', 'write_to_file'), 'agy'), {})
})

test('a tool call whose fields are not what that tool sends is an error, not an allow', async () => {
  const claudeBash = await fixture('claude', 'Bash')
  assert.throws(() => requestOf({ ...claudeBash, tool_input: { command: 5 } }, 'claude'), /command/)
  assert.throws(() => requestOf({ ...claudeBash, tool_input: null }, 'claude'), /tool_input/)
  assert.throws(() => requestOf({ ...claudeBash, cwd: 7 }, 'claude'), /cwd/)
  const claudeRead = await fixture('claude', 'Read')
  assert.throws(() => requestOf({ ...claudeRead, tool_input: {} }, 'claude'), /file_path/)
  const agyRun = await fixture('agy', 'run_command')
  assert.throws(() => requestOf({ ...agyRun, toolCall: { name: 'run_command', args: {} } }, 'agy'), /CommandLine/)
  assert.throws(() => requestOf({ ...agyRun, toolCall: { name: 'view_file', args: {} } }, 'agy'), /AbsolutePath/)
})

test('an answer has the shape its tool understands', () => {
  const reason = 'git push needs your approval'
  assert.deepEqual(answerFor('claude', { decision: 'allow', reason }), { exitCode: 0, stdout: '' })
  assert.deepEqual(answerFor('codex', { decision: 'allow', reason }), { exitCode: 0, stdout: '' })
  assert.deepEqual(answerFor('agy', { decision: 'allow', reason }), { exitCode: 0, stdout: '' })

  const claudeAsk = JSON.parse(answerFor('claude', { decision: 'ask', reason }).stdout)
  assert.deepEqual(claudeAsk, { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: reason } })
  const claudeDeny = JSON.parse(answerFor('claude', { decision: 'deny', reason }).stdout)
  assert.equal(claudeDeny.hookSpecificOutput.permissionDecision, 'deny')

  assert.deepEqual(JSON.parse(answerFor('agy', { decision: 'ask', reason }).stdout), { decision: 'force_ask', reason })
  assert.deepEqual(JSON.parse(answerFor('agy', { decision: 'deny', reason }).stdout), { decision: 'deny', reason })
  assert.deepEqual(JSON.parse(answerFor('codex', { decision: 'deny', reason }).stdout).hookSpecificOutput.permissionDecision, 'deny')
  for (const answer of [answerFor('claude', { decision: 'deny', reason }), answerFor('codex', { decision: 'ask', reason }), answerFor('agy', { decision: 'ask', reason })]) assert.equal(answer.exitCode, 0)
})

test('the Codex answer never asks: a hook that asks lets the command run', () => {
  const reason = 'x'
  for (const decision of ['allow', 'ask', 'deny']) assert.ok(!answerFor('codex', { decision, reason }).stdout.includes('"ask"'))
  assert.equal(JSON.parse(answerFor('codex', { decision: 'ask', reason: 'git push needs your approval' }).stdout).hookSpecificOutput.permissionDecision, 'deny')
  assert.match(JSON.parse(answerFor('codex', { decision: 'ask', reason: 'git push needs your approval' }).stdout).hookSpecificOutput.permissionDecisionReason, /run it yourself/)
  assert.deepEqual(answerFor('codex', { decision: 'ask', reason, covered: true }), { exitCode: 0, stdout: '' }) // the rules file asks
})

test('a decision for an unknown tool or decision is refused', () => {
  assert.throws(() => answerFor('vim', { decision: 'deny', reason: 'x' }), /tool/)
  assert.throws(() => answerFor('claude', { decision: 'maybe', reason: 'x' }), /decision/)
})

test('the rules Codex is given cover the plain forms, and only those', () => {
  const prefixes = codexRulePrefixes(kitRoot)
  assert.ok(prefixes.length >= 12)
  for (const argv of [
    ['git', 'commit', '-m', 'x'], ['git', 'push'], ['git', 'push', 'origin', 'main'], ['git', 'reset', '--hard', 'HEAD~1'], ['git', 'clean', '-fd'], ['git', 'clean', '--force'],
    ['fe-kit', 'ui-act', '--target', 'x'], ['fe-kit', 'link'], ['fe-kit', 'unlink'], ['fe-kit', 'mr', 'post', '3'], ['fe-kit', 'mr', 'publish', '3'],
    ['node', join(kitRoot, 'bin/fe-kit.mjs'), 'link', '--yes'], ['node', join(kitRoot, 'bin/fe-kit.mjs'), 'ui-act'], ['npx', 'fe-kit', 'link'],
  ]) assert.equal(isCoveredByRules(argv, prefixes), true, argv.join(' '))
  for (const argv of [
    ['git', '-C', 'x', 'push'], ['git', '-c', 'k=v', 'commit'], ['/usr/bin/git', 'push'], ['env', 'git', 'push'], ['git', 'reset', 'HEAD~1', '--hard'], ['git', 'clean', '-xdf'],
    ['fe-kit', '--json', 'link'], ['node', '/other/fe-kit.mjs', 'link'], ['fe-kit', 'mr', '--json', 'post'], ['git'], [], ['git', 'status'],
  ]) assert.equal(isCoveredByRules(argv, prefixes), false, argv.join(' '))
})

test('the policy reports the argv of a plain single command, and nothing for anything else', async (t) => {
  const home = await tempDir(t)
  await writeTree(home, { 'p/a': 'x' })
  const context = { cwd: join(home, 'p'), home, env: { HOME: home } }
  assert.deepEqual(decideCommand('git push origin main', context).argv, ['git', 'push', 'origin', 'main'])
  assert.deepEqual(decideCommand("git commit -m 'a b'", context).argv, ['git', 'commit', '-m', 'a b'])
  assert.deepEqual(decideCommand('bash -c "git push"', context).argv, ['bash', '-c', 'git push']) // what Codex sees; no rule starts like that
  for (const line of ['git push && ls', 'X=1 git push', 'git push > out', 'git push $(echo)', '(git push)', 'echo x | git push', 'git push; git commit', 'git push <<EOF\nx\nEOF\n', 'git push &']) {
    assert.equal(decideCommand(line, context).argv, null, line)
  }
})

test('the decision for a request says whether Codex\'s rules file asks about it', async (t) => {
  const home = await tempDir(t)
  await writeTree(home, { '.local/state/fe-kit/auth/p/t.json': '{}', 'project/a.txt': 'a' })
  const context = { kitRoot, env: { HOME: home }, home }
  const shell = (command) => ({ shell: { command, cwd: join(home, 'project') } })
  assert.deepEqual(decideRequest('codex', shell('git push'), context), { decision: 'ask', reason: 'git push needs your approval', covered: true })
  assert.equal(decideRequest('codex', shell('git -C x push'), context).covered, false)
  assert.equal(decideRequest('claude', shell('git push'), context).covered, false)
  assert.equal(decideRequest('codex', shell('ls'), context).covered, false)
  assert.equal(decideRequest('codex', shell('cat ~/.config/fe-kit/env'), context).covered, false)
  assert.deepEqual(decideRequest('codex', shell('git push ~/.config/fe-kit/env'), context).covered, false) // refused, not left to the rules file
  assert.equal(decideRequest('codex', shell('git push ~/.config/fe-kit/env'), context).decision, 'deny')
})

test('a file request is judged from the folder the tool works in', async (t) => {
  const home = await tempDir(t)
  await writeTree(home, { '.local/state/fe-kit/auth/p/t.json': '{}', 'project/a.txt': 'a' })
  const context = { kitRoot, env: { HOME: home }, home }
  const auth = join(home, '.local/state/fe-kit/auth')
  assert.equal(decideRequest('claude', { paths: [{ path: 'p/t.json', search: false }], cwd: auth }, context).decision, 'deny')
  assert.equal(decideRequest('claude', { paths: [{ path: 'a.txt', search: false }], cwd: join(home, 'project') }, context).decision, 'allow')
  assert.equal(decideRequest('claude', { paths: [{ path: home, search: true }], cwd: join(home, 'project') }, context).decision, 'deny')
  assert.equal(decideRequest('claude', { paths: [{ path: home, search: false }], cwd: join(home, 'project') }, context).decision, 'allow')
  assert.equal(decideRequest('claude', {}, context).decision, 'allow')
})
