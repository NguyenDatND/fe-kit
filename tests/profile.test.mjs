import assert from 'node:assert/strict'
import { symlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  envNames,
  interpolateEnv,
  loadProfiles,
  matchProfile,
  normalizeRemote,
  parseProfile,
  profileCommands,
  profileScanRules,
  profileStandards,
  redactCredentials,
  validateProfile,
} from '../src/lib/profile.mjs'
import { tempDir, writeTree } from './helpers.mjs'

const profile = (name, match, extra = {}) => ({ file: `${name}.md`, data: { name, match, ...extra }, body: '' })

test('parseProfile splits YAML frontmatter from the prose body', () => {
  const { data, body } = parseProfile('---\nname: shop-web\ntests: { policy: auto }\n---\n## Tracker\nSteps live here.\n')

  assert.deepEqual(data, { name: 'shop-web', tests: { policy: 'auto' } })
  assert.equal(body, '## Tracker\nSteps live here.\n')
})

test('parseProfile treats a file without frontmatter as all prose', () => {
  assert.deepEqual(parseProfile('just text'), { data: {}, body: 'just text' })
})

test('loadProfiles reads *.md in name order, skips README.md, tolerates a missing dir and flags broken files', async (t) => {
  const dir = await tempDir(t)
  await writeTree(dir, {
    'b.md': '---\nname: b\n---\n',
    'a.md': '---\nname: a\n---\n',
    'README.md': '# schema',
    'broken.md': '---\nname: [unclosed\n---\n',
    'notes.txt': 'ignored',
  })

  const profiles = await loadProfiles(dir)

  assert.deepEqual(profiles.map((p) => p.file.split('/').pop()), ['a.md', 'b.md', 'broken.md'])
  assert.equal(profiles[0].data.name, 'a')
  assert.match(profiles[2].error, /./)
  assert.deepEqual(await loadProfiles(join(dir, 'nope')), [])
})

test('normalizeRemote makes ssh, https, ports and credentials comparable and never keeps credentials', () => {
  const same = 'gitlab.example.com/fe/shop-web'

  assert.equal(normalizeRemote('git@gitlab.example.com:fe/shop-web.git'), same)
  assert.equal(normalizeRemote('https://gitlab.example.com/fe/shop-web'), same)
  assert.equal(normalizeRemote('https://gitlab.example.com/fe/shop-web.git/'), same)
  assert.equal(normalizeRemote('ssh://git@gitlab.example.com:2222/fe/shop-web.git'), same)
  assert.equal(normalizeRemote('https://oauth2:glpat-SECRET@gitlab.example.com/fe/shop-web.git'), same)
  assert.equal(normalizeRemote('GIT@GitLab.Example.com:FE/Shop-Web.git'), same)
})

test('matchProfile matches by project path, with ~ expanded and sub-directories included', async () => {
  const shop = profile('shop-web', { paths: ['~/work/shop-web'] })

  assert.equal(await matchProfile([shop], { root: join(homedir(), 'work/shop-web'), remotes: [] }), shop)
  assert.equal(await matchProfile([shop], { root: join(homedir(), 'work/shop-web/apps/admin'), remotes: [] }), shop)
  assert.equal(await matchProfile([shop], { root: join(homedir(), 'work/shop-web-other'), remotes: [] }), null)
})

test('matchProfile matches by remote across ssh and https forms', async () => {
  const shop = profile('shop-web', { remotes: ['gitlab.example.com/fe/shop-web'] })

  assert.equal(await matchProfile([shop], { root: '/x', remotes: ['git@gitlab.example.com:fe/shop-web.git'] }), shop)
  assert.equal(await matchProfile([shop], { root: '/x', remotes: ['https://gitlab.example.com/fe/other.git'] }), null)
})

test('matchProfile skips broken profiles and prefers the first match in order', async () => {
  const broken = { file: 'a.md', data: { match: { paths: ['/x'] } }, body: '', error: 'bad yaml' }
  const first = profile('b', { paths: ['/x'] })
  const second = profile('c', { paths: ['/x'] })

  assert.equal(await matchProfile([broken, first, second], { root: '/x', remotes: [] }), first)
})

test('matchProfile follows symlinks, so a profile path through a link still matches the real project', async (t) => {
  const dir = await tempDir(t)
  await writeTree(dir, { 'real/shop/package.json': '{}' })
  await symlink(join(dir, 'real'), join(dir, 'link'))
  const viaLink = profile('shop', { paths: [join(dir, 'link/shop')] })

  assert.equal(await matchProfile([viaLink], { root: join(dir, 'real/shop'), remotes: [] }), viaLink)
})

test('matchProfile ignores values of the wrong type instead of crashing', async () => {
  const wrong = profile('wrong', { paths: '~/work/shop', remotes: [42, null, 'h/a/b'] })

  assert.equal(await matchProfile([wrong], { root: '/x', remotes: ['git@h:a/b.git'] }), wrong)
  assert.equal(await matchProfile([wrong], { root: '/x', remotes: [] }), null)
})

test('validateProfile flags a match list that is not a list of strings', () => {
  const problems = validateProfile({ name: 'x', match: { paths: '~/work/shop', remotes: [1] } })

  assert.ok(problems.includes('"match.paths" must be a list of strings'))
  assert.ok(problems.includes('"match.remotes" must be a list of strings'))
})

test('validateProfile reports each problem and accepts a good profile', () => {
  assert.deepEqual(validateProfile({ name: 'ok', match: { remotes: ['h/a/b'] }, tests: { policy: 'local-only' } }), [])
  assert.deepEqual(validateProfile({}), ['missing "name"', '"match" needs at least one of "paths" or "remotes"'])
  assert.deepEqual(validateProfile({ name: 'x', match: { paths: ['/p'] }, tests: { policy: 'sometimes' } }), [
    '"tests.policy" must be auto, commit or local-only',
  ])
})

test('validateProfile flags baseBranch, commands and standards of the wrong shape, and never repeats a value', () => {
  const problems = validateProfile({
    name: 'x',
    match: { paths: ['/p'] },
    baseBranch: 7,
    commands: { lint: 123, test: '  ', typeCheck: 'tsc', build: 'vite build' },
    standards: 'CONTRIBUTING.md',
  })

  assert.deepEqual(problems, [
    '"baseBranch" must be a string',
    '"commands.lint" must be a non-empty string',
    '"commands.test" must be a non-empty string',
    '"commands.typeCheck" is not a known command (known: dev, build, lint, typecheck, test)',
    '"standards" must be a list of strings',
  ])
  assert.deepEqual(validateProfile({ name: 'x', match: { paths: ['/p'] }, commands: 'pnpm lint' }), [
    '"commands" must be a map of command strings',
  ])
  assert.deepEqual(validateProfile({ name: 'x', match: { paths: ['/p'] }, standards: ['a.md', 4] }), [
    '"standards" must be a list of strings',
  ])
})

test('validateProfile accepts a good baseBranch, commands and standards', () => {
  const data = {
    name: 'x',
    match: { paths: ['/p'] },
    baseBranch: 'origin/develop',
    commands: { lint: 'pnpm eslint {files}', typecheck: 'pnpm tsc -b' },
    standards: ['CONTRIBUTING.md', 'docs/frontend/**/*.md'],
  }

  assert.deepEqual(validateProfile(data), [])
})

test('profileCommands and profileStandards keep only what a shell or a file lookup can use', () => {
  assert.deepEqual(profileCommands({ commands: { lint: 'a', test: 7, build: ['x'], dev: '', typecheck: null } }), { lint: 'a' })
  assert.deepEqual(profileCommands({ commands: 'pnpm lint' }), {})
  assert.deepEqual(profileCommands({}), {})
  assert.deepEqual(profileStandards({ standards: ['a.md', 4, '', 'b/**/*.md'] }), ['a.md', 'b/**/*.md'])
  assert.equal(profileStandards({ standards: 'a.md' }), null)
  assert.equal(profileStandards({}), null) // absent is not the same as empty: absent means "use the defaults"
})

test('validateProfile checks the shape of scan rules, naming the field and never repeating a pattern', () => {
  const problems = validateProfile({
    name: 'x',
    match: { paths: ['/p'] },
    scan: [
      { id: 'ok', pattern: 'moment', message: 'use date-fns' },
      { id: '', pattern: 'x', message: 'm' },
      { id: 'bad-regex', pattern: '(unclosed https://u:FAKE_SECRET@h', message: 'm' },
      { id: 'no-message', pattern: 'x' },
      { id: 'files', pattern: 'x', message: 'm', files: 'src/**' },
      'not a map',
      { id: 'no-pattern', message: 'm' },
    ],
  })

  assert.deepEqual(problems, [
    '"scan[1].id" must be a non-empty string',
    '"scan[2].pattern" must be a valid regular expression',
    '"scan[3].message" must be a non-empty string',
    '"scan[4].files" must be a list of strings',
    '"scan[5]" must be a map with id, pattern and message',
    '"scan[6].pattern" must be a valid regular expression',
    '"scan[2].pattern" has a literal password in a URL; use ${env:NAME} instead', // found by the check that looks at every string
  ])
  assert.ok(problems.every((problem) => !problem.includes('FAKE_SECRET')))
  assert.deepEqual(validateProfile({ name: 'x', match: { paths: ['/p'] }, scan: 'moment' }), ['"scan" must be a list of rules'])
  assert.deepEqual(validateProfile({ name: 'x', match: { paths: ['/p'] }, scan: [{ id: 'a', pattern: 'b', message: 'c', files: ['src/**'] }] }), [])
})

test('profileScanRules keeps the rules that are well formed and drops the rest', () => {
  const settings = {
    scan: [
      { id: 'ok', pattern: 'moment', message: 'use date-fns', files: ['src/**'] },
      { id: 'plain', pattern: 'x', message: 'm' },
      { id: 'widened', pattern: 'x', message: 'm', files: ['src/**', 4] },
      { id: 'bad', pattern: '(', message: 'm' },
      { id: '', pattern: 'x', message: 'm' },
      null,
    ],
  }

  assert.deepEqual(profileScanRules(settings), [
    { id: 'ok', pattern: 'moment', message: 'use date-fns', files: ['src/**'] },
    { id: 'plain', pattern: 'x', message: 'm', files: undefined },
  ])
  assert.deepEqual(profileScanRules({ scan: 'x' }), [])
  assert.deepEqual(profileScanRules({}), [])
})

test('a glob that cannot be compiled is reported where a profile gives one, and a scan rule with such a glob is dropped', () => {
  const problems = validateProfile({
    name: 'x',
    match: { paths: ['/p'] },
    standards: ['docs/**/*.md', 'src/[z-a]/*.md'],
    scan: [{ id: 'r', pattern: 'x', message: 'm', files: ['src/[z-a]/*.ts'] }],
  })

  assert.deepEqual(problems, ['"standards" has a glob that is not valid', '"scan[0].files" has a glob that is not valid'])
  assert.deepEqual(profileScanRules({ scan: [{ id: 'r', pattern: 'x', message: 'm', files: ['src/[z-a]/*.ts'] }, { id: 'ok', pattern: 'x', message: 'm', files: ['src/**'] }] }).map((rule) => rule.id), ['ok'])
})

test('a {files} placeholder inside quotes in a command is reported, because a file name would be shell code there', () => {
  const problems = validateProfile({ name: 'x', match: { paths: ['/p'] }, commands: { lint: 'eslint "{files}"', typecheck: 'tsc {files}', test: "vitest '{files}'" } })

  assert.deepEqual(problems, [
    '"commands.lint" has {files} inside quotes; write it bare, because fe-kit quotes each file name itself',
    '"commands.test" has {files} inside quotes; write it bare, because fe-kit quotes each file name itself',
  ])
})

test('interpolateEnv fills ${env:NAME} and lists the variables that are not set', () => {
  const { value, missing } = interpolateEnv('${env:HOST}/api?x=${env:MISSING}', { HOST: 'https://staging.example.com' })

  assert.equal(value, 'https://staging.example.com/api?x=${env:MISSING}')
  assert.deepEqual(missing, ['MISSING'])
})

test('loadProfiles marks a cyclic alias as broken and never echoes source text', async (t) => {
  const dir = await tempDir(t)
  await writeTree(dir, {
    'loop.md': '---\nname: loop\ntargets: &c { self: *c }\n---\n',
    'secret.md': '---\nname: [oops, glpat-SECRET\n---\n',
  })

  const [loop, secret] = await loadProfiles(dir)

  assert.match(loop.error, /cyclic/)
  assert.doesNotMatch(secret.error, /glpat-SECRET/)
  assert.equal(secret.error.includes('\n'), false)
})

test('loadProfiles reports a YAML error by its code and position, never by the source it quotes', async (t) => {
  const dir = await tempDir(t)
  await writeTree(dir, {
    'a-header.md': '---\nname: a\ntargets: |glpat-SECRET\n---\n',
    'b-alias.md': '---\nname: b\npassword: *glpat-SECRET\n---\n',
    'c-fine.md': '---\nname: c\npassword: !!glpat-SECRET value\n---\n',
  })

  const [header, alias, fine] = await loadProfiles(dir)

  assert.match(header.error, /^invalid YAML \(UNEXPECTED_TOKEN\) at line 2, column \d+ of the frontmatter$/)
  assert.equal(alias.error, 'invalid YAML (alias error)')
  assert.equal(fine.error, undefined)
  assert.equal(fine.data.password, 'value')
})

test('envNames lists the ${env:NAME} placeholders anywhere in a value, without reading the environment', () => {
  const names = envNames({ a: 'x ${env:ONE} y', b: ['${env:TWO}', { c: '${env:ONE}/${env:THREE}' }], d: 5, e: null })

  assert.deepEqual(names, ['ONE', 'TWO', 'ONE', 'THREE'])
})

test('validateProfile points at a literal password in a URL by path, and never repeats the password', () => {
  const problems = validateProfile({
    name: 'x',
    match: { remotes: ['https://oauth2:glpat-SECRET@gitlab.example.com/fe/x'] },
    targets: { staging: { url: 'https://admin:hunter2@staging.example.com' }, ok: { url: 'https://admin:${env:PW}@h' } },
    standards: ['see https://u:topsecret@wiki.example.com'],
  })

  assert.deepEqual(problems, [
    '"match.remotes[0]" has a literal password in a URL; use ${env:NAME} instead',
    '"targets.staging.url" has a literal password in a URL; use ${env:NAME} instead',
    '"standards[0]" has a literal password in a URL; use ${env:NAME} instead',
  ])
})

test('validateProfile never repeats a value in its messages, so a wrong tests.policy cannot carry a credential out', () => {
  const problems = validateProfile({ name: 'x', match: { paths: ['/p'] }, tests: { policy: 'https://u:FAKE_SECRET@h' } })

  assert.deepEqual(problems, [
    '"tests.policy" must be auto, commit or local-only',
    '"tests.policy" has a literal password in a URL; use ${env:NAME} instead',
  ])
})

test('redactCredentials hides the userinfo of every URL, whatever it holds, and leaves everything else alone', () => {
  const hidden = [
    ['https://admin:hunter2@host.example.com/app', 'https://[REDACTED]@host.example.com/app'],
    ['https://admin:p@ss@host.example.com', 'https://[REDACTED]@host.example.com'],
    ['https://admin:${env:PW}@host.example.com', 'https://[REDACTED]@host.example.com'],
    ['https://${env:USER}:${env:PW}@host.example.com', 'https://[REDACTED]@host.example.com'],
    ['https://${env:USER}@host.example.com/repo', 'https://[REDACTED]@host.example.com/repo'],
    ['https://pre${env:A}post@host.example.com/x', 'https://[REDACTED]@host.example.com/x'],
    ['https://u${env:}:FAKE_SECRET@host.example.com', 'https://[REDACTED]@host.example.com'],
    ['https://u${env:USER:FAKE_SECRET@host.example.com', 'https://[REDACTED]@host.example.com'],
    ['https://us$er:p$w{x}@host.example.com', 'https://[REDACTED]@host.example.com'],
    ['https://admin:pa?ss#x@host.example.com', 'https://[REDACTED]@host.example.com'], // a raw ? or # in a password must not end the userinfo
    ['ssh://git@host.example.com/repo.git', 'ssh://[REDACTED]@host.example.com/repo.git'],
    ['1http://u:p@h', '1http://[REDACTED]@h'], // whatever precedes the :// is irrelevant to hiding the userinfo
    ['-https://u:p@h', '-https://[REDACTED]@h'],
    ['://u:p@h', '://[REDACTED]@h'],
    [
      'x https://u:p1@h1 and https://v:p2@h2/z and https://w@h3',
      'x https://[REDACTED]@h1 and https://[REDACTED]@h2/z and https://[REDACTED]@h3',
    ],
  ]
  const untouched = [
    'plain text',
    'git@host.example.com:fe/app.git',
    'https://host.example.com:8080/path',
    'https://host.example.com/path?mail=a@b.example.com',
    'file:///C:/Users/me/notes.txt',
  ]

  assert.deepEqual(redactCredentials(hidden.map(([input]) => input)), hidden.map(([, expected]) => expected))
  assert.deepEqual(redactCredentials(untouched), untouched)
})

test('validateProfile warns about a literal password only: references, a bare username and no userinfo pass', () => {
  const warned = (url) => validateProfile({ name: 'x', match: { paths: ['/p'] }, targets: { staging: { url } } }).length > 0
  const literal = [
    'https://admin:hunter2@h',
    'https://admin:p@ss@h',
    'https://u:abc${env:X}@h',
    'https://${env:USER}:literal@h',
    'https://u${env:}:x@h',
    'https://u${env:USER:x@h',
    'https://u${env:@h', // malformed, and nothing after its colon to give it away
  ]
  const fine = [
    'https://${env:USER}:${env:PW}@h',
    'https://admin:${env:PW}@h',
    'https://${env:USER}@h/repo',
    'https://${env:A}${env:B}@h',
    'ssh://git@h/repo.git',
    'https://u:@h',
    'https://h/path',
  ]

  for (const url of literal) assert.equal(warned(url), true, url)
  for (const url of fine) assert.equal(warned(url), false, url)
})

test('keys that differ only in their credential stay separate entries after redaction', () => {
  const redacted = redactCredentials({ 'https://u:a@host': 1, 'https://v:b@host': 2, 'https://w:c@host': 3 })

  assert.deepEqual(redacted, {
    'https://[REDACTED]@host': 1,
    'https://[REDACTED]@host (2)': 2,
    'https://[REDACTED]@host (3)': 3,
  })
})

test('a credential in a map key is masked, and a field path never shows it', () => {
  const data = {
    name: 'x',
    match: { paths: ['/p'] },
    extras: { 'https://u:FAKE_SECRET@h': { url: 'https://v:OTHER_SECRET@h' } },
  }

  assert.deepEqual(redactCredentials(data.extras), { 'https://[REDACTED]@h': { url: 'https://[REDACTED]@h' } })
  assert.deepEqual(validateProfile(data), [
    '"extras.https://[REDACTED]@h" has a literal password in a URL; use ${env:NAME} instead',
    '"extras.https://[REDACTED]@h.url" has a literal password in a URL; use ${env:NAME} instead',
  ])
})

test('field paths carry the same unique safe label as the redacted keys', () => {
  const problems = validateProfile({
    name: 'x',
    match: { paths: ['/p'] },
    extras: { 'https://u:a@host': { url: 'https://v:b@h' }, 'https://u:c@host': { url: 'https://v:d@h' } },
  })

  const message = (path) => `"${path}" has a literal password in a URL; use \${env:NAME} instead`
  assert.deepEqual(problems, [
    message('extras.https://[REDACTED]@host'),
    message('extras.https://[REDACTED]@host.url'),
    message('extras.https://[REDACTED]@host (2)'),
    message('extras.https://[REDACTED]@host (2).url'),
  ])
})

test('redactCredentials takes linear time on long text that holds no URL, and on many :// without a userinfo', () => {
  const longWord = 'a'.repeat(100_000) // a pattern that starts at every letter of a long word is quadratic: seconds here
  const manySchemes = 'x://b'.repeat(20_000)
  const started = performance.now()

  const redacted = redactCredentials({ longWord, manySchemes, script: `${longWord} https://u:p@host` })

  assert.ok(performance.now() - started < 500, `took ${Math.round(performance.now() - started)} ms`)
  assert.equal(redacted.longWord, longWord)
  assert.equal(redacted.manySchemes, manySchemes)
  assert.equal(redacted.script, `${longWord} https://[REDACTED]@host`)
})

test('a profile with very many invalid entries is validated, not a crash', () => {
  const problems = validateProfile({ name: 'x', match: { remotes: ['a'] }, scan: Array.from({ length: 200_000 }, () => null), commands: {} })

  assert.ok(problems.length >= 200_000)
})
