/** `1 file`, `2 files`. */
export const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`

/** The first characters of a commit hash, enough to recognise it. */
export const shortHash = (hash) => hash.slice(0, 8)

/** The last `count` lines of a text, without the blank lines that end it. */
export const lastLines = (text, count) => text.trimEnd().split('\n').slice(-count).join('\n')

/** The `Warnings:` block of a text report, as one line of text (a spread of the lines would overflow the call stack for a long list). */
export const warningsBlock = (warnings) => `Warnings:\n${warnings.map((warning) => `  - ${warning}`).join('\n')}`

/** `1.2s` for 1234 milliseconds. */
export const seconds = (milliseconds) => `${(milliseconds / 1000).toFixed(1)}s`
