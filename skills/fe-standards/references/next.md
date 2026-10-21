---
frameworks: [next]
paths:
  - "**/next.config.*"
  - "**/app/**/*.{ts,tsx,js,jsx}"
  - "**/pages/**/*.{ts,tsx,js,jsx}"
  - "**/middleware.{ts,js}"
---
# Next.js

Defaults for repos that do not say otherwise. The project's own standards win where they differ. Check the Next.js major version in `package.json`: several defaults below changed between versions.

## Server and client
- In the App Router a component is a Server Component unless it (or a file above it) says `'use client'`. Add `'use client'` only to the leaves that need state, effects, event handlers or browser APIs, and keep that boundary small.
- Code that touches a database, a secret or the filesystem lives in a module that imports `server-only`, so that importing it from a Client Component fails the build.
- Pass a Client Component only what it needs, as serialisable props. Do not hand it a whole record when it shows one field.
- Environment variables prefixed `NEXT_PUBLIC_` are copied into the browser bundle. Never put a secret in one.

## Data and caching
- Fetch data in a Server Component or a route handler, near where it is used. Do not fetch in a Client Component effect what a Server Component could have loaded.
- Say how a request is cached (`cache`, `next.revalidate`, `revalidateTag`, route segment config). The defaults differ between major versions, so relying on them silently breaks on an upgrade.
- In recent majors `params` and `searchParams` are Promises: `await` them in Server Components and `generateMetadata`, and read them with `use` in Client Components.

## Server Actions and route handlers
- Treat a Server Action or route handler as a public endpoint. Authenticate the caller, authorise the caller for this resource (not just "is logged in"), and validate the input with a schema, every time.
- Return an error the page can show; do not leak stack traces or internals.

## Files and framework features
- Give each route segment the files it needs: `loading.tsx` for the wait, `error.tsx` for failure, `not-found.tsx` for a missing resource.
- Use `next/link` for internal navigation, `next/image` for images (with dimensions or `fill`, meaningful `alt`, `priority` for the main image above the fold), and `next/font` for fonts.
- Set page metadata with the `metadata` export or `generateMetadata`, not with a hand-written `<head>`.
