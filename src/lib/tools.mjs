// What fe-kit installs where for each tool, and how far each cell has been checked.
// Status: 'headless' = verified by running the CLI (version recorded), 'docs' = a vendor document says so
// (named in `source`, listed in docs/spike.md section 7), 'pending' = not checked and not backed by a document we read.
// A `verified` status describes the CLI. The GUI surfaces (IDE, app) are tracked once per tool in `gui`,
// so a cell that is `headless` is not mistaken for one that was checked in the IDE.
// The evidence for every cell is in docs/spike.md.

const headless = (version, note) => ({ status: 'headless', version, ...(note && { note }) })
const docs = (source, note) => ({ status: 'docs', source, ...(note && { note }) })
const pending = (note) => ({ status: 'pending', ...(note && { note }) })

export const TOOLS = {
  claude: {
    label: 'Claude Code',
    skillsDir: '~/.claude/skills',
    rules: { scope: 'user', path: '~/.claude/rules/fe-kit.md', mode: 'file' },
    projectDocs: {
      reads: ['CLAUDE.md', 'AGENTS.md'],
      note: 'CLAUDE.md wins; AGENTS.md is only used when CLAUDE.md is absent',
      needsAgentsLink: false,
    },
    agents: { scope: 'user', path: '~/.claude/agents' },
    hooks: { path: '~/.claude/settings.json', onError: 'allow', canAsk: true, askDecision: 'ask' },
    guard: { kind: 'claude-permissions', path: '~/.claude/settings.json', ask: 'permissions.ask', deny: 'permissions.deny' },
    mcp: 'claude mcp add --scope user',
    invokerOnly: 'frontmatter',
    gui: pending('the IDE extensions and the desktop app have not been checked by hand'),
    verified: {
      skillsDir: headless('Claude Code 2.1.302', 'follows symlinks; a running session sees new skills'),
      rules: headless('Claude Code 2.1.302', 'user-level rules load'),
      projectDocs: headless('Claude Code 2.1.302'),
      agents: pending(),
      hooks: headless('Claude Code 2.1.302', 'project-level settings.json tested; the user-level file has the same format'),
      guard: headless('Claude Code 2.1.302', 'ask beats allow; project-level allow is ignored in an untrusted workspace'),
      mcp: pending(),
      invokerOnly: docs('claude-skills-doc', 'disable-model-invocation in the frontmatter'),
    },
  },

  codex: {
    label: 'Codex',
    skillsDir: '~/.agents/skills',
    rules: { scope: 'user', path: '~/.codex/AGENTS.md', mode: 'block' },
    projectDocs: {
      reads: ['AGENTS.md'],
      note: 'project_doc_fallback_filenames only applies when AGENTS.md is absent',
      needsAgentsLink: true,
    },
    agents: { scope: 'user', path: '~/.codex/agents' },
    hooks: { path: '~/.codex/hooks.json', onError: 'allow', canAsk: false, askDecision: null },
    guard: { kind: 'codex-rules', path: '~/.codex/rules/fe-kit.rules', decisions: ['allow', 'prompt', 'forbidden'] },
    mcp: 'codex mcp add',
    invokerOnly: 'openai-yaml',
    gui: pending('the Codex IDE extension and the app have not been checked by hand'),
    verified: {
      skillsDir: headless('codex-cli 0.163.0', 'does not read ~/.claude/skills'),
      rules: headless('codex-cli 0.163.0', 'a marked block inside ~/.codex/AGENTS.md'),
      projectDocs: headless('codex-cli 0.163.0', 'a symlink AGENTS.md -> CLAUDE.md works'),
      agents: pending('a subagent is said to inherit the parent sandbox, so read-only may not be enforced; unchecked'),
      hooks: headless('codex-cli 0.163.0', 'project hooks need a trusted project; ask is ignored and the command runs'),
      guard: headless('codex-cli 0.163.0', 'prompt and forbidden checked; allow runs a command outside the sandbox, which Chromium needs'),
      mcp: pending(),
      invokerOnly: pending('agents/openai.yaml with policy.allow_implicit_invocation: false; no document read, nothing run'),
    },
  },

  antigravity: {
    label: 'Antigravity',
    skillsDir: '~/.gemini/config/skills',
    rules: { scope: 'user', path: '~/.gemini/config/rules/fe-kit.md', mode: 'file', frontmatter: 'trigger: always_on' },
    projectDocs: {
      reads: ['AGENTS.md', 'GEMINI.md'],
      note: 'CLAUDE.md and @import are not read',
      needsAgentsLink: true,
    },
    agents: { scope: 'user', path: '~/.gemini/config/agents' },
    hooks: { path: '~/.gemini/config/hooks.json', onError: 'deny', canAsk: true, askDecision: 'force_ask' },
    guard: { kind: 'agy-permissions', path: '~/.gemini/antigravity-cli/settings.json', ask: 'permissions.ask', deny: 'permissions.deny' },
    mcp: '~/.gemini/config/mcp_config.json',
    invokerOnly: 'none',
    gui: pending('Antigravity App and IDE have not been checked by hand'),
    verified: {
      skillsDir: headless('agy 1.4.0', 'App and IDE: docs only, pending a manual check; antigravity-cli/skills is not read'),
      rules: headless('agy 1.4.0', 'without the frontmatter a rule is silently dropped'),
      projectDocs: headless('agy 1.4.0', 'a symlink AGENTS.md -> CLAUDE.md works'),
      agents: pending(),
      hooks: headless('agy 1.4.0', 'hooks.json maps a name to events; the stdin has no event name'),
      guard: headless('agy 1.4.0', 'CLI: permissions.ask and deny in settings.json; App and IDE use hooks, pending a manual check'),
      mcp: pending(),
      invokerOnly: docs('antigravity-skills-doc', 'no mechanism exists, so the description must say how to call it'),
    },
  },
}

export function getTarget(tool) {
  if (!Object.hasOwn(TOOLS, tool)) throw new Error(`unknown tool: ${tool}`)
  return TOOLS[tool]
}
