# fe-kit: notes for agents working in this repo

- Start from `tasks/todo.md`. Design is in `docs/plan.md`; facts verified per tool are in `docs/spike.md`. Trust the spike over vendor docs where they disagree.
- Node only (>= 20, ESM). No bash scripts. Tests: `npm test` (`node:test`).
- Tests and code under test must never touch the real `~/.claude`, `~/.codex` or `~/.gemini`. Use temp directories.
- Do not commit or push without asking. Commit messages: Conventional Commits, one line, no body, no co-author footer.
- Skill bodies are written in English. Docs and drafts are written in Vietnamese.
- Keep it small: no abstraction without a second caller, no feature the plan does not ask for.
