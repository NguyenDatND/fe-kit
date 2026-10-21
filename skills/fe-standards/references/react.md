---
paths:
  - "**/*.{tsx,jsx}"
  - "**/use[A-Z]*.{ts,js}"
  - "**/hooks/**/*.{ts,js}"
---
# React

Defaults for repos that do not say otherwise. The project's own standards win where they differ. What the linter already enforces (`rules-of-hooks`, `exhaustive-deps`) is not repeated here.

## State and effects
- Compute what can be computed from props and state while rendering. Do not copy it into state and sync it with an effect.
- Use an effect only to synchronise with something outside React: a subscription, a timer, the DOM, a request. Reacting to a user action belongs in the event handler.
- An effect that starts something stops it in its cleanup: unsubscribe, clear the timer, abort the request (`AbortController`). A request without cleanup can show the answer to an old one.
- List every reactive value the effect reads in its dependencies. Silencing the lint rule is a stale closure waiting to happen; restructure instead.
- When the new state depends on the old, use the functional form (`setCount((count) => count + 1)`).
- Keep state as close to where it is used as possible. Lift it only as far as the components that need it, and reach for composition or context before passing a prop through more than two layers.
- Never mutate state or props. Copy, then set.

## Rendering
- Keys come from the data (an id), not from the index, unless the list never reorders or changes.
- Do not define a component inside another component: it is a new component on every render and loses its state each time.
- Render every state a user can see: loading, empty, error, and loaded. A list without an empty state is unfinished.
- A condition that can be `0` (`items.length && ...`) renders the `0`. Compare explicitly (`items.length > 0`).
- Put an error boundary (and Suspense, where the repo uses it) around data that loads asynchronously, so one failure does not blank the page.
- In an app that renders on the server, do not read `window`, `localStorage`, `Date.now()` or `Math.random()` while rendering: the server HTML and the first client render must agree.

## Data and structure
- Fetch server data with the repo's data layer (its query library, loaders, or server components), not with a hand-written `useEffect(fetch)` in each component.
- A custom hook starts with `use` and returns a small, stable API. A function that calls no hook is a plain function.
- Name event props `onX` and their handlers `handleX`.
- Add `useMemo`, `useCallback` or `memo` for a measured cost or a memoised child that needs a stable reference, not by habit.
