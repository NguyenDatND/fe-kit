---
name: fe-ui-check
description: Use when you need to see the real UI of a frontend project, reproduce a UI bug, check a change on screen, or compare the screen with a design. Runs fe-kit ui in a real browser at several viewport sizes and reports pictures, console errors, failed requests and the result of scripted steps, without writing data on a shared environment.
---

# fe-ui-check

Look at the running app, not only at the code. Report what the run showed.

## Steps

1. Find the target. `fe-kit context` lists the targets of the project's profile. A target has a `url`; one with a `start` command is a dev server the kit can run (`fe-kit dev start --target <name>`, then `fe-kit dev stop` when done). If the project has no profile with `targets`, say so and stop: do not guess an address.
2. Run `fe-kit ui --target <name> --path <page>`. Without `--viewports` it takes pictures at mobile, tablet and desktop. Add `--role <role>` for a page that needs a login.
   - A script of steps goes in a JSON file (`templates/ui-steps.json` shows the form: goto, click, fill, press, waitFor, screenshot, expectText, expectVisible, expectValue) and runs once, at one viewport: `--steps <file> [--viewports desktop]`. Write the file in `.fe-kit/` and keep real passwords out of it.
3. Read the output: the `Result:` line first (`ok`, `failed (why)` or `login lost`), then the login line, the steps, `Console errors`, `Failed responses`, `Refused by the guard`, and the folder `.fe-kit/ui/<time>-<target>/` that holds the pictures and `report.md`. Open the pictures you need; do not describe a page you did not look at.
4. Report from this run: what you saw, the console errors and failed responses (a 404 or a console error is a finding even when the run exits 0), and anything the guard refused.

## When the login is gone

Exit code 3 and `Login: expired` mean the saved login of that role is missing or has run out. Do not try to log in yourself and do not look for the saved file. Tell the user to run `fe-kit auth login --target <name> --role <role>` in their own terminal (it opens a browser window and waits for them), then run `fe-kit ui` again. `Login: unknown` (exit 1) means the page showed none of what the profile says a logged-in page shows: say so, and ask for `session.loggedInMarker` or `session.probe` to be set in the profile rather than calling the page logged in.

## Shared environments are read-only

A target the kit does not start itself is read-only: every write request (POST, PUT, PATCH, DELETE) the page makes is refused, so clicking and typing are safe and nothing is saved. What the guard refused is listed under `Refused by the guard`; a form that "does nothing" on such a target is the guard, not a bug in the page. Do not look for a way around it. Requests the profile lists in `safeRequests` (GraphQL queries, say) go through; a GraphQL mutation on the same address is still refused. `fe-kit ui-act` would let one named write through, but it is not enabled: if a check truly needs a real write, ask the user.

What the guard cannot do: it cannot tell a GET that changes data from one that does not, and a WebSocket is closed before it connects, so a page that needs one will look broken. Say so when it matters.

## Rules of use

- Never write "the page looks right" without a picture from this run that you looked at. Name the viewport.
- Do not turn a refused write into a pass or a failure of the page: report it as what it is. A write the guard let through and then could not carry (it failed on the way, or was redirected) is different: the run fails, and the result line says so.
- The output is scrubbed of the saved login's values, of what the steps typed, and of what looks like a credential, but not perfectly. Do not paste a page's console output into a report without reading it for secrets.
- Do not edit the profile to make a check pass, and do not change `readOnly` or `safeRequests` without asking the user.
- A step that fails stops the run. Fix the cause (the selector, the page) and run again; if the same step fails twice for the same reason, stop and tell the user.
