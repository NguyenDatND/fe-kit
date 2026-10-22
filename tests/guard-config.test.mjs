import assert from 'node:assert/strict'
import { test } from 'node:test'
import { codexRulePrefixes } from '../src/lib/guard-rules.mjs'
import { ConfigProblem, OWNED_HEADER, applyEntries, codexRulesText, guardPlan, parseJsonConfig, removeEntries, serializeJsonConfig } from '../src/lib/guard-config.mjs'

const hook = (command) => ({ matcher: 'Bash', hooks: [{ type: 'command', command, timeout: 10 }] })
const entries = (...appends) => ({ appends, sets: [] })
const append = (path, item) => ({ path, item })

test('what is added goes to the end, and what the user has stays where it was', () => {
  const config = {
    model: 'x',
    hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'herdr' }] }], PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'theirs' }] }] },
    permissions: { allow: ['Bash(ls:*)'], ask: ['Bash(rm:*)'] },
  }
  const { next, added } = applyEntries(config, entries(append(['permissions', 'ask'], 'Bash(git push:*)'), append(['hooks', 'PreToolUse'], hook('ours')), append(['permissions', 'deny'], 'Read(~/x/**)')))
  assert.deepEqual(next.permissions.ask, ['Bash(rm:*)', 'Bash(git push:*)'])
  assert.deepEqual(next.permissions.deny, ['Read(~/x/**)'])
  assert.deepEqual(next.hooks.PreToolUse.map((entry) => entry.hooks[0].command), ['theirs', 'ours'])
  assert.deepEqual(next.hooks.SessionStart, config.hooks.SessionStart)
  assert.deepEqual(Object.keys(next), ['model', 'hooks', 'permissions'])
  assert.deepEqual(Object.keys(next.permissions), ['allow', 'ask', 'deny'])
  assert.equal(added.appends.length, 3)
  assert.equal(config.permissions.ask.length, 1, 'the input is not changed')
})

test('a file that does not exist yet, or is empty, starts from nothing', () => {
  const { next } = applyEntries(null, entries(append(['hooks', 'PreToolUse'], hook('ours'))))
  assert.deepEqual(next, { hooks: { PreToolUse: [hook('ours')] } })
  assert.deepEqual(parseJsonConfig(''), {})
  assert.deepEqual(parseJsonConfig('  \n'), {})
})

test('running it again changes nothing and adds nothing', () => {
  const wanted = entries(append(['permissions', 'ask'], 'Bash(git push:*)'), append(['hooks', 'PreToolUse'], hook('ours')))
  const once = applyEntries({}, wanted)
  const twice = applyEntries(once.next, wanted)
  assert.deepEqual(twice.next, once.next)
  assert.deepEqual(twice.added, { appends: [], sets: [] })
})

test('an item the user already has, identical, is theirs: it is not recorded as added and unlink leaves it', () => {
  const config = { permissions: { ask: ['Bash(git push:*)'] }, hooks: { PreToolUse: [hook('ours')] } }
  const wanted = entries(append(['permissions', 'ask'], 'Bash(git push:*)'), append(['permissions', 'ask'], 'Bash(git commit:*)'), append(['hooks', 'PreToolUse'], hook('ours')))
  const { next, added } = applyEntries(config, wanted)
  assert.deepEqual(added.appends, [append(['permissions', 'ask'], 'Bash(git commit:*)')])
  const { next: restored } = removeEntries(next, added)
  assert.deepEqual(restored, config)
})

test('a hook that only has fe-kit in its path is not ours, and an entry with the same command but another matcher is a different entry', () => {
  const theirs = { matcher: 'Bash', hooks: [{ type: 'command', command: '/work/fe-kit-custom/check.mjs', timeout: 5 }] }
  const config = { hooks: { PreToolUse: [theirs, { matcher: 'Read', hooks: [{ type: 'command', command: 'ours', timeout: 10 }] }] } }
  const { next, added } = applyEntries(config, entries(append(['hooks', 'PreToolUse'], hook('ours'))))
  assert.equal(next.hooks.PreToolUse.length, 3)
  const { next: restored } = removeEntries(next, added)
  assert.deepEqual(restored, config)
})

test('a file that does not have the shape the tool uses is a problem, and nothing is changed', () => {
  const wanted = entries(append(['permissions', 'ask'], 'x'), append(['hooks', 'PreToolUse'], hook('ours')))
  for (const config of [[], { permissions: [] }, { permissions: { ask: 'x' } }, { permissions: 'x' }, { hooks: [] }, { hooks: { PreToolUse: {} } }, { hooks: 'x' }]) {
    assert.throws(() => applyEntries(config, wanted), ConfigProblem, JSON.stringify(config))
  }
  assert.throws(() => applyEntries('text', wanted), ConfigProblem)
  assert.throws(() => applyEntries(5, wanted), ConfigProblem)
  assert.match((() => { try { applyEntries({ permissions: { ask: 'x' } }, wanted) } catch (error) { return error.message } })(), /permissions\.ask/)
})

test('a text that is not an object of JSON cannot be read as a config', () => {
  for (const text of ['{', 'not json', '[]', '"x"', '5', 'null', '{"a":1,}', '// comment\n{}']) assert.throws(() => parseJsonConfig(text), ConfigProblem, text)
  assert.deepEqual(parseJsonConfig('{"a": [1, 2]}'), { a: [1, 2] })
})

test('a key the kit owns is set when absent, left when identical, and a conflict when something else is there', () => {
  const wanted = { appends: [], sets: [{ path: ['fe-kit'], value: { PreToolUse: [hook('ours')] } }] }
  const first = applyEntries({ herdr: { SessionStart: [] } }, wanted)
  assert.deepEqual(Object.keys(first.next), ['herdr', 'fe-kit'])
  assert.deepEqual(first.added.sets, wanted.sets)
  assert.deepEqual(applyEntries(first.next, wanted).added, { appends: [], sets: [] })
  assert.throws(() => applyEntries({ 'fe-kit': { other: true } }, wanted), /already has a different value/)
})

test('unlink takes out what was added, keeps what was changed since, and says so', () => {
  const wanted = entries(append(['permissions', 'ask'], 'Bash(git push:*)'), append(['hooks', 'PreToolUse'], hook('ours')), append(['permissions', 'deny'], 'Read(~/x/**)'))
  const { next, added } = applyEntries({ permissions: { ask: ['Bash(rm:*)'] } }, wanted)
  const edited = structuredClone(next)
  edited.hooks.PreToolUse[0].hooks[0].timeout = 99 // the user changed it
  const removed = removeEntries(edited, added)
  assert.deepEqual(removed.next.permissions, { ask: ['Bash(rm:*)'] })
  assert.deepEqual(removed.next.hooks.PreToolUse, edited.hooks.PreToolUse)
  assert.deepEqual(removed.kept.map((item) => item.path.join('.')), ['hooks.PreToolUse'])
  assert.match(removed.kept[0].reason, /changed/)
})

test('unlink prunes the containers it emptied, and only those', () => {
  const wanted = entries(append(['permissions', 'ask'], 'a'), append(['hooks', 'PreToolUse'], hook('ours')))
  const { next, added } = applyEntries({ model: 'x', permissions: { allow: ['y'] } }, wanted)
  assert.deepEqual(removeEntries(next, added).next, { model: 'x', permissions: { allow: ['y'] } })
  const fresh = applyEntries({}, wanted)
  assert.deepEqual(removeEntries(fresh.next, fresh.added).next, {})
  const mine = { appends: [], sets: [{ path: ['fe-kit'], value: { PreToolUse: [] } }] }
  const set = applyEntries({ herdr: {} }, mine)
  assert.deepEqual(removeEntries(set.next, set.added).next, { herdr: {} })
  const changed = structuredClone(set.next)
  changed['fe-kit'].PreToolUse.push(1)
  assert.equal(removeEntries(changed, set.added).kept.length, 1)
})

test('what is written back keeps the file\'s indentation and ends with a newline', () => {
  assert.equal(serializeJsonConfig({ a: 1 }, '{\n    "b": 2\n}\n'), '{\n    "a": 1\n}\n')
  assert.equal(serializeJsonConfig({ a: 1 }, '{\n\t"b": 2\n}'), '{\n\t"a": 1\n}\n')
  assert.equal(serializeJsonConfig({ a: [1] }, ''), '{\n  "a": [\n    1\n  ]\n}\n')
  assert.equal(serializeJsonConfig({ a: 1 }, '{"b":2}'), '{\n  "a": 1\n}\n')
})

const context = (extra = {}) => ({ home: '/h', kitRoot: '/kit', node: '/opt/node/bin/node', env: { HOME: '/h' }, ...extra })
const hookCommand = '/opt/node/bin/node /kit/hooks/shell-guard.mjs'

test('the plan for Claude: ask rules for every form, deny rules for the stores, one hook', () => {
  const [plan, ...others] = guardPlan({ tool: 'claude', ...context() })
  assert.equal(others.length, 0)
  assert.deepEqual([plan.file, plan.kind], ['/h/.claude/settings.json', 'json'])
  const at = (path) => plan.entries.appends.filter((entry) => entry.path.join('.') === path).map((entry) => entry.item)
  const ask = at('permissions.ask')
  for (const rule of ['Bash(git commit:*)', 'Bash(git push:*)', 'Bash(git reset --hard:*)', 'Bash(fe-kit link:*)', 'Bash(fe-kit ui-act:*)', 'Bash(fe-kit mr post:*)', 'Bash(node /kit/bin/fe-kit.mjs unlink:*)', 'Bash(npx fe-kit link:*)']) assert.ok(ask.includes(rule), rule)
  assert.deepEqual(at('permissions.deny'), ['Read(~/.config/fe-kit/**)', 'Read(~/.local/state/fe-kit/auth/**)'])
  assert.deepEqual(at('hooks.PreToolUse'), [{ matcher: 'Bash|Read|Grep|Glob', hooks: [{ type: 'command', command: hookCommand, timeout: 10 }] }])
  assert.deepEqual(plan.entries.sets, [])
})

test('a nested key that is the kit\'s own is removed with the folders it leaves empty', () => {
  const mine = { appends: [], sets: [{ path: ['a', 'b', 'c'], value: 1 }] }
  const { next, added } = applyEntries({ x: 1 }, mine)
  assert.deepEqual(next, { x: 1, a: { b: { c: 1 } } })
  assert.deepEqual(removeEntries(next, added).next, { x: 1 })
  const withSibling = applyEntries({ a: { other: 2 } }, mine)
  assert.deepEqual(removeEntries(withSibling.next, withSibling.added).next, { a: { other: 2 } })
})

test('a state folder set in the environment is protected as well', () => {
  const [plan] = guardPlan({ tool: 'claude', ...context({ env: { HOME: '/h', FE_KIT_STATE_DIR: '/data/fe-kit-state' } }) })
  const deny = plan.entries.appends.filter((entry) => entry.path.join('.') === 'permissions.deny').map((entry) => entry.item)
  assert.ok(deny.includes('Read(//data/fe-kit-state/auth/**)'))
  assert.equal(deny.length, 3)
  const [agy] = guardPlan({ tool: 'antigravity', ...context({ env: { HOME: '/h', FE_KIT_STATE_DIR: '/data/fe-kit-state' } }) }).filter((plan) => plan.file.endsWith('settings.json'))
  assert.ok(agy.entries.appends.some((entry) => entry.item === 'read_file(/data/fe-kit-state/auth/**)'))
  for (const FE_KIT_STATE_DIR of ['/h/.local/state/fe-kit', 'relative/state']) {
    const [same] = guardPlan({ tool: 'claude', ...context({ env: { HOME: '/h', FE_KIT_STATE_DIR } }) })
    assert.equal(same.entries.appends.filter((entry) => entry.path.join('.') === 'permissions.deny').length, 2, FE_KIT_STATE_DIR)
  }
})

test('the plan for Codex: a rules file the kit owns, and one hook that only looks at Bash', () => {
  const plans = guardPlan({ tool: 'codex', ...context() })
  const rules = plans.find((plan) => plan.kind === 'owned')
  const json = plans.find((plan) => plan.kind === 'json')
  assert.equal(rules.file, '/h/.codex/rules/fe-kit.rules')
  assert.equal(rules.text, codexRulesText('/kit'))
  assert.equal(json.file, '/h/.codex/hooks.json')
  assert.deepEqual(json.entries.appends, [append(['hooks', 'PreToolUse'], { matcher: 'Bash', hooks: [{ type: 'command', command: hookCommand, timeout: 10 }] })])
})

test('the Codex rules file: one rule per form, prompt for what changes things, allow for what needs to run outside the sandbox', () => {
  const text = codexRulesText('/kit')
  const lines = text.trimEnd().split('\n')
  assert.equal(lines[0], OWNED_HEADER)
  const rules = lines.slice(1).filter((line) => line !== '' && !line.startsWith('#'))
  for (const line of rules) assert.match(line, /^prefix_rule\(pattern=\[("[^"]*"(, )?)+\], decision="(prompt|allow)"\)$/, line)
  for (const prefix of codexRulePrefixes('/kit')) assert.ok(rules.includes(`prefix_rule(pattern=${JSON.stringify(prefix).replace(/,/g, ', ')}, decision="prompt")`), prefix.join(' '))
  for (const allowed of [['fe-kit', 'ui'], ['fe-kit', 'dev'], ['fe-kit', 'mr', 'fetch'], ['node', '/kit/bin/fe-kit.mjs', 'ui'], ['npx', 'fe-kit', 'dev']]) {
    assert.ok(rules.includes(`prefix_rule(pattern=${JSON.stringify(allowed).replace(/,/g, ', ')}, decision="allow")`), allowed.join(' '))
  }
  assert.ok(!rules.some((line) => line.includes('"ui-act"') && line.includes('allow')))
  assert.equal(text.endsWith('\n'), true)
})

test('the plan for Antigravity: its own key in hooks.json, and ask and deny rules for the CLI', () => {
  const plans = guardPlan({ tool: 'antigravity', ...context() })
  const hooks = plans.find((plan) => plan.file === '/h/.gemini/config/hooks.json')
  const settings = plans.find((plan) => plan.file === '/h/.gemini/antigravity-cli/settings.json')
  assert.deepEqual(hooks.entries.sets, [{ path: ['fe-kit'], value: { PreToolUse: [{ matcher: 'run_command|view_file', hooks: [{ type: 'command', command: hookCommand, timeout: 10 }] }] } }])
  const ask = settings.entries.appends.filter((entry) => entry.path.join('.') === 'permissions.ask').map((entry) => entry.item)
  assert.ok(ask.includes('command(git commit)') && ask.includes('command(fe-kit link)') && ask.includes('command(fe-kit mr post)'))
  assert.ok(settings.entries.appends.some((entry) => entry.path.join('.') === 'permissions.deny' && entry.item === 'read_file(~/.config/fe-kit/**)'))
})

test('a program or a hook path with a space in it is quoted for the shell that runs it', () => {
  const [plan] = guardPlan({ tool: 'claude', ...context({ kitRoot: '/my kit', node: '/opt/my node/bin/node' }) })
  const item = plan.entries.appends.find((entry) => entry.path.join('.') === 'hooks.PreToolUse').item
  assert.equal(item.hooks[0].command, "'/opt/my node/bin/node' '/my kit/hooks/shell-guard.mjs'")
})

test('an unknown tool has no plan', () => {
  assert.throws(() => guardPlan({ tool: 'vim', ...context() }), /unknown tool/)
})

test('JSON that cannot be read is refused with words that do not quote the text', () => {
  const secret = 'SECRET42'
  for (const text of [`{"token":${secret}}`, `{"a": '${secret}'}`, `{"a":1,}${secret}`, `${secret}`]) {
    assert.throws(() => parseJsonConfig(text), (error) => error instanceof ConfigProblem && /not valid JSON/.test(error.message) && !error.message.includes(secret))
  }
})
