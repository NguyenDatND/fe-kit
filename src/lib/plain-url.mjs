/** An address as it is shown and kept: origin and path, with no query string, no fragment and no login. They can hold a token. */
export function plainUrl(url) {
  try {
    const address = new URL(url)
    return `${address.origin}${address.pathname}`
  } catch {
    return '(unreadable URL)'
  }
}
