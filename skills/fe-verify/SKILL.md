---
name: fe-verify
description: Use when about to say a frontend task is done, when asked whether work is finished or ready, and before committing or opening a merge request. Runs fe-kit verify (rule scan, lint, type-check, project tests and local tests) and reports what each step really returned.
---

# fe-verify

Say "done" only with evidence from a run you made after the last change.

## Steps

1. From the project, run `fe-kit verify`. It runs, in this order: `scan` (rules over the lines this work adds), `lint`, `typecheck`, `test` (the project's own tests) and `local-test` (the tests kept in `.fe-kit/tests`). It runs every step even when one fails.
   - `--scope all` checks the whole project instead of what changed; `--base <ref>` changes the branch it compares with.
   - fe-kit itself writes only inside `.fe-kit/` (the report and, for the local tests, a generated config), which git ignores. The project's own lint, type-check and test scripts run as they always do and may write what they normally write (a build cache, say). If the user has asked for no writes of any kind, ask before running it.
   - If it warns that `.fe-kit` is not set up, run `fe-kit init` once. The checks still ran; only the report was not written.
2. Read the `Result:` line first. It is `PASSED`, `FAILED (...)` or `NOTHING VERIFIED`, and it names every step that was `Not verified`.
3. Fix the cause of each `FAIL`, then run `fe-kit verify` again. Do not edit a test, a lint rule or a scan rule to make a step pass unless that is the real defect. When a finding is a deliberate exception, say so to the user instead of hiding it.
4. When what the user sees changed, also load `fe-ui-check` if it is available, and check the screen as well as the code.
5. Report from this run: for each step, its command and what it said (the exit code, or the findings). Name each `SKIP` as not verified and give its reason. The full output is in the report file `fe-kit verify` prints (`.fe-kit/reports/verify-<time>.md`).

## Rules of use

- Never write "all checks pass" while a step failed or was skipped. A skipped step is a gap, not a pass.
- A step that fails on code you did not change is still reported. Say that it was already failing; do not fix unrelated code without asking.
- A passing run is not permission to commit or to push. Ask first, as the project's instructions require.
- Do not run `fe-kit verify` in a loop until it passes. Read the failure, fix it, run again; if the same step fails twice for the same reason, stop and tell the user.
