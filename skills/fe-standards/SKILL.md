---
name: fe-standards
description: Use when about to write or change frontend files (components, hooks, styles, tests, config) and the project's conventions matter. Finds which standards documents apply to those files, so that only those are read.
---

# fe-standards

Read the standards that apply to the files you are about to change, and only those.

## Steps

1. List the files you are about to create or change, as paths from where you are working (or absolute). A file that does not exist yet counts.
2. Run `fe-kit rules --files <path> [<path> ...]`.
3. Read each document it lists, in the order printed. A `project` document comes before a `kit` one and wins over it: where the two disagree, follow the project's.
4. Skip anything the linter or the type checker already enforces in this repository. Do not restate it and do not work around it.
5. Write the change to those standards. When a standard decides a choice that is not obvious, say which one, in one short clause, in your reply or commit message.

## Rules of use

- Do not read documents that are not listed. The list exists so that the context stays small.
- Do not copy a standard into your answer or into the code as a comment.
- Run it again when the set of files changes (a new area of the codebase brings other documents).
- If `Warnings:` names a project document (for example, a `paths` that cannot be read), tell the user once, briefly. The document is treated as covering every file until it is fixed.

## When it does not work

- `fe-kit: command not found`: tell the user; do not guess the conventions. If `CLAUDE.md` or `AGENTS.md` is loaded, follow it.
- No documents listed: the project has no written standards and the kit has none for these files. Follow the surrounding code.
