---
name: fe-kit
description: Router for the frontend kit. Run it when you do not remember which skill or step comes next; it places you in the workflow (the kit's skills plus superpowers), names the decisions that are yours, and says where to continue, clear or hand off. Only runs when you type /fe-kit.
disable-model-invocation: true
---

# fe-kit

Place the user in the workflow, recommend the next step, and stop. Do not start the step yourself.

## Steps

1. Look before you answer: run `fe-kit context` (project, profile, stack, commands, drafts) and `git status -sb` plus the current branch. If the user said what they are doing, start from that; ask one question only when it cannot be told.
2. Before you say what any skill does, open its `SKILL.md`. Do not describe a skill from memory, and do not name a skill that is not in the list of available skills.
3. Pick the step from the table below and say why in one or two lines.
4. Name the decision that is the user's, if the step has one, and what you recommend.
5. Stop. Never load another skill that only the user can invoke (`fe-setup` and this one are such skills): tell the user to type it.

## Where the work is

| The user is | Recommend |
|---|---|
| In a repository for the first time (`fe-kit context` shows no profile) | `/fe-setup`, once per repository |
| Has an idea or a feature, nothing decided | superpowers `brainstorming`, then `writing-plans`. Specs and plans go in `.fe-kit/specs/` and `.fe-kit/plans/`, which git ignores |
| About to change frontend files | `fe-standards` (it loads itself) |
| Needs to see the real UI, reproduce a UI bug, check a change on screen | `fe-ui-check`. A page that needs a login needs the user to run `fe-kit auth login --target <t> --role <r>` once, in their own terminal |
| Debugging | superpowers `systematic-debugging`; for a UI symptom, `fe-ui-check` gives the loop |
| Writing tests | superpowers `test-driven-development`; the project's own test policy is in the profile (`tests.policy`) |
| About to say it is done, about to commit | `fe-verify` |
| Wants a review of a diff | superpowers `requesting-code-review`, in a fresh session |
| Is unsure whether the machine is set up | `fe-kit doctor` |

Skills of the kit that do not exist yet (do not promise them): `fe-screen`, `fe-bug`, `fe-review`, `fe-mr-review`, `fe-pr`, `fe-tdd`, `fe-prototype`, `fe-handoff`, `fe-retro`. Say which superpowers skill covers the need until they do.

## Where to continue

- Same task, context still small and relevant: continue in this session.
- A different task, or a long session whose early part no longer matters: start a new session (`/clear`, or a new window).
- Review of work this session produced: a new session, so the reviewer is not biased by it.
- Changing tool or folder, or handing the work to someone: write down what is unfinished and why, the next step, and the paths of the artifacts (not copies of them), then continue elsewhere.
- A side job that would fill this context with detail: give it to a subagent and keep only its conclusion.

## Decisions that are only the user's

- Every commit, push and merge request. Ask first, as the project's instructions say.
- `fe-kit link`, `fe-kit unlink` (they change the configuration of the tools), `fe-kit ui-act` and `fe-kit mr post` (they change data on a shared server or post to a person).
- Which rules are installed (`rules/personal-core.md`, `rules/fe-kit-core.md` wait for the user to read them).
- Anything that would put a secret, a token or a saved login in front of you: do not ask for it, do not look for it.
