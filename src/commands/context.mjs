import { join } from 'node:path'
import { draftsDir, hasCatchAll } from '../lib/drafts.mjs'
import { exists } from '../lib/fsx.mjs'
import { getRemotes, listTracked } from '../lib/git.mjs'
import { envNames, profileStandards, redactCredentials } from '../lib/profile.mjs'
import { resolveProject } from '../lib/project.mjs'
import { warningsBlock } from '../lib/format.mjs'

export const options = {}

export const usage = `Usage: fe-kit context [--json]

Reports the project root, the profile that matches, the stack, the commands (from the package.json scripts and the
profile), the test policy and the state of the .fe-kit drafts folder. Run it first in a frontend project.
`

function formatContext(data) {
  const { stack } = data
  const yesNo = (flag) => (flag ? 'yes' : 'no')
  const lines = [
    `Project root: ${data.projectRoot} (${data.isGit ? 'git' : 'not a git repo'})`,
    `Package root: ${data.packageRoot}`,
    `Profile: ${data.profile ? `${data.profile.name} (${data.profile.file})` : 'none matched'}`,
    `Profiles folder: ${data.profilesDir}`,
    `Remotes: ${data.remotes.length > 0 ? data.remotes.join(', ') : '(none)'}`,
    `Stack: ${[stack.packageManager, stack.language, stack.uiLibrary, stack.framework, stack.testRunner].filter(Boolean).join(', ') || 'unknown'}`,
  ]
  if (stack.monorepo) lines.push(`Monorepo: ${stack.monorepo.tools.join(', ')}`)
  lines.push(
    'Commands:',
    ...Object.entries(data.commands).map(([name, command]) => `  ${name}: ${command ?? '(none)'}`),
    `Tests: policy ${data.tests.policy}; project test setup: ${yesNo(data.tests.projectHasTestSetup)}`,
    `Drafts: ${data.drafts.dir} (${data.drafts.initialized ? 'initialized' : 'not initialized, run `fe-kit init`'})`,
    `Conventions: CLAUDE.md ${yesNo(data.conventions.claudeMd)}, AGENTS.md ${yesNo(data.conventions.agentsMd)}`,
  )
  if (data.warnings.length > 0) lines.push(warningsBlock(data.warnings))
  return `${lines.join('\n')}\n`
}

/**
 * What an agent needs to know before touching a frontend project: where drafts go (project root),
 * which commands exist (nearest package.json), which profile applies, and anything that looks wrong.
 */
export async function run({ cwd, env, kitRoot }) {
  const { here, projectRoot, isGit, packageRoot, stack, matched, settings, commands, warnings } = await resolveProject({ cwd, env, kitRoot })

  // `${env:NAME}` placeholders stay as written: an expanded value would put a credential in front of the model and
  // into --json output, so only whether each variable is set is reported.
  const targets = settings.targets ?? {}
  const profileEnv = Object.fromEntries(
    [...new Set(envNames(targets))].map((name) => [name, env[name] === undefined ? 'missing' : 'set']),
  )
  for (const [name, state] of Object.entries(profileEnv)) {
    if (state === 'missing') warnings.push(`Environment variable ${name} is not set (used by a profile target)`)
  }

  const draftsIgnore = join(draftsDir(projectRoot), '.gitignore')
  const tracked = isGit ? await listTracked(projectRoot, '.fe-kit') : []
  const drafts = {
    dir: draftsDir(projectRoot),
    initialized: await exists(draftsIgnore),
    ignored: await hasCatchAll(draftsIgnore).catch(() => false),
    trackedFiles: tracked === null ? null : tracked.length,
  }
  if (drafts.initialized && !drafts.ignored) {
    warnings.push('.fe-kit/.gitignore has no catch-all "*", so drafts can show up in git status; run `fe-kit init`')
  }
  if (drafts.trackedFiles === null) {
    warnings.push('could not tell whether git tracks files under .fe-kit (git ls-files failed)')
  } else if (drafts.trackedFiles > 0) {
    warnings.push(`${drafts.trackedFiles} file(s) under .fe-kit are tracked by git, so ignore rules do not apply to them; drafts must not be committed`)
  }

  const data = {
    cwd: here,
    projectRoot,
    isGit,
    packageRoot,
    profilesDir: env.FE_KIT_PROFILES_DIR ?? join(kitRoot, 'profiles'),
    remotes: isGit ? await getRemotes(projectRoot) : [],
    profile: matched
      ? {
          name: settings.name,
          file: matched.file,
          baseBranch: settings.baseBranch ?? null,
          roles: settings.roles ?? [],
          standards: profileStandards(settings) ?? [],
          targets,
          env: profileEnv,
        }
      : null,
    stack,
    commands,
    tests: {
      policy: settings.tests?.policy ?? 'auto',
      projectHasTestSetup: Boolean(stack.testRunner && stack.scripts.test),
    },
    drafts,
    conventions: {
      claudeMd: await exists(join(projectRoot, 'CLAUDE.md')),
      agentsMd: await exists(join(projectRoot, 'AGENTS.md')),
    },
    warnings,
  }
  // Everything printed passes through here once: profile fields, package.json scripts and warnings alike may carry
  // a URL with a literal password, and what `context` prints goes straight into the model's context.
  const printable = redactCredentials(data)
  return { data: printable, text: formatContext(printable) }
}
