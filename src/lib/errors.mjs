/** A mistake in how a command was called (an unknown base, a bad flag value). It exits 2 and is not a bug in fe-kit. */
export class UsageError extends Error {
  name = 'UsageError'
}
