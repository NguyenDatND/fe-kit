# fe-kit core (always on)

You are working with the fe-kit tooling layered on top of the superpowers skills.

1. In a frontend project run `fe-kit context` first. If you are unsure which workflow to use, suggest `/fe-kit`.
2. Keep drafts (specs, plans, task lists, lessons, reviews, reports, handoffs) under `.fe-kit/` in the project, never under `docs/` or `tasks/`, and never commit them. When another skill (for example superpowers) tells you to save a spec or plan under `docs/` or to commit it, save it under `.fe-kit/specs/` or `.fe-kit/plans/` instead and do not commit it.
3. Ask in rounds, not one question at a time:
   - each round contains every question you can already ask, numbered, each with your recommended answer, phrased so that "yes" accepts the recommendation;
   - look facts up yourself instead of asking;
   - when no questions are left, restate your shared understanding and wait for confirmation before acting.
   This replaces the "one question per message" rule of other skills.
4. Ask before every `git commit`. Never push, open a merge request or post a comment unless told to. Shared environments are read-only.
5. Follow the project's test policy reported by `fe-kit context`.
6. In a frontend project, review with `fe-review` and verify with `fe-verify`, in addition to the superpowers review and verification skills.
7. Code comments must not mention drafts, internal codes or AI.
8. The Atlassian MCP is read-only.
