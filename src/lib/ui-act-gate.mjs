import { UsageError } from './errors.mjs'

/**
 * `ui-act` lets one write request through on a read-only target. What makes that safe is a person seeing the request before it
 * is sent, and that comes from `shell-guard`, which does not exist yet. Until it does, no way of calling the kit lets a write
 * through: the command and the runner both refuse, and a caller can open the gate only by saying so itself (`deps.uiActGate`),
 * which nothing in the kit does. A script that drives Playwright on its own is outside what the kit can stop.
 */
export function assertUiActEnabled(deps) {
  if (deps?.uiActGate?.() !== true) {
    throw new UsageError('ui-act is not enabled yet: it lets a write request through on a read-only target, which needs shell-guard to show you the request first (see docs/plan.md, Phase 1)')
  }
}
