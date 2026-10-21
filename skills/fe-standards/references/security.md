---
paths:
  - "**/*.{ts,tsx,js,jsx,mjs,cjs,vue,svelte,html}"
---
# Security

Defaults for repos that do not say otherwise. The project's own standards win where they differ.

## Rendering untrusted data
- Do not put text you did not write into the page as HTML: `dangerouslySetInnerHTML`, `innerHTML`, `v-html`, `{@html}`. If it is unavoidable, sanitise it with a maintained library (DOMPurify) and say why in a comment.
- Check a URL that comes from data or the query string before it becomes an `href`, a `src` or a redirect target: allow `https:` (and `mailto:` or `tel:` where needed), refuse `javascript:`, and for redirects allow only known paths or origins.
- No `eval`, `new Function`, or a string passed to `setTimeout`/`setInterval`.
- A link that opens a new tab (`target="_blank"`) carries `rel="noopener noreferrer"`.
- In a `message` event handler, check `event.origin` before trusting `event.data`.

## Secrets and personal data
- A secret never reaches the browser: not in the bundle, not in a variable the build tool exposes (`NEXT_PUBLIC_`, `VITE_`), not in the repository. Browser code holds public identifiers only.
- Do not log tokens, passwords or personal data, and do not put them in URLs, error messages or analytics events.
- Keep session tokens out of `localStorage` where the backend can set an `HttpOnly` cookie. Where they must live in JavaScript, treat any XSS as full account takeover.

## Requests and dependencies
- A request that changes data is not a `GET`. Send it with the CSRF protection the backend expects (a token header, or `SameSite` cookies), and do not assume CORS protects the API.
- Treat everything from outside as untrusted: validate its shape before use, and do not spread an untrusted object into config or state (prototype pollution).
- Validate file uploads (type, size) before sending and on the server; the check in the browser is a courtesy.
- Show users a message they can act on, not a stack trace or a server error body.
- Before adding a dependency, check that it is maintained, what it pulls in, and that the name is the one you mean (typosquats exist).
