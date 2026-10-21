import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { tempDir, writeTree } from './helpers.mjs'

const kitRoot = fileURLToPath(new URL('..', import.meta.url))
const entry = join(kitRoot, 'hooks/shell-guard.mjs')
const fixture = async (tool, name) => JSON.parse(await readFile(join(kitRoot, 'tests/fixtures/hooks', tool, `${name}.json`), 'utf8'))

/** Runs the hook as the tools do: a process that gets the call on stdin. `close: false` leaves stdin open. */
function runHook(stdin, { home, close = true } = {}) {
  return new Promise((resolve) => {
    const began = performance.now()
    const child = spawn(process.execPath, [entry], { env: { ...process.env, HOME: home }, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.stdin.on('error', () => {})
    if (stdin !== null) child.stdin.write(stdin)
    if (close) child.stdin.end()
    child.on('close', (exitCode) => resolve({ exitCode, stdout, stderr, ms: performance.now() - began }))
  })
}

async function setup(t) {
  const home = await tempDir(t)
  await writeTree(home, { '.config/fe-kit/env': 'TOKEN=x\n', 'project/a.txt': 'a\n' })
  const cwd = join(home, 'project')
  const claude = async (command) => ({ ...(await fixture('claude', 'Bash')), cwd, tool_input: { command } })
  const codex = async (command) => ({ ...(await fixture('codex', 'Bash')), cwd, tool_input: { command } })
  const agy = async (command) => {
    const base = await fixture('agy', 'run_command')
    return { ...base, toolCall: { ...base.toolCall, args: { ...base.toolCall.args, CommandLine: command, Cwd: cwd } } }
  }
  return { home, cwd, claude, codex, agy }
}

const send = (home, call) => runHook(JSON.stringify(call), { home })

test('a harmless command passes in silence on every tool', async (t) => {
  const { home, claude, codex, agy } = await setup(t)
  for (const call of [await claude('echo hello'), await codex('ls -la'), await agy('git status')]) {
    const result = await send(home, call)
    assert.deepEqual([result.exitCode, result.stdout, result.stderr], [0, '', ''])
  }
})

test('a commit is asked about on Claude and Antigravity, with the answer each of them understands', async (t) => {
  const { home, claude, agy } = await setup(t)
  const onClaude = await send(home, await claude('git commit -m x'))
  assert.equal(onClaude.exitCode, 0)
  assert.deepEqual(JSON.parse(onClaude.stdout).hookSpecificOutput, { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: 'git commit needs your approval' })
  const onAgy = await send(home, await agy('git push origin main'))
  assert.deepEqual(JSON.parse(onAgy.stdout), { decision: 'force_ask', reason: 'git push needs your approval' })
})

test('on Codex the rules file asks about the plain forms, and the hook refuses the others', async (t) => {
  const { home, codex } = await setup(t)
  const plain = await send(home, await codex('git push origin main'))
  assert.deepEqual([plain.exitCode, plain.stdout], [0, ''])
  for (const command of ['git -C x push', 'bash -c "git push"', 'git push && git commit -m x', 'env git push', 'fe-kit link && ls']) {
    const refused = await send(home, await codex(command))
    assert.equal(JSON.parse(refused.stdout).hookSpecificOutput.permissionDecision, 'deny', command)
    assert.match(JSON.parse(refused.stdout).hookSpecificOutput.permissionDecisionReason, /run it yourself/)
  }
})

test('reading the folders of secrets is refused on every tool, by shell and by file', async (t) => {
  const { home, claude, codex, agy } = await setup(t)
  const refused = [
    await send(home, await claude('cat ~/.config/fe-kit/env')),
    await send(home, await codex('cat "$HOME/.config/fe-kit/env"')),
    await send(home, await agy(`cat ${home}/.config/fe-kit/env`)),
    await send(home, { ...(await fixture('claude', 'Read')), cwd: home, tool_input: { file_path: `${home}/.config/fe-kit/env` } }),
    await send(home, { ...(await fixture('claude', 'Read')), tool_name: 'Grep', cwd: home, tool_input: { pattern: 'x', path: home } }),
  ]
  const viewFile = await fixture('agy', 'view_file')
  refused.push(await send(home, { ...viewFile, toolCall: { ...viewFile.toolCall, args: { AbsolutePath: `${home}/.config/fe-kit/env` } } }))
  for (const result of refused) {
    assert.equal(result.exitCode, 0)
    assert.match(result.stdout, /deny/)
    assert.match(result.stdout, /saved logins and secrets/)
  }
  const fine = await send(home, { ...(await fixture('claude', 'Read')), cwd: home, tool_input: { file_path: `${home}/project/a.txt` } })
  assert.deepEqual([fine.exitCode, fine.stdout], [0, ''])
})

test('a call the guard cannot read is blocked with exit 2 on every kind of damage', async (t) => {
  const { home, claude } = await setup(t)
  const call = await claude('echo x')
  const damaged = [
    '', '   ', 'not json', '{', '[]', 'null', '42', '{}', JSON.stringify({ tool_name: 'Bash' }), JSON.stringify({ ...call, tool_input: { command: 5 } }), JSON.stringify({ ...call, tool_input: null }),
    JSON.stringify({ ...call, cwd: 7 }), JSON.stringify({ toolCall: { name: 'run_command', args: {} } }), JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', turn_id: 5, tool_input: {} }),
  ]
  for (const text of damaged) {
    const result = await runHook(text, { home })
    assert.equal(result.exitCode, 2, JSON.stringify(text))
    assert.equal(result.stdout, '')
    assert.match(result.stderr, /^fe-kit shell-guard: blocked/)
  }
})

test('an input over the limit is blocked', async (t) => {
  const { home, claude } = await setup(t)
  const result = await runHook(JSON.stringify(await claude(`echo ${'x'.repeat(2 * 1024 * 1024)}`)), { home })
  assert.equal(result.exitCode, 2)
  assert.match(result.stderr, /too large/)
})

test('a call that is never finished is blocked before the host gives up', async (t) => {
  const { home } = await setup(t)
  const result = await runHook('{"tool_name":', { home, close: false })
  assert.equal(result.exitCode, 2)
  assert.match(result.stderr, /did not answer in time/)
  assert.ok(result.ms < 9000, `${result.ms}ms`)
})
