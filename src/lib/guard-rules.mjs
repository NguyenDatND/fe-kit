import { join } from 'node:path'

// The argv prefixes that Codex's rules file asks about. Codex does not let a hook ask, so for these plain forms
// the hook stays silent and the rules file asks; anything else that needs asking is refused by the hook.

const GIT = [['git', 'commit'], ['git', 'push'], ['git', 'reset', '--hard'], ['git', 'clean', '-f'], ['git', 'clean', '-fd'], ['git', 'clean', '-fdx'], ['git', 'clean', '--force']]
const KIT_SUBCOMMANDS = [['ui-act'], ['link'], ['unlink'], ['mr', 'post'], ['mr', 'publish']]

export function codexRulePrefixes(kitRoot) {
  const kitForms = [['fe-kit'], ['node', join(kitRoot, 'bin', 'fe-kit.mjs')], ['npx', 'fe-kit']]
  return [...GIT, ...kitForms.flatMap((form) => KIT_SUBCOMMANDS.map((subcommand) => [...form, ...subcommand]))]
}

/** Whether `argv` starts with one of the prefixes, word for word, as Codex's rules match it. */
export const isCoveredByRules = (argv, prefixes) => prefixes.some((prefix) => prefix.every((word, index) => argv[index] === word))
