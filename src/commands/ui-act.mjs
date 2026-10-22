import { parseAllowRequest } from '../lib/request-policy.mjs'
import { confirmUiAct } from '../lib/ui-act-gate.mjs'
import { UsageError } from '../lib/errors.mjs'
import { options as uiOptions, run as runUi } from './ui.mjs'

export const options = { ...uiOptions, 'allow-request': { type: 'string' } }

export const usage = `Usage: fe-kit ui-act --target <name> --allow-request "METHOD https://host/path" [the options of fe-kit ui]

Like fe-kit ui, but lets exactly one write request that matches --allow-request go through on a read-only target; every other
write is still refused. The request is shown to you and you type yes at the terminal before anything runs. A tool that runs this
command for you has no terminal of yours, so it stops and tells you to run it yourself.
The permission is for this call only: for another write, call again.
`

export async function run(context) {
  const request = context.flags['allow-request']
  if (request === undefined) throw new UsageError('ui-act needs --allow-request "METHOD https://host/path": the one write request it may let through')
  parseAllowRequest(request)
  await confirmUiAct({ request, target: context.flags.target ?? '(the only target)', role: context.flags.role, deps: context.deps })
  return runUi({ ...context, deps: { ...context.deps, uiActGate: () => true } })
}
