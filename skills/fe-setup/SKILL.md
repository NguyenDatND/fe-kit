---
name: fe-setup
description: First visit to a repository. Looks at the project (package.json, lock file, framework, test runner, CI, git remote, issue-key style, CLAUDE.md or AGENTS.md), proposes a profile one round of questions at a time, writes it to the kit's profiles folder, runs fe-kit init, and lists what is still missing. Only runs when you type /fe-setup.
disable-model-invocation: true
---

# fe-setup

Make the repository known to the kit: one profile file, the `.fe-kit/` folder, and a list of what is left to do. Propose, then ask; write nothing before the user agrees.

## Steps

1. Run `fe-kit context --json`. It gives `projectRoot`, `remotes`, `profilesDir`, `profile` (null when none matches), `stack`, `commands`, `drafts` and `conventions`. If a profile already matches, show its file and ask whether to revise it; otherwise go on.
2. Look at what the context does not say. Read only; use `git`, `ls` and the project's own files:
   - CI: `.gitlab-ci.yml`, `.github/workflows/`, and the commands they run.
   - The issue-key style: the last 20 commit subjects and the branch names (`git log -20 --format=%s`, `git branch -a`), for a pattern like `SHOP-123`.
   - The base branch: `git symbolic-ref refs/remotes/origin/HEAD`.
   - Docs that set standards: `CONTRIBUTING.md`, `docs/`, `CLAUDE.md`, `AGENTS.md`.
   - Do not open `.env*` files, saved logins or `~/.config/fe-kit`. You may note that a `.env` exists.
3. Propose the profile (format: `docs/plan.md` section 5.4 in the kit). Ask in rounds of at most six numbered questions; give each question your recommendation and the evidence for it, so that "yes to all" is a fair answer. If the tool limits how many questions it shows, split the rounds. Cover:
   - `name`, and `match.remotes` from the remote without protocol and `.git` (`gitlab.company.local/fe/shop-web`); add `match.paths` only when there is no remote.
   - `baseBranch`; `commands` only where `package.json` lacks one (a `typecheck` that is only `tsc`, a `lint` for changed files with `{files}`).
   - `tests.policy` (`auto` unless the user says otherwise).
   - `targets`: `local` from the dev script and its port; a shared environment only with a URL the user gives. Put a URL that is not public, or that carries a credential, in an environment variable written `${env:NAME}`; never write a password, token or cookie into the profile. Say that a target without `start` is read-only by default.
   - `roles` and, for each target that needs a login, how a logged-in page is told (`session.loggedInMarker` selector, or `session.probe` path). Without one `fe-kit ui --role` refuses to run.
   - `tracker.keyPattern`, `standards` (globs of the documents found), and no `scan` rules yet.
4. After the user agrees, write `<profilesDir>/<name>.md`: the frontmatter, then a short prose part for what a person would need to know (how bugs are written up, how merge requests are titled). If the file exists, show the difference and ask before replacing it. The profiles folder is the kit's, not the project's: do not commit it.
5. Run `fe-kit context` again. Any warning about the profile is yours to fix now. Then run `fe-kit init --dry-run`, show what it would do, and run `fe-kit init` once the user agrees. It creates `.fe-kit/` (git ignores it) and, when the project has `CLAUDE.md` but no `AGENTS.md`, links one to the other.
6. List what is still missing, as a short checklist for the user:
   - Environment variables the profile names (`fe-kit context` shows each as set or missing). The user sets them in their own shell or secret store; never ask them to paste a value into the chat.
   - A saved login per role and target: `fe-kit auth login --target <t> --role <r>`, run by the user in their own terminal.
   - MCP servers for the tracker and the design tool: not part of the kit yet; say so if the profile names one.
   - `fe-kit doctor` to check the machine.

## Rules of use

- Never read, print or ask for a secret. A value that looks like one in a file you opened is not repeated.
- Every write is announced first: the profile file and `fe-kit init` are the only two this skill makes.
- If the user answers "not sure" to a field, leave it out and list it in the checklist; do not invent a value.
