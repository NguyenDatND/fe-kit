import { parseAllowRequest } from '../lib/request-policy.mjs'
import { assertUiActEnabled } from '../lib/ui-act-gate.mjs'
import { UsageError } from '../lib/errors.mjs'
import { options as uiOptions, run as runUi } from './ui.mjs'

export const options = { ...uiOptions, 'allow-request': { type: 'string' } }

export const usage = `Usage: fe-kit ui-act --target <name> --allow-request "METHOD https://host/path" [the options of fe-kit ui]

Like fe-kit ui, but lets exactly one write request that matches --allow-request go through on a read-only target; every other
write is still refused. The request is on the command line so that the approval box shows what will change. The permission is
for this call only: for another write, call again.
NOT ENABLED YET: it needs shell-guard, which shows you the request before it runs. Until then it exits 2.
`

export async function run(context) {
  assertUiActEnabled(context.deps)
  if (context.flags['allow-request'] === undefined) throw new UsageError('ui-act needs --allow-request "METHOD https://host/path": the one write request it may let through')
  parseAllowRequest(context.flags['allow-request'])
  return runUi(context)
}
