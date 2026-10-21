---
paths:
  - "**/*.{ts,tsx,mts,cts}"
---
# TypeScript

Defaults for repos that do not say otherwise. The project's own standards win where they differ. What the linter or `tsc` already enforces is not repeated here.

## Types at the edges
- Type data where it enters: network, storage, `JSON.parse`, `postMessage`, URL params. Validate there with the repo's schema library, then trust the type inside the app.
- Use `unknown` for a value you have not checked yet, and narrow it. `any` turns checking off for everything it touches.
- A cast (`as T`) states what you want to be true; it does not make it true. Prefer a type guard or a schema. Keep a necessary cast to one line with the reason beside it.
- No `!` non-null assertion unless a comment names the invariant that makes it safe.
- Use `@ts-expect-error` with a reason, never `@ts-ignore`, never `@ts-nocheck`.

## Modelling
- Model states that exclude each other as a discriminated union (`{ status: 'loading' } | { status: 'error'; error: Error } | { status: 'ready'; data: T }`), not as several booleans that can disagree. End a `switch` over one with a `never` check.
- Derive a type from the value that defines it (`typeof`, `keyof`, `as const`, `satisfies`) instead of writing both.
- Prefer a union of string literals, or an `as const` object, to an `enum`, unless the repo already uses enums.
- Mark what must not change as `readonly`: props, constants, arrays returned by selectors.

## Functions and modules
- Give exported functions explicit return types; let local ones infer.
- Take an options object once a function has more than three positional parameters or any boolean parameter.
- Use a generic only when it relates two types (input to output). Otherwise write the concrete type.
- Export a type from the module that owns it.
