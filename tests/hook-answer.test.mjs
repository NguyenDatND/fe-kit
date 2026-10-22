import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { answerAccepted } from '../src/lib/hook-answer.mjs'
import { answerFor } from '../src/lib/hookio.mjs'

const fixtures = fileURLToPath(new URL('./fixtures/hooks/', import.meta.url))
const fixtureText = (tool, name) => readFile(join(fixtures, tool, `${name}.json`), 'utf8')
const claudeStyle = (decision) => JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision, permissionDecisionReason: 'why' } })

test('silence is accepted for every tool', async () => {
  for (const [tool, name] of [['claude', 'Bash'], ['codex', 'Bash'], ['agy', 'run_command']]) assert.equal(answerAccepted(await fixtureText(tool, name), ''), true, tool)
})

test('what each tool understands is accepted, and only that', async () => {
  const claude = await fixtureText('claude', 'Bash')
  const codex = await fixtureText('codex', 'Bash')
  const agy = await fixtureText('agy', 'run_command')
  assert.equal(answerAccepted(claude, claudeStyle('ask')), true)
  assert.equal(answerAccepted(claude, claudeStyle('deny')), true)
  assert.equal(answerAccepted(codex, claudeStyle('deny')), true)
  assert.equal(answerAccepted(agy, JSON.stringify({ decision: 'force_ask', reason: 'why' })), true)
  assert.equal(answerAccepted(agy, JSON.stringify({ decision: 'deny', reason: 'why' })), true)

  assert.equal(answerAccepted(codex, claudeStyle('ask')), false, 'a hook that asks lets the command run on Codex')
  assert.equal(answerAccepted(codex, claudeStyle('allow')), false)
  assert.equal(answerAccepted(claude, claudeStyle('allow')), false)
  assert.equal(answerAccepted(claude, JSON.stringify({ decision: 'deny', reason: 'why' })), false, 'the answer of another tool')
  assert.equal(answerAccepted(agy, claudeStyle('deny')), false, 'the answer of another tool')
  assert.equal(answerAccepted(agy, JSON.stringify({ decision: 'ask', reason: 'why' })), false)
  assert.equal(answerAccepted(agy, JSON.stringify({ decision: 'force_ask' })), false, 'no reason')
  assert.equal(answerAccepted(claude, JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny' } })), false, 'no reason')
  assert.equal(answerAccepted(claude, JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', permissionDecision: 'deny', permissionDecisionReason: 'x' } })), false)
})

test('text that is not an answer is refused', async () => {
  const claude = await fixtureText('claude', 'Bash')
  for (const stdout of ['not json', '{', '{}', '[]', 'null', '"deny"', '5', ' ', '\n', '{"hookSpecificOutput":null}', '{"hookSpecificOutput":[]}']) assert.equal(answerAccepted(claude, stdout), false, stdout)
})

test('an input that is not the call of a known tool accepts nothing, not even silence', () => {
  for (const input of ['', 'not json', '{}', '[]', 'null', '{"tool_name":"Bash"}']) {
    assert.equal(answerAccepted(input, ''), false, input)
    assert.equal(answerAccepted(input, claudeStyle('deny')), false, input)
  }
})

test('every answer the guard gives is one it accepts', async () => {
  for (const [tool, name] of [['claude', 'Bash'], ['codex', 'Bash'], ['agy', 'run_command']]) {
    for (const decision of ['allow', 'ask', 'deny']) {
      for (const covered of [false, true]) {
        const { exitCode, stdout } = answerFor(tool, { decision, reason: 'why', covered })
        assert.equal(exitCode, 0)
        assert.equal(answerAccepted(await fixtureText(tool, name), stdout), true, `${tool} ${decision} ${covered}: ${stdout}`)
      }
    }
  }
})
