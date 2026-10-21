import assert from 'node:assert/strict'
import { test } from 'node:test'
import { commandsOf, parseShell, resolveWordPath } from '../src/lib/shell-tokens.mjs'

const parse = (line) => {
  const result = parseShell(line)
  assert.ok(result.ok, `${line} -> ${result.error}`)
  return result.root
}
const commands = (line, options = { cwd: '/p', home: '/h' }) => commandsOf(parse(line), options)
const texts = (command) => command.words.map((word) => word.text)
/** The words of every command that has any, in the order they were found. */
const lines = (line, options) => commands(line, options).map(texts).filter((words) => words.length > 0)
const cwdsOf = (line, index = -1, options) => {
  const found = commands(line, options).filter((command) => command.words.length > 0)
  return [...found.at(index).cwds].sort()
}

test('plain words, with the quotes taken off', () => {
  assert.deepEqual(lines('git commit -m "a b"'), [['git', 'commit', '-m', 'a b']])
  assert.deepEqual(lines(`g'it' co"mmit"`), [['git', 'commit']])
  assert.deepEqual(lines('g\\it push'), [['git', 'push']])
  assert.deepEqual(lines("$'g\\x69t' push"), [['git', 'push']])
  assert.deepEqual(lines("echo $'a\\nb' $'\\101'"), [['echo', 'a\nb', 'A']])
})

test('a backslash at the end of a line joins the lines, in and between words', () => {
  assert.deepEqual(lines('git \\\npush'), [['git', 'push']])
  assert.deepEqual(lines('gi\\\nt push'), [['git', 'push']])
  assert.deepEqual(lines('echo "a\\\nb"'), [['echo', 'ab']])
  assert.deepEqual(lines('git \\\n push'), [['git', 'push']])
})

test('the operator after each command is recorded', () => {
  assert.deepEqual(
    parse('a; b && c || d | e & f\ng').items.map((item) => item.op),
    [';', '&&', '||', '|', '&', '\n', null],
  )
  assert.deepEqual(parse('a |& b').items.map((item) => item.op), ['|&', null])
  assert.deepEqual(parse('a &&\n b').items.map((item) => item.op), ['&&', null])
})

test('command substitutions run commands: bare, in backticks, in double quotes, nested, in ${…}', () => {
  assert.deepEqual(lines('echo $(git push)'), [['echo', '$(git push)'], ['git', 'push']])
  assert.deepEqual(lines('echo `git push`'), [['echo', '`git push`'], ['git', 'push']])
  assert.deepEqual(lines('echo "x $(git push)"'), [['echo', 'x $(git push)'], ['git', 'push']])
  assert.deepEqual(lines('echo $(echo $(git push))').at(-1), ['git', 'push'])
  assert.deepEqual(lines('echo ${x:-$(git push)}').at(-1), ['git', 'push'])
  assert.deepEqual(lines('echo `echo \\`git push\\``').at(-1), ['git', 'push'])
  assert.ok(commands('echo $(git push)')[0].words[1].dynamic)
  assert.deepEqual(lines('echo `echo \\$(git push)`').at(-1), ['git', 'push'])
  assert.deepEqual(lines('echo `echo \\\\`').at(-1), ['echo', '\\'])
})

test('single quotes and a backslash keep a substitution from running', () => {
  assert.deepEqual(lines("echo '$(git push)'"), [['echo', '$(git push)']])
  assert.deepEqual(lines('echo "\\$(git push)"'), [['echo', '$(git push)']])
  assert.ok(!commands("echo '$(git push)'")[0].words[1].dynamic)
})

test('a here-document is data unless it goes to a shell; an unquoted one still runs substitutions', () => {
  const unquoted = commands('cat <<EOF\n$(git push)\nEOF\n')
  assert.deepEqual(unquoted.map(texts), [['cat'], ['git', 'push']])
  assert.equal(unquoted[0].heredocs[0].body, '$(git push)\n')
  assert.equal(unquoted[0].heredocs[0].quoted, false)

  const quoted = commands("cat <<'EOF'\n$(git push)\nEOF\n")
  assert.deepEqual(quoted.map(texts), [['cat']])
  assert.equal(quoted[0].heredocs[0].quoted, true)

  const toShell = commands("sh <<'EOF'\ngit push\nEOF\n")
  assert.deepEqual(toShell.map(texts), [['sh']])
  assert.equal(toShell[0].heredocs[0].body, 'git push\n')
})

test('here-documents: tabs stripped by <<-, two on one line, a command after, unterminated', () => {
  assert.equal(commands('cat <<-EOF\n\t\tx\n\tEOF\n')[0].heredocs[0].body, 'x\n')
  assert.deepEqual(commands('cat <<A <<B\na\nA\nb\nB\n')[0].heredocs.map((heredoc) => heredoc.body), ['a\n', 'b\n'])
  assert.deepEqual(lines('cat <<EOF\nx\nEOF\ngit push'), [['cat'], ['git', 'push']])
  const open = commands('cat <<EOF\nabc')
  assert.equal(open[0].heredocs[0].unterminated, true)
  assert.equal(open[0].heredocs[0].body, 'abc')
})

test('a here-string is a redirection of one word', () => {
  const [cat] = commands('cat <<< "git push"')
  assert.deepEqual(cat.redirects.map((r) => [r.op, r.target.text]), [['<<<', 'git push']])
  assert.equal(commands('cat <<< "git push"').length, 1)
})

test('comments end at the line, but only at the start of a word', () => {
  assert.deepEqual(lines('echo a # git push'), [['echo', 'a']])
  assert.deepEqual(lines('echo a#b'), [['echo', 'a#b']])
  assert.deepEqual(lines('echo a;# git push\ngit status'), [['echo', 'a'], ['git', 'status']])
})

test('what cannot be split is refused, never guessed', () => {
  for (const line of ['; a', 'a ;; b', '&& a', '| a', 'a & & b', 'a ( b )', 'echo "a', "echo 'a", 'echo $(a', 'echo `a', '(a', 'a &&', 'a |', '(a) b', ')', 'echo a)', 'case x in a) git push;; esac', 'f() { a; }']) {
    assert.equal(parseShell(line).ok, false, line)
  }
  assert.match(parseShell('echo "a').error, /./)
})

test('leading assignments are kept apart from the command', () => {
  const [git] = commands('X=1 Y="a b" git commit')
  assert.deepEqual(git.assigns.map((word) => word.text), ['X=1', 'Y=a b'])
  assert.deepEqual(texts(git), ['git', 'commit'])
  assert.deepEqual(commands('echo X=1')[0].assigns, [])
  assert.deepEqual(lines('X=$(git push) true').at(-1), ['git', 'push'])
})

test('shell keywords in front of a command are not the command', () => {
  assert.deepEqual(lines('if true; then git push; fi'), [['true'], ['git', 'push']])
  assert.deepEqual(lines('for f in a b; do git push; done').at(-1), ['git', 'push'])
  assert.deepEqual(lines('! git push'), [['git', 'push']])
  assert.deepEqual(lines('{ git push; }'), [['git', 'push']])
  assert.deepEqual(lines('while read x; do git push; done'), [['read', 'x'], ['git', 'push']])
  assert.deepEqual(lines('"if" x then'), [['if', 'x', 'then']])
  assert.deepEqual(lines("echo then; 'do' x"), [['echo', 'then'], ['do', 'x']])
})

test('a subshell and a process substitution run their commands', () => {
  assert.deepEqual(lines('(git push)'), [['git', 'push']])
  assert.deepEqual(lines('(git push) > out'), [['git', 'push']])
  assert.deepEqual(lines('cat <(git push)').at(-1), ['git', 'push'])
  assert.deepEqual(lines('(true) > $(git push)').at(-1), ['git', 'push'])
  assert.deepEqual(lines('(true) <<EOF\n$(git push)\nEOF\n').at(-1), ['git', 'push'])
})

test('redirections are kept with their file descriptor and target', () => {
  const [cat] = commands('cat < ~/x >> out 2>&1')
  assert.deepEqual(cat.redirects.map((r) => [r.fd, r.op, r.target.text]), [[null, '<', '~/x'], [null, '>>', 'out'], ['2', '>&', '1']])
  assert.equal(cat.redirects[0].target.tilde, true)
  assert.deepEqual(commands('echo 2 > f')[0].words.map((word) => word.text), ['echo', '2'])
  assert.deepEqual(commands('echo x &> f')[0].redirects.map((r) => [r.fd, r.op, r.target.text]), [[null, '&>', 'f']])
})

test('a word says whether the shell would expand it', () => {
  const [, tilde, home, glob, quotedHome, literal] = commands(`cat ~/a $HOME/b *.json "$HOME/c" '$HOME'`)[0].words
  assert.equal(tilde.tilde, true)
  assert.deepEqual([home.dynamic, home.text], [true, '$HOME/b'])
  assert.equal(glob.glob, true)
  assert.deepEqual([quotedHome.dynamic, quotedHome.quoted], [true, true])
  assert.deepEqual([literal.dynamic, literal.glob, literal.tilde], [false, false, false])
  assert.equal(commands('git{,} push')[0].words[0].dynamic, true)
  assert.equal(commands('echo "*"')[0].words[1].glob, false)
  assert.equal(commands('echo a~/b')[0].words[1].tilde, false)
  assert.deepEqual(commands('echo $1 $@ $? $$ $_x')[0].words.slice(1).map((word) => word.dynamic), [true, true, true, true, true])
  assert.equal(commands('echo $ x')[0].words[1].dynamic, false)
})

test('arithmetic is not a command; a substitution inside it still is', () => {
  assert.deepEqual(lines('echo $((1+2))'), [['echo', '$((1+2))']])
  assert.deepEqual(lines('echo $((1<<2))'), [['echo', '$((1<<2))']])
  assert.deepEqual(lines('echo $(( $(git push) + 1 ))').at(-1), ['git', 'push'])
  assert.deepEqual(lines('echo $((a; git push))').at(-1), ['git', 'push'])
  assert.deepEqual(lines('echo $((a & git push))').at(-1), ['git', 'push'])
  assert.deepEqual(lines('echo $(( `git push` ))').at(-1), ['git', 'push'])
})

test('paths in words are resolved against the working directory and home', () => {
  const word = (text) => commands(`cat ${text}`)[0].words[1]
  assert.equal(resolveWordPath(word('a/b'), '/p', '/h'), '/p/a/b')
  assert.equal(resolveWordPath(word('/x/../y'), '/p', '/h'), '/y')
  assert.equal(resolveWordPath(word('~/a'), '/p', '/h'), '/h/a')
  assert.equal(resolveWordPath(word('~'), '/p', '/h'), '/h')
  assert.equal(resolveWordPath(word('$HOME/a'), '/p', '/h'), '/h/a')
  assert.equal(resolveWordPath(word('"${HOME}/a"'), '/p', '/h'), '/h/a')
  assert.equal(resolveWordPath(word("'$HOME/a'"), '/p', '/h'), '/p/$HOME/a') // single quotes: a literal name
  assert.equal(resolveWordPath(word('~bob/a'), '/p', '/h'), null)
  assert.equal(resolveWordPath(word('$dir/a'), '/p', '/h'), null)
  assert.equal(resolveWordPath(word('$HOME/$x'), '/p', '/h'), null)
  assert.equal(resolveWordPath(word('a/*.json'), '/p', '/h'), null)
  assert.equal(resolveWordPath(word('a'), null, '/h'), null)
  assert.equal(resolveWordPath(word('/abs'), null, '/h'), '/abs')
})

test('cd changes the working directory the later commands may run in', () => {
  assert.deepEqual(cwdsOf('cd "$HOME/.local/state/fe-kit"; cat auth/p/t.json'), ['/h/.local/state/fe-kit', '/p'])
  assert.deepEqual(cwdsOf('cd x && cat a'), ['/p', '/p/x'])
  assert.deepEqual(cwdsOf('cd a; cd b; cat c'), ['/p', '/p/a', '/p/a/b', '/p/b'])
  assert.deepEqual(cwdsOf('cd; cat a'), ['/h', '/p'])
  assert.deepEqual(cwdsOf('cd -P /x; cat a'), ['/p', '/x'])
  assert.deepEqual(cwdsOf('pushd /x; cat a'), ['/p', '/x'])
  assert.deepEqual(cwdsOf('cd; cat a'), ['/h', '/p'])
  assert.deepEqual(cwdsOf('cd /x || cat a'), ['/p', '/x'])
})

test('a directory that cannot be worked out is null, and null stays null', () => {
  assert.ok(cwdsOf('cd $dir; cat a').includes(null))
  assert.ok(cwdsOf('cd -; cat a').includes(null))
  assert.ok(cwdsOf('cd "$(pwd)/x"; cat a').includes(null))
  assert.ok(cwdsOf('cd *; cat a').includes(null))
  assert.ok(cwdsOf('popd; cat a').includes(null))
  assert.ok(!cwdsOf('popd +1; cat a').includes('/p/+1'))
  assert.ok(cwdsOf('pushd; cat a').includes(null)) // no argument swaps two directories of a stack that is not tracked
  assert.ok(!cwdsOf('pushd; cat a').includes('/h'))
  assert.deepEqual(cwdsOf('cd /x; cat a', -1, { cwd: null, home: '/h' }), ['/x', null]) // sorted as text: null after a path
  assert.deepEqual(cwdsOf('cat a', -1, { cwd: null, home: '/h' }), [null])
})

test('a change of directory inside a subshell, a pipeline or a substitution does not reach the parent', () => {
  assert.deepEqual(cwdsOf('(cd /x); cat a'), ['/p'])
  assert.deepEqual(cwdsOf('cd /x | cat a'), ['/p'])
  assert.deepEqual(cwdsOf('cat a | cd /x'), ['/p'])
  assert.deepEqual(cwdsOf('cat a | cd /x; cat b'), ['/p'])
  assert.deepEqual(cwdsOf('cd /x & cat a'), ['/p'])
  assert.deepEqual(cwdsOf('echo $(cd /x); cat b'), ['/p'])
  assert.deepEqual(cwdsOf('echo $(cd /x; cat a)', -1), ['/p', '/x'])
  assert.deepEqual(cwdsOf('(cd /x; cat a)'), ['/p', '/x'])
})

test('commands in every nested place are found, with the directory they would run in', () => {
  const found = commands('cd /x; echo $(cat a) && (cat b)')
  assert.deepEqual(found.map(texts).filter((words) => words.length), [['cd', '/x'], ['echo', '$(cat a)'], ['cat', 'a'], ['cat', 'b']])
  for (const command of found.slice(1)) assert.deepEqual([...command.cwds].sort(), ['/p', '/x'])
})

test('input that is too long or nested too deep is refused', () => {
  assert.equal(parseShell(`${'$('.repeat(40)}x${')'.repeat(40)}`).ok, false)
  assert.match(parseShell(`${'$('.repeat(40)}x${')'.repeat(40)}`).error, /deep/)
  assert.equal(parseShell('a '.repeat(200_000)).ok, false)
  assert.match(parseShell('a '.repeat(200_000)).error, /long/)
})

test('here-documents inside substitutions inside here-documents count towards the depth limit', () => {
  let body = 'x\n'
  for (let level = 0; level < 40; level++) body = `$(cat <<E${level}\n${body}E${level}\n)\n`
  const result = parseShell(`cat <<E\n${body}E\n`)
  assert.equal(result.ok, false)
  assert.match(result.error, /deep/)
})

test('whatever the input, reading it either succeeds or says no; it never throws', () => {
  const alphabet = ['a', ' ', "'", '"', '`', '$', '(', ')', '{', '}', '<', '>', '|', '&', ';', '\\', '\n', '#', '=', '~', '*', 'EOF', '<<', '$(', '${', '$((', '))']
  let seed = 12345
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648)
  for (let run = 0; run < 4000; run++) {
    let line = ''
    for (let length = next() % 24; length > 0; length--) line += alphabet[next() % alphabet.length]
    const result = parseShell(line)
    assert.equal(typeof result.ok, 'boolean', line)
    if (result.ok) commandsOf(result.root, { cwd: '/p', home: '/h' })
  }
})

test('a long command is parsed in a time that grows with its length', () => {
  const began = performance.now()
  for (const line of ['a '.repeat(100_000), `echo "${'x '.repeat(100_000)}"`, `echo $(${'a;'.repeat(50_000)})`, `echo ${'$x'.repeat(50_000)}`, `cat <<EOF\n${'a\n'.repeat(100_000)}EOF\n`]) {
    assert.equal(parseShell(line).ok, true)
  }
  assert.ok(performance.now() - began < 3000)
})
