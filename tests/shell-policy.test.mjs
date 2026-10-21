import assert from 'node:assert/strict'
import { mkdir, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { shellQuote } from '../src/lib/exec.mjs'
import { decideCommand, decidePath } from '../src/lib/shell-policy.mjs'
import { tempDir, writeTree } from './helpers.mjs'

/** A home folder with a secret store in both places, and a project folder to work from. */
async function setup(t, extraEnv = {}) {
  const home = await tempDir(t)
  const env = typeof extraEnv === 'function' ? extraEnv(home) : extraEnv
  await writeTree(home, { '.config/fe-kit/env': 'TOKEN=x\n', '.local/state/fe-kit/auth/p/t.json': '{}\n', 'project/a.txt': 'a\n', 'Code/fe-kit/README.md': 'r\n' })
  const context = { cwd: join(home, 'project'), home, env: { HOME: home, ...env } }
  return { home, context, at: (cwd) => ({ ...context, cwd }) }
}

const decide = (command, context) => decideCommand(command, context).decision

test('what changes history or the kit is asked about, in every form it can be called', async (t) => {
  const { context } = await setup(t)
  const asked = [
    'git commit -m x', 'git push', 'git push origin main', 'git reset --hard', 'git reset --hard HEAD~1', 'git reset HEAD~1 --hard',
    'git clean -fd', 'git clean -xdf', 'git clean --force', 'git clean -n -f',
    'git -c k=v commit', 'git -C ../x push', 'git --git-dir=.git commit', 'git --git-dir .git commit', 'git --no-pager push', 'git -p push',
    '/usr/bin/git push', 'env X=1 git commit', 'env -u X git push', 'env -i -C /tmp git push', 'command git push', 'builtin exec git push', 'exec git push', 'nohup git push', 'nice -n 5 git push',
    'sudo -u root git push', 'sudo git commit', 'timeout 5 git push', 'time git commit', '/usr/bin/time -p git push', 'X=1 Y=2 git push',
    `g'it' co"mmit"`, 'git pu\\sh', "$'g\\x69t' push",
    "bash -c 'git push'", 'sh -lc "git commit -m x"', 'zsh -ic "git push"', 'bash -c "bash -c \'git push\'"', "eval 'git push'", 'eval git push',
    'echo ok && git push', 'echo ok; git commit -m a', 'true || git push', 'ls | git push', 'echo a &\ngit push', '(git push)', 'echo $(git push)', 'echo `git commit`', 'echo "$(git push)"',
    'cat <<EOF\n$(git push)\nEOF\n', 'if true; then git push; fi', 'for f in a; do git commit -m $f; done', '! git push', '{ git push; }',
    'git -c alias.p=push p', 'git $sub', 'git "$@"', 'printf "push\\n" | xargs git', 'xargs git commit', 'xargs -n1 -I{} git push', 'find . -exec git push \\;', 'find . -name x -execdir git commit -m x {} +',
    'sh <<\'EOF\'\ngit push\nEOF\n', 'echo "git push" | sh', 'echo x | bash', 'bash', 'sh -s',
    'fe-kit ui-act --target x', 'fe-kit link', 'fe-kit unlink', 'fe-kit link --yes', 'fe-kit mr post 12', 'fe-kit mr publish 12',
    'node /x/bin/fe-kit.mjs ui-act', 'node --no-warnings /x/bin/fe-kit.mjs link --yes', 'node -r ./x.js /x/bin/fe-kit.mjs unlink', 'npx fe-kit ui-act', 'npx --yes fe-kit link', 'npx -p fe-kit fe-kit unlink', 'npm exec -- fe-kit link',
    'pnpm exec fe-kit unlink', 'pnpm dlx fe-kit link', 'yarn dlx fe-kit link', 'bunx fe-kit link', '/usr/local/bin/fe-kit link', 'X=1 fe-kit link', 'FOO=bar fe-kit mr post 3', 'fe-kit $sub',
    'echo "x', 'case x in a) b;; esac', 'f() { git status; }',
  ]
  for (const command of asked) assert.equal(decide(command, context), 'ask', command)
})

test('a command that only mentions those words, or does something else, is left alone', async (t) => {
  const { context } = await setup(t)
  const allowed = [
    'git status', 'git log --oneline', 'git diff', 'git reset --soft HEAD~1', 'git reset HEAD file', 'git clean -n', 'git clean -nd', 'git commit-graph write', 'git -c core.pager=cat log', 'git log --grep="git push"',
    'echo "git push"', 'echo git commit', "echo 'x; git push'", 'git status # git push', "printf '%s\\n' 'git commit'", "cat <<'EOF'\ngit push\nEOF\n", 'cat <<EOF\ngit push\nEOF\n', 'x=$(git rev-parse HEAD)', 'echo $(git status)',
    'fe-kit verify', 'fe-kit ui --target local', 'fe-kit mr preview 12', 'fe-kit mr fetch 12', 'fe-kit auth status --target a --role b', 'fe-kit dev start', 'fe-kit scan --json', 'fe-kit --version',
    'node script.js', 'node -e "console.log(1)"', 'node /x/other.mjs link', 'npm test', 'npm run build', 'npx vitest run', 'npm exec vitest', 'pnpm install', 'pnpm exec vitest',
    'ls -la', 'cat README.md', 'grep -r foo src', 'bash script.sh', 'sh ./run.sh', 'echo a > out.txt', 'cd src && cat a.ts', 'command -v git', 'xargs echo', 'find . -name "*.ts"', 'git log | head', 'true', '',
  ]
  for (const command of allowed) assert.equal(decide(command, context), 'allow', command)
})

test('every reason says what was found', async (t) => {
  const { context } = await setup(t)
  assert.match(decideCommand('git push', context).reason, /git push/)
  assert.match(decideCommand('git reset --hard', context).reason, /git reset --hard/)
  assert.match(decideCommand('fe-kit link', context).reason, /fe-kit link/)
  assert.match(decideCommand('fe-kit mr post 1', context).reason, /fe-kit mr post/)
  assert.match(decideCommand('echo "x', context).reason, /could not be read/)
  assert.match(decideCommand('echo hi', context).reason, /./)
})

test('a command line that is too long or nested too deep is asked about, not guessed', async (t) => {
  const { context } = await setup(t)
  assert.equal(decide(`echo ${'a'.repeat(300_000)}`, context), 'ask')
  const nested = (levels) => Array.from({ length: levels }).reduce((command) => `bash -c ${shellQuote(command)}`, 'ls')
  assert.equal(decide(nested(3), context), 'allow')
  assert.equal(decide(nested(6), context), 'ask')
  assert.match(decideCommand(nested(6), context).reason, /nested too deep/)
  assert.equal(decide(`echo ${'x '.repeat(20_000)}`, context), 'ask')
})

test('a lot of arguments is still checked quickly', async (t) => {
  const { context } = await setup(t)
  const began = performance.now()
  assert.equal(decide(`git add ${Array.from({ length: 3000 }, (_, index) => `src/file-${index}.ts`).join(' ')}`, context), 'allow')
  assert.ok(performance.now() - began < 2000)
})

test('the folders of saved logins and secrets cannot be read, by absolute path, ~, $HOME or ${HOME}', async (t) => {
  const { home, context } = await setup(t)
  const denied = [
    `cat ${home}/.local/state/fe-kit/auth/p/t.json`, 'cat ~/.local/state/fe-kit/auth/p/t.json', 'cat $HOME/.config/fe-kit/env', 'cat "${HOME}/.config/fe-kit/env"', 'head -c 10 ~/.config/fe-kit/env', 'tail ~/.config/fe-kit/env',
    'cat < ~/.config/fe-kit/env', 'echo x > ~/.config/fe-kit/env', 'echo x >> ~/.local/state/fe-kit/auth/p/t.json', 'cp ~/.config/fe-kit/env /tmp/x', 'cat ~/.config/fe-kit', 'open ~/.config/fe-kit/env',
    'grep -r token ~/.local/state/fe-kit', 'grep -r token ~/.local/state', 'rg token ~/.config', 'find ~ -name "*.json" -exec cat {} +', 'tar czf - ~/.config', 'rsync -a ~/.local/state/fe-kit /tmp/x',
    'cd ~/.config/fe-kit && cat env', 'cd ~/.local/state/fe-kit; cat auth/p/t.json', '(cd ~/.config/fe-kit; cat env)', 'cd ~/.config/fe-kit; grep -r x .', 'echo $(cat ~/.config/fe-kit/env)', 'echo "$(cat ~/.config/fe-kit/env)"',
    "bash -c 'cat ~/.config/fe-kit/env'", `sh -c "cat ${home}/.config/fe-kit/env"`, 'X=~/.config/fe-kit; cat $X/env', 'cat $(echo ~/.config/fe-kit/env)',
    "node -e \"require('fs').readFileSync(process.env.HOME+'/.config/fe-kit/env')\"", "python3 -c \"open('$HOME/.local/state/fe-kit/auth/p/t.json')\"", 'node <<EOF\nfs.readFileSync(process.env.HOME + "/.config/fe-kit/env")\nEOF\n',
    'cat ~/.local/state/fe-kit/auth/*/*.json', 'cat ~/.config/fe-*/env', 'cat ~/.local/state/*/auth/p/t.json', 'cat ~/.local/*/fe-kit/auth/p/t.json', 'cat ~/.l*/state/fe-kit/auth/p/t.json', 'cat ~/.config/fe-kit/e?v', 'cat ~/.config/fe-kit/[e]nv', 'grep -r x ~/.local/*', 'grep -r x ~/.*',
    'cat $HOME/.config/fe-kit/*', 'cat ~/.config/**/env', 'cat ~/.config/*/other',
  ]
  for (const command of denied) assert.equal(decide(command, context), 'deny', command)
})

test('the working directory counts: relative names inside a store are the store', async (t) => {
  const { home, at } = await setup(t)
  const state = join(home, '.local/state/fe-kit')
  const auth = join(state, 'auth')
  const config = join(home, '.config/fe-kit')
  assert.equal(decide('cat auth/p/t.json', at(state)), 'deny')
  assert.equal(decide('cat p/t.json', at(auth)), 'deny')
  assert.equal(decide('cat env', at(config)), 'deny')
  assert.equal(decide('grep -r x .', at(auth)), 'deny')
  assert.equal(decide('grep -r x', at(auth)), 'deny')
  assert.equal(decide('cat *', at(config)), 'deny')
  assert.equal(decide('cat ../env', at(join(config, 'sub'))), 'deny')
  assert.equal(decide('cat t.json', at(join(auth, 'p'))), 'deny')
  assert.equal(decide('cat auth/*/*.json', at(state)), 'deny')
  assert.equal(decide('ls', at(auth)), 'allow')
  assert.equal(decide('pwd', at(auth)), 'allow')
  assert.equal(decide('cd ..', at(auth)), 'allow')
  assert.equal(decide('cat README.md', at(join(home, 'Code/fe-kit'))), 'allow')
})

test('what only looks like a store, or only names one, is allowed', async (t) => {
  const { context } = await setup(t)
  const allowed = [
    'ls ~/.config/fe-kit', 'ls -la ~/.local/state/fe-kit/auth', 'echo ~/.config/fe-kit/env', 'printf "%s" ~/.config/fe-kit/env', 'cd ~/.config/fe-kit', 'cd ~/.config/fe-kit; pwd', 'cd ~/.config/fe-kit; ls',
    'cat ~/Code/fe-kit/README.md', 'cat ~/Code/fe-kit/src/lib/auth-store.mjs', 'cat ~/*/fe-kit/README.md', 'cat ~/*/env', 'cat ~/.local/*', 'cat ~/*.txt',
    'fe-kit auth status --target x --role y', 'FE_KIT_STATE_DIR=/tmp/s fe-kit auth status --target x --role y', 'cat project/a.txt', 'cat ./a.txt', 'cat /etc/hosts', 'git -C ~/Code/fe-kit status',
  ]
  for (const command of allowed) assert.equal(decide(command, context), 'allow', command)
})

test('a link into a store does not hide it', async (t) => {
  const { home, context, at } = await setup(t)
  const elsewhere = await tempDir(t)
  await symlink(join(home, '.config/fe-kit'), join(elsewhere, 'link'))
  await symlink(join(home, '.local/state/fe-kit'), join(home, 'project', 'shortcut'))
  assert.equal(decide(`cat ${elsewhere}/link/env`, context), 'deny')
  assert.equal(decide('cat link/env', at(elsewhere)), 'deny')
  assert.equal(decide('cat shortcut/auth/p/t.json', context), 'deny')
  assert.equal(decide('cat ./shortcut/auth/*/*.json', context), 'deny')
  assert.equal(decide(`ln -s ${home}/.config/fe-kit /tmp/never-made`, context), 'deny')
})

test('the folder FE_KIT_STATE_DIR points at is protected too, and so is the default when it is not set', async (t) => {
  const custom = await tempDir(t)
  await mkdir(join(custom, 'auth'), { recursive: true })
  const { home, context } = await setup(t, { FE_KIT_STATE_DIR: custom })
  assert.equal(decide(`cat ${custom}/auth/p/t.json`, context), 'deny')
  assert.equal(decide(`cat ${custom}/auth/*/*.json`, context), 'deny')
  assert.equal(decide('cat $FE_KIT_STATE_DIR/auth/p/t.json', context), 'deny') // the shell would expand it; the name of the variable is enough
  assert.equal(decide('cat "${FE_KIT_STATE_DIR}/auth/p/t.json"', context), 'deny')
  assert.equal(decide('cat ~/.local/state/fe-kit/auth/p/t.json', context), 'deny')
  assert.equal(decide(`cat ${home}/project/a.txt`, context), 'allow')
})

test('a dynamic word that cannot be worked out is not passed as plain if it names a store', async (t) => {
  const { context } = await setup(t)
  assert.equal(decide('cat "$X/.local/state/fe-kit/auth/p/t.json"', context), 'deny')
  assert.equal(decide('cat $(pwd)/.config/fe-kit/env', context), 'deny')
  assert.equal(decide('cat "$X/readme"', context), 'allow')
})

test('after a cd that cannot be followed, a reader of files is asked about', async (t) => {
  const { context } = await setup(t)
  assert.equal(decide('cd "$(git rev-parse --show-toplevel)" && cat README.md', context), 'ask')
  assert.equal(decide('cd $dir; grep -r x src', context), 'ask')
  assert.equal(decide('cd $dir && npm test', context), 'allow')
  assert.equal(decide('cd $dir && cat /etc/hosts', context), 'allow')
})

test('a file read through a tool is checked the same way', async (t) => {
  const { home, context, at } = await setup(t)
  assert.equal(decidePath(`${home}/.config/fe-kit/env`, context).decision, 'deny')
  assert.equal(decidePath('~/.local/state/fe-kit/auth/p/t.json', context).decision, 'deny')
  assert.equal(decidePath('auth/p/t.json', at(join(home, '.local/state/fe-kit'))).decision, 'deny')
  assert.equal(decidePath(`${home}/project/a.txt`, context).decision, 'allow')
  assert.equal(decidePath('a.txt', context).decision, 'allow')
  assert.equal(decidePath(`${home}/.config`, context).decision, 'allow')
  assert.equal(decidePath(`${home}/.config`, context, { search: true }).decision, 'deny') // a search from here would read the store
  assert.equal(decidePath(`${home}`, context, { search: true }).decision, 'deny')
  assert.equal(decidePath(`${home}/project`, context, { search: true }).decision, 'allow')
  assert.equal(decidePath(`${home}/.config/fe-kit/*`, context).decision, 'deny')
  assert.match(decidePath(`${home}/.config/fe-kit/env`, context).reason, /saved logins and secrets/)
  assert.equal(decidePath('', context).decision, 'allow')
  assert.equal(decidePath(undefined, context).decision, 'allow')
})

test('a deny wins over an ask, and a line that cannot be read still cannot name a store', async (t) => {
  const { context } = await setup(t)
  assert.equal(decideCommand('git push && cat ~/.config/fe-kit/env', context).decision, 'deny')
  assert.equal(decideCommand('cat ~/.config/fe-kit/env "', context).decision, 'deny')
  assert.equal(decideCommand('git push "', context).decision, 'ask')
})

test('programs that run a string or another program are followed', async (t) => {
  const { context } = await setup(t)
  const asked = [
    "find . -exec sh -c 'git push' \\;", "npx -c 'git push'", "env -S 'git push'", "env --split-string='git push'", "bash -o pipefail -c 'git push'", "bash --norc -c 'git push'", 'bash -c', 'bash -c "$cmd"',
    'sudo -- git push', 'git -ckey=val -calias.p=push p', 'eval "$cmd"', 'xargs -0 -n 1 git push', 'xargs -I {} git commit -m {}',
  ]
  for (const command of asked) assert.equal(decide(command, context), 'ask', command)
  assert.equal(decide('command -v git push', context), 'allow')
  assert.equal(decide('find . -exec cat ~/.config/fe-kit/env \\;', context), 'deny')
  assert.equal(decide("bash -c 'cat ~/.config/fe-kit/env; git push'", context), 'deny')
})

test('the layers that find a store do not all depend on one another', async (t) => {
  const { home, context, at } = await setup(t, (folder) => ({ FE_KIT_STATE_DIR: join(folder, 'state2') }))
  await mkdir(join(home, 'state2/auth/p'), { recursive: true })
  const elsewhere = await tempDir(t)
  await symlink(join(home, 'state2/auth'), join(elsewhere, 'link'))
  await symlink(home, join(elsewhere, 'homelink'))
  assert.equal(decide(`node -e "fs.readFileSync('${home}/state2/auth/p/t.json')"`, context), 'deny') // only the folder's own path says so
  assert.equal(decide('cat p/t.json', at(join(home, '.local/state/fe-kit/auth'))), 'deny') // the default store, although another one is set
  assert.equal(decide('cat link/*', at(elsewhere)), 'deny')
  assert.equal(decide(`grep -r x ${elsewhere}/homelink`, context), 'deny')
  assert.equal(decidePath('~/state2/auth/p/t.json', context).decision, 'deny')
  assert.equal(decidePath('~/state2/au*/p/t.json', context).decision, 'deny')
  assert.equal(decide('find', at(join(home, 'state2/auth'))), 'deny')
  assert.equal(decide('find', at(join(home, 'project'))), 'allow')
})

test('a home reached through a link, and a store reached by its real path', async (t) => {
  const { home } = await setup(t)
  const elsewhere = await tempDir(t)
  await symlink(home, join(elsewhere, 'homelink'))
  const context = { cwd: elsewhere, home: join(elsewhere, 'homelink'), env: { HOME: join(elsewhere, 'homelink') } }
  assert.equal(decide(`cat ${home}/.config/fe-kit/env`, context), 'deny')
  assert.equal(decide(`cat ${home}/project/a.txt`, context), 'allow')
})

test('globs that reach a store from a folder above it', async (t) => {
  const { context } = await setup(t)
  for (const command of ['cat ~/.config/f?-kit/env', 'cat ~/.config/[f]e-kit/env', 'cat ~/.config/[a-g]e-kit/env', 'cat ~/.local/**/t.json', 'cat ~/.local/state/**/t.json', 'cat ~/.local/s*/f?-kit/au*/*/t.json']) {
    assert.equal(decide(command, context), 'deny', command)
  }
  for (const command of ['cat ~/.config/g?-kit/env', 'cat ~/.config/[!f]e-kit/env', 'cat ~/.config/[a-e]e-kit/env', 'cat ~/.local/state/other/**/t.json', 'cat ~/.local/s*/g*/au*/t.json']) {
    assert.equal(decide(command, context), 'allow', command)
  }
})

test('options, subcommands and wrappers are read the way the programs read them', async (t) => {
  const { context } = await setup(t)
  assert.equal(decide('cd $dir && cat -n /etc/hosts', context), 'allow')
  assert.equal(decide('fe-kit mr --json post 1', context), 'ask')
  assert.equal(decide('printf x | xargs fe-kit', context), 'ask')
  assert.equal(decide('node -e 1 /x/bin/fe-kit.mjs link', context), 'allow')
  assert.equal(decide('find . -exec echo {} + -exec git push \\;', context), 'ask')
  assert.equal(decide('bun x fe-kit link', context), 'ask')
  assert.equal(decide('npm run git push', context), 'allow')
  assert.equal(decide('bash -s foo', context), 'ask')
  assert.equal(decide(`${'env '.repeat(11)}git status`, context), 'ask')
  assert.equal(decide(`${'env '.repeat(5)}git status`, context), 'allow')
  assert.equal(decide('$HOME/bin/git push', context), 'ask')
  assert.equal(decide('"$X"/git push', context), 'ask')
  assert.equal(decide('$cmd push', context), 'allow') // not known: out of scope, said so in the plan
  assert.equal(decide('/opt/*/git push', context), 'ask')
})

test('the roots of the stores are checked by their real path when the home itself is a link', async (t) => {
  const { home } = await setup(t)
  await mkdir(join(home, 'state2/auth/p'), { recursive: true })
  const elsewhere = await tempDir(t)
  await symlink(home, join(elsewhere, 'homelink'))
  const linked = join(elsewhere, 'homelink')
  const context = { cwd: elsewhere, home: linked, env: { HOME: linked, FE_KIT_STATE_DIR: join(linked, 'state2') } }
  assert.equal(decide(`cat ${home}/state2/auth/p/t.json`, context), 'deny')
  assert.equal(decide(`cat ${home}/project/a.txt`, context), 'allow')
})

test('a glob below a link that leads into a store, and a node call whose code is a path', async (t) => {
  const { home, context, at } = await setup(t)
  const elsewhere = await tempDir(t)
  await mkdir(join(home, '.local/state/fe-kit/auth/p/q'), { recursive: true })
  await symlink(join(home, '.local/state/fe-kit/auth'), join(elsewhere, 'link'))
  assert.equal(decide('cat link/p/*', at(elsewhere)), 'deny')
  assert.equal(decide('cat link/p/q/*', at(elsewhere)), 'deny')
  assert.equal(decide('node -e /x/bin/fe-kit.mjs link', context), 'allow')
})
