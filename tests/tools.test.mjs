import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { getTarget, TOOLS } from '../src/lib/tools.mjs'

const TOOL_KEYS = ['agents', 'guard', 'gui', 'hooks', 'invokerOnly', 'label', 'mcp', 'projectDocs', 'rules', 'skillsDir', 'verified']
const VERIFIED_KEYS = ['agents', 'guard', 'hooks', 'invokerOnly', 'mcp', 'projectDocs', 'rules', 'skillsDir']
const STATUSES = ['headless', 'docs', 'pending']

test('all three tools are described with the same set of keys', () => {
  assert.deepEqual(Object.keys(TOOLS).sort(), ['antigravity', 'claude', 'codex'])
  for (const [name, tool] of Object.entries(TOOLS)) {
    assert.deepEqual(Object.keys(tool).sort(), TOOL_KEYS, name)
    assert.deepEqual(Object.keys(tool.verified).sort(), VERIFIED_KEYS, name)
  }
})

test('every verified entry has a known status, and a headless one names the version it ran on', () => {
  for (const [name, tool] of Object.entries(TOOLS)) {
    for (const [key, entry] of Object.entries(tool.verified)) {
      assert.ok(STATUSES.includes(entry.status), `${name}.${key}: ${entry.status}`)
      if (entry.status === 'headless') assert.ok(entry.version, `${name}.${key} needs a version`)
    }
  }
})

test('skill directories match what the spike measured', () => {
  assert.equal(TOOLS.claude.skillsDir, '~/.claude/skills')
  assert.equal(TOOLS.codex.skillsDir, '~/.agents/skills')
  assert.equal(TOOLS.antigravity.skillsDir, '~/.gemini/config/skills', 'agy does not read antigravity-cli/skills')
})

test('hook behaviour matches the spike: Claude and Codex fail open, Codex cannot ask, agy fails closed', () => {
  assert.equal(TOOLS.claude.hooks.onError, 'allow')
  assert.equal(TOOLS.codex.hooks.onError, 'allow')
  assert.equal(TOOLS.antigravity.hooks.onError, 'deny')
  assert.equal(TOOLS.codex.hooks.canAsk, false)
  assert.equal(TOOLS.claude.hooks.canAsk, true)
  assert.equal(TOOLS.antigravity.hooks.askDecision, 'force_ask')
})

test('Codex and Antigravity do not read CLAUDE.md, so they need the AGENTS.md link', () => {
  assert.equal(TOOLS.claude.projectDocs.needsAgentsLink, false)
  assert.equal(TOOLS.codex.projectDocs.needsAgentsLink, true)
  assert.equal(TOOLS.antigravity.projectDocs.needsAgentsLink, true)
})

test('Antigravity has no way to make a skill user-invoked only', () => {
  assert.equal(TOOLS.antigravity.invokerOnly, 'none')
  assert.equal(TOOLS.claude.invokerOnly, 'frontmatter')
  assert.equal(TOOLS.codex.invokerOnly, 'openai-yaml')
})

test('no path is machine specific', () => {
  const text = JSON.stringify(TOOLS)
  assert.doesNotMatch(text, /Cellar|\/Users\//)
})

test('getTarget returns a tool and rejects an unknown one', () => {
  assert.equal(getTarget('codex'), TOOLS.codex)
  assert.throws(() => getTarget('vim'), /unknown tool: vim/)
})

test('no GUI surface counts as checked until someone has checked it by hand', () => {
  for (const [name, tool] of Object.entries(TOOLS)) assert.equal(tool.gui.status, 'pending', name)
})

test('every docs cell names a source that docs/spike.md lists', async () => {
  const spike = await readFile(new URL('../docs/spike.md', import.meta.url), 'utf8')
  for (const [name, tool] of Object.entries(TOOLS)) {
    for (const [key, entry] of Object.entries(tool.verified)) {
      if (entry.status !== 'docs') continue
      assert.ok(entry.source, `${name}.${key} needs a source`)
      assert.ok(spike.includes(`\`${entry.source}\``), `${name}.${key}: ${entry.source} is not listed in docs/spike.md`)
    }
  }
})
