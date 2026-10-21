import { sessionPath, stateRoot } from './auth-store.mjs'
import { UsageError } from './errors.mjs'
import { interpolateEnv } from './profile.mjs'
import { isReadOnly, parseSafeRequest, sessionConfig, targetProblems } from './targets.mjs'

const list = (names) => names.join(', ')

/** The address of a target: the variables filled in, and nothing that is not a plain http(s) address without a login in it. */
function resolveUrl(targetName, text, env) {
  const { value, missing } = interpolateEnv(text, env)
  if (missing.length > 0) throw new UsageError(`target "${targetName}" needs the environment variable ${list(missing)}, which is not set`)
  // Nothing of the value is repeated below: it came from the environment and may be a secret.
  let address
  try {
    address = new URL(value)
  } catch {
    throw new UsageError(`the address of target "${targetName}" is not a valid URL`)
  }
  if (address.protocol !== 'http:' && address.protocol !== 'https:') throw new UsageError(`the address of target "${targetName}" must be http or https`)
  if (address.username !== '' || address.password !== '') throw new UsageError(`the address of target "${targetName}" must not carry a user name or password`)
  return { url: value, origin: address.origin }
}

/**
 * What `auth` and `ui` need to know about the target and the role named on the command line: the address, whether the target
 * is read-only and the requests it lets through, how to tell a lost login, and where the saved login lives. Every way this can
 * be wrong is a usage error that says what to do; it never touches the disk or the network.
 */
export function resolveUiTarget({ settings, flags, env, roleRequired = false }) {
  if (typeof settings?.name !== 'string') throw new UsageError('no profile matches this project: `ui` and `auth` read the targets of a profile (see `fe-kit context`)')
  const problems = targetProblems(settings.targets, settings.roles)
  if (problems.length > 0) throw new UsageError(`the profile has problems in "targets" or "roles": ${problems.join('; ')}`)
  const names = Object.keys(settings.targets ?? {})
  if (names.length === 0) throw new UsageError(`profile ${settings.name} has no "targets"`)

  const targetName = flags.target ?? (names.length === 1 ? names[0] : undefined)
  if (targetName === undefined) throw new UsageError(`--target is required: one of ${list(names)}`)
  if (!names.includes(targetName)) throw new UsageError(`unknown target "${targetName}" (targets: ${list(names)})`)
  const target = settings.targets[targetName]

  const role = flags.role
  if (role === undefined && roleRequired) throw new UsageError('--role is required for this command')
  if (role !== undefined && Array.isArray(settings.roles) && !settings.roles.includes(role)) {
    throw new UsageError(`unknown role "${role}" (roles: ${list(settings.roles)})`)
  }
  if (target.url === undefined) throw new UsageError(`target "${targetName}" has no "url"`)

  return {
    profile: settings.name,
    targetName,
    target,
    role,
    ...resolveUrl(targetName, target.url, env),
    readOnly: isReadOnly(target),
    safeRequests: (target.safeRequests ?? []).map(parseSafeRequest),
    session: sessionConfig(target),
    statePath: role === undefined ? undefined : sessionPath(stateRoot(env), { profile: settings.name, target: targetName, role }),
  }
}
