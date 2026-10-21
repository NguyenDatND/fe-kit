import { realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { deriveCommands, detectStack } from './detect.mjs'
import { findPackageRoot, findProjectRoot, getRemotes } from './git.mjs'
import { loadProfiles, matchProfile, profileCommands, validateProfile } from './profile.mjs'

/**
 * Where a command was started and what is known about the project around it: the roots, the stack, the profile that
 * applies, the commands to run, and anything that looks wrong. Profiles and package.json are hand-written, so a bad
 * one is a warning and never stops the rest from being reported.
 */
export async function resolveProject({ cwd, env, kitRoot }) {
  const here = await realpath(cwd)
  const { root: projectRoot, isGit } = await findProjectRoot(here, { home: env.HOME ?? homedir() })
  const packageRoot = (await findPackageRoot(here, projectRoot)) ?? projectRoot
  const stack = await detectStack(packageRoot, { projectRoot })

  const warnings = []
  if (stack.error) warnings.push(stack.error)

  let profiles = []
  try {
    profiles = await loadProfiles(env.FE_KIT_PROFILES_DIR ?? join(kitRoot, 'profiles'))
  } catch (error) {
    warnings.push(`Profiles directory could not be read: ${error.message}`)
  }
  for (const profile of profiles) {
    const name = basename(profile.file)
    if (profile.error) {
      warnings.push(`Profile ${name} could not be read: ${profile.error}`)
    } else {
      for (const problem of validateProfile(profile.data)) warnings.push(`Profile ${name}: ${problem}`)
    }
  }

  const matched = await matchProfile(profiles, { root: projectRoot, remotes: isGit ? await getRemotes(projectRoot) : [] })
  const settings = matched?.data ?? {}
  return { here, projectRoot, isGit, packageRoot, stack, matched, settings, commands: { ...deriveCommands(stack), ...profileCommands(settings) }, warnings }
}
