import { join } from 'node:path'

// The argv prefixes that Codex's rules file asks about. Codex does not let a hook ask, so for these plain forms
// the hook stays silent and the rules file asks; anything else that needs asking is refused by the hook.

const GIT = [['git', 'commit'], ['git', 'push'], ['git', 'reset', '--hard'], ['git', 'clean', '-f'], ['git', 'clean', '-fd'], ['git', 'clean', '-fdx'], ['git', 'clean', '--force']]
const KIT_SUBCOMMANDS = [['ui-act'], ['link'], ['unlink'], ['mr', 'post'], ['mr', 'publish']]

// What Codex runs outside its sandbox without asking: a browser does not start inside it (docs/spike.md S6).
const KIT_RUN_OUTSIDE_SANDBOX = [['ui'], ['dev'], ['mr', 'fetch']]

/** The ways `fe-kit` is called: by name, through node with the path of the script, and through npx. */
const kitForms = (kitRoot) => [['fe-kit'], ['node', join(kitRoot, 'bin', 'fe-kit.mjs')], ['npx', 'fe-kit']]
const withSubcommands = (forms, subcommands) => forms.flatMap((form) => subcommands.map((subcommand) => [...form, ...subcommand]))

/** The argv prefixes that need the person's approval. */
export const codexRulePrefixes = (kitRoot) => [...GIT, ...withSubcommands(kitForms(kitRoot), KIT_SUBCOMMANDS)]

/** The argv prefixes of fe-kit commands that are allowed to run outside Codex's sandbox. */
export const codexAllowPrefixes = (kitRoot) => withSubcommands(kitForms(kitRoot), KIT_RUN_OUTSIDE_SANDBOX)

/** Whether `argv` starts with one of the prefixes, word for word, as Codex's rules match it. */
export const isCoveredByRules = (argv, prefixes) => prefixes.some((prefix) => prefix.every((word, index) => argv[index] === word))
