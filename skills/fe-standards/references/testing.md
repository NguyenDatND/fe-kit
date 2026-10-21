---
paths:
  - "**/*.{test,spec}.{ts,tsx,js,jsx,mjs,cjs}"
  - "**/__tests__/**"
  - "**/e2e/**"
  - "**/tests/**"
---
# Testing

Defaults for repos that do not say otherwise. The project's own standards win where they differ.

## What to test
- Test behaviour a user can see or an API a caller relies on, not how the code is built. A test that breaks on a harmless refactor is testing the wrong thing.
- Drive components the way a user does: query by role, label or text (`getByRole` first), act with `userEvent`, assert on what is on screen. Avoid reading state, class names or component internals.
- One behaviour per test, named for that behaviour ("shows the error when the password is wrong"). Arrange, act, assert, in that order.
- A test must be able to fail. Watch it fail for the right reason before you trust it; a test written after the code, and never seen red, proves nothing.

## What to fake
- Fake only at the edges: the network (a request-mocking layer such as MSW rather than mocking `fetch` or your own client), the clock, randomness, the browser APIs the environment lacks.
- Do not mock the unit under test, or modules of your own code just to make a test easy. If that is the only way, the unit is too coupled; fix the design.
- Keep each test independent: build its data inside the test or a `beforeEach`, and leave nothing behind.

## Async and flakiness
- Wait for a condition, not for time: `findBy*` or `waitFor` with one assertion, and web-first assertions in Playwright. No `sleep`, `setTimeout` or `waitForTimeout`.
- Do not commit `.only` or `.skip`; a skipped test needs an issue reference and a reason.
- Prefer accessible locators in end-to-end tests (`getByRole`, `getByLabel`). Add a test id only where no accessible handle exists.
- Snapshots are for small, stable output. A whole-tree snapshot is approved without being read.
