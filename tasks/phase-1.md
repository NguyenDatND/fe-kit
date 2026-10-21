# Phase 1 (phần không phụ thuộc GUI) — Implementation Plan

> **For agentic workers:** dùng `superpowers:executing-plans` (làm tại chỗ). Mỗi task: viết test trước, thấy test đỏ, viết code tối thiểu, thấy test xanh. Không commit khi chưa hỏi.

**Goal:** Có CLI `fe-kit` chạy được `context`, `init`, `validate` trên Node ≥ 20 (không bash), cùng bảng đích `tools.mjs` ghi sẵn các kết quả đã kiểm ở Phase 0.

**Architecture:** `bin/fe-kit.mjs` chỉ phân lệnh. Mỗi lệnh là module `src/commands/<tên>.mjs` xuất `run({ args, flags, cwd, env })` trả `{ data, text, exitCode }` để test không cần spawn tiến trình. Logic dùng chung nằm ở `src/lib/`. Test dùng `node:test`, mọi thao tác file trong thư mục tạm.

**Tech Stack:** Node ≥ 20 (ESM), `node:test`, `yaml`. Chưa cần `playwright` và `smol-toml` (Phase 3 và `link`).

**Spec:** `docs/plan.md` §3, §4, §5.3, §5.4, §6, §10 (Phase 1), §11; `docs/spike.md`.

## Global constraints

- Chỉ Node, không script bash. Đường dẫn dùng `node:path` và `os.homedir()`.
- Không đụng thư mục toàn cục của bạn (`~/.claude`, `~/.codex`, `~/.gemini`): phần `link`, `doctor`, hook, cài superpowers để sau. Test dùng `os.tmpdir()`.
- Lệnh `lint`/`test` lấy từ `package.json` lúc chạy; hồ sơ chỉ ghi đè (plan §3 nguyên tắc 3). Không tự bịa lệnh.
- Output của CLI bằng tiếng Anh (agent đọc), tài liệu bằng tiếng Việt. Lệnh nào cũng có `--json`.
- Không commit, không push.

## Review Focus

Các tình huống plan ngầm giả định nhưng không test nào bao phủ; mỗi dòng có test ở task sở hữu:

1. `init` trong repo mà `.gitignore` đã ignore `.fe-kit/`, hoặc chạy lần thứ hai: không đổi gì, không trùng dòng.
2. `init` khi `AGENTS.md` đã là file thật, hoặc `CLAUDE.md` là symlink tới `AGENTS.md`: không đụng, không tạo vòng lặp.
3. `context` chạy ngoài repo git, hoặc trong `packages/web` của monorepo: nói rõ gốc nào dùng cho nháp và gốc nào dùng cho lệnh.
4. `detect` gặp `package.json` hỏng JSON: không crash, báo lỗi rõ.
5. `profile` khớp remote `git@host:fe/shop-web.git` với `https://host/fe/shop-web` (khác giao thức, `.git`, hoa thường).
6. `fsx` với đường dẫn có dấu cách và ký tự Unicode; không bao giờ ghi đè thứ nó không tạo.
7. `validate` với `description` có dấu `:` không bọc quote (đã làm skill không nạp trên `agy`, `docs/spike.md` §3.S1).

---

### Task 1: Khung repo và tài liệu nền

**Files:** Create `package.json`, `README.md`, `AGENTS.md`, `CLAUDE.md`, `NOTICE.md`, `UPSTREAM.md`, `docs/adr/0001-superpowers-la-quy-trinh.md`, `0002-khong-dung-rulesync.md`, `0003-nhap-trong-fe-kit.md`, `0004-skill-chia-hai-loai.md`; Modify `.gitignore`.

**Interfaces:** Produces `npm test` = `node --test`; `bin` = `fe-kit` → `bin/fe-kit.mjs`; `engines.node` = `>=20`.

- [x] `npm install yaml`; kiểm `npm test` chạy được khi chưa có test (exit 0).
- [x] ADR ngắn (bối cảnh, quyết định, hệ quả), mỗi ADR dẫn bằng chứng từ `docs/spike.md` khi có.
- [x] `NOTICE.md` và `UPSTREAM.md` ghi nguồn, license và SHA theo plan §9.

### Task 2: `src/lib/fsx.mjs` — symlink, junction, copy, backup

**Files:** Create `src/lib/fsx.mjs`, `tests/fsx.test.mjs`, `tests/helpers.mjs`.

**Interfaces:**
- `defaultLinkMode(platform = process.platform): 'symlink' | 'junction'`
- `installDirectory(source: string, target: string, opts?: { mode?: 'symlink'|'junction'|'copy', dryRun?: boolean }): Promise<{ action: 'create'|'update'|'unchanged'|'skip-foreign', mode: string, target: string }>`
- `removeInstalled(target: string, opts?: { source?: string, dryRun?: boolean }): Promise<{ action: 'removed'|'skip-foreign'|'missing', target: string }>` (một symlink chỉ bị gỡ khi có `source` và nó trỏ đúng vào đó, vì không có cách nào khác để biết nó của kit)
- `backupFile(file: string, backupDir: string, opts?: { now?: () => Date }): Promise<string>` (trả đường dẫn bản sao có dấu thời gian; không bao giờ ghi đè bản sao trước; `now` để test tiêm đồng hồ)
- `exists(path)`, `lstatOrNull(path)`, `isInside(path, parent)`: helper dùng chung.
- Bản copy ghi file `.fe-kit-managed` (JSON: đường dẫn nguồn và hash cây nguồn). Hash trùng thì `unchanged`, nên chạy lần hai không đổi gì; bản copy chỉ bị thay khi nguồn đổi (sửa tay trong bản copy tồn tại tới lúc đó). Cập nhật bằng cách copy sang thư mục tạm cạnh đích rồi `rename`, nên lỗi giữa chừng không làm mất bản cũ. Dấu chỉ có giá trị khi là **file thường** chứa JSON `{ source: string, hash: string }`; dấu rỗng, hỏng, là symlink hay là thư mục thì thư mục đó của người khác (`skip-foreign`, không bao giờ bị xoá, cả lúc cài lẫn lúc gỡ). Thư mục tạm có tên ngẫu nhiên (UUID) và chỉ thư mục do chính lời gọi tạo mới bị dọn. Khôi phục bản cũ không được thì bản cũ ở nguyên chỗ, dù thứ gì đang nằm ở `target` (không gì chứng minh đó là bản thay thế hợp lệ), và lỗi nói đường dẫn của nó. Lỗi khi dọn thư mục tạm không được thay thế lỗi đó: thông báo của nó được nối thêm vào. Nguồn là symlink tới thư mục được phân giải trước khi copy. Đường dẫn trùng tên dấu mà nguồn mang tới bị xoá khỏi bản tạm, rồi dấu thật được tạo bằng cờ `wx`, nên lần ghi không đi xuyên qua symlink.

**Tests:** tạo symlink rồi gọi lại = `unchanged`; đích là thư mục thật không có dấu = `skip-foreign` và nội dung không đổi; đích là symlink trỏ chỗ khác = `skip-foreign`; mode `copy` tạo dấu, nguồn không đổi = `unchanged`, nguồn đổi = `update` và không để lại thư mục tạm; cập nhật lỗi vẫn giữ bản cũ; `dryRun` báo hành động (cả `update` và `removed`) nhưng không đổi đĩa; `removeInstalled` chỉ xoá thứ do kit tạo; `backupFile` giữ nguyên nội dung và không ghi đè khi trùng mili giây; `defaultLinkMode('win32') === 'junction'`; đường dẫn có dấu cách và Unicode ở cả hai mode; dấu rỗng, không phải JSON, sai hình dạng, là thư mục hoặc symlink không được coi là của kit (cả cài lẫn gỡ); dấu là symlink do nguồn mang tới không bị đi theo; thư mục lạ đứng ở tên tạm kiểu cũ vẫn nguyên; hai lời gọi đồng thời không để lại thư mục tạm; nguồn là symlink tới thư mục vẫn được copy như thư mục và nguồn không nhận dấu; chèn lỗi vào `rename` và `cp` (`injectFs`): lỗi kép giữ bản cũ và nêu đường dẫn, lỗi đơn khôi phục được, `target` bị chiếm bởi thư mục không dấu, file hay symlink thì bản cũ vẫn được giữ, `cp` hỏng giữa chừng không để lại gì; lỗi dọn thư mục tạm không che đường dẫn bản cũ.

### Task 3: `src/lib/git.mjs` và `src/lib/detect.mjs`

**Files:** Create `src/lib/git.mjs`, `src/lib/detect.mjs`, `tests/git.test.mjs`, `tests/detect.test.mjs`.

**Interfaces:**
- `findProjectRoot(cwd: string, opts?: { home?: string }): Promise<{ root: string, isGit: boolean }>` (luôn là đường dẫn thật; git top-level; ngoài git thì thư mục gần nhất có `package.json`, không có thì `cwd`. Ngoài git, `package.json` nằm ở thư mục home hoặc cao hơn không tính, để `~/package.json` lạc loài không biến mọi thư mục dưới home thành dự án)
- `findPackageRoot(cwd: string, stopAt: string): Promise<string | null>` (thư mục gần nhất đi lên có `package.json`)
- `getRemotes(root: string): Promise<string[]>`
- `getExcludeFile(root: string): Promise<string | null>` (đường dẫn `info/exclude` thật của repo, vì worktree và submodule không để nó ở `.git/`)
- `listTracked(root: string, path: string): Promise<string[]>` (`git ls-files`: các file git đang theo dõi dưới `path`; `[]` khi không có, `null` khi git không trả lời được, ví dụ chỉ mục hỏng, để không nhầm với "không có")
- `detectStack(packageRoot: string, opts?: { projectRoot?: string }): Promise<{ packageManager, language, uiLibrary, framework, testRunner, monorepo, scripts, error? }>`
- `scriptCommand(packageManager: string | null, script: string): string` (luôn `<pm> run <script>`, `npm` khi chưa biết: `npm run test`, `pnpm run lint`…)
- `deriveCommands(stack): { dev, build, lint, typecheck, test }` (từ `package.json` scripts; không có script thì `null`)

**Tests:** trường `packageManager` (của gói rồi tới gốc dự án) thắng lockfile; lockfile theo thứ tự pnpm, yarn, bun, npm; Vite + React + TS + vitest (giống sandbox); Next + jest + pnpm + `turbo.json` là monorepo kèm workspaces; Angular; JS thuần; `package.json` hỏng JSON, hoặc JSON hợp lệ nhưng không phải object (`null`, mảng, chuỗi, số), trả `error` thay vì ném lỗi; trường sai kiểu (`scripts`, `dependencies`, `workspaces`, `packageManager`) bị bỏ qua và chỉ script là chuỗi mới tính; `findPackageRoot` từ `packages/web` trả `packages/web`; `getRemotes` trong repo có remote; ngoài git `isGit === false`.

### Task 4: `src/lib/profile.mjs`

**Files:** Create `src/lib/profile.mjs`, `src/lib/frontmatter.mjs` (`splitFrontmatter`, `parseFrontmatter`, dùng chung với `validate`), `tests/profile.test.mjs`, `tests/frontmatter.test.mjs`.

**Interfaces:**
- `parseProfile(text: string): { data: object, body: string }` (frontmatter YAML + phần lời)
- `loadProfiles(dir: string): Promise<Array<{ file: string, data: object, body: string, error?: string }>>` (thư mục không tồn tại = rỗng; file không đọc được mang `error` và bị `matchProfile` bỏ qua. `error` của lỗi YAML chỉ gồm mã lỗi và vị trí (`describeYamlError`): thông báo của thư viện trích đoạn nguồn kể cả ở dòng đầu (header block scalar, tên alias), và parser còn tự in cảnh báo kèm dòng nguồn ra stderr nếu không đặt `logLevel: 'error'`. Alias vòng cũng là lỗi vì kết quả không serialize hay duyệt được)
- `matchProfile(profiles, { root: string, remotes: string[] }): Promise<profile | null>` (async vì phân giải symlink của đường dẫn trong hồ sơ; giá trị sai kiểu bị bỏ qua, không làm sập)
- `normalizeRemote(url: string): string` (`git@host:a/b.git` và `https://host/a/b` cùng ra `host/a/b`, chữ thường)
- `validateProfile(data: object): string[]` (danh sách vấn đề: thiếu `name`, `match.paths` hoặc `match.remotes` không phải danh sách chuỗi, `match` không có cái nào, `tests.policy` ngoài `auto|commit|local-only`). `context` kiểm **mọi** hồ sơ, không chỉ cái khớp. Cũng báo mật khẩu viết thẳng trong URL (`scheme://user:mật-khẩu@host`) theo đường dẫn của trường, ví dụ `"targets.staging.url"`, không bao giờ lặp lại mật khẩu. Đường dẫn dùng khoá đã che, và không thông báo nào lặp lại một giá trị (một `tests.policy` sai chỉ nêu các lựa chọn hợp lệ).
- `redactCredentials(value: unknown): unknown` (bản sao, kể cả khoá của map, trong đó **userinfo của mọi URL không bao giờ được in**, bất kể nó chứa gì: `scheme://user:mật-khẩu@host` thành `scheme://[REDACTED]@host`, và cả `${env:NAME}`, `${env:` dở dang, token làm username đều bị che. Che hết thì không cần phân tích, nên không có hình dạng userinfo nào lọt được; đổi sang cách này ở lượt 5 sau khi cách che đúng chỗ mật khẩu bị tìm ra kẽ hở mỗi lượt. Không che: dạng không có `://` (`user:pw@host`, `git@host:path`), token trong query hay văn bản tự do. Mẫu chỉ tìm `://userinfo@` và không khớp scheme, vì khớp scheme làm regex thử lại ở từng chữ cái của một từ dài, tức bậc hai (80.000 ký tự mất 2,7 giây); không có scheme thì tuyến tính (4 triệu ký tự mất 1 ms). Hai khoá chỉ khác phần userinfo thành `…@host` và `…@host (2)`, không gộp làm một)
- `interpolateEnv(text: string, env: object): { value: string, missing: string[] }` (`${env:NAME}`; hiện chưa có nơi gọi trong `src/` vì `context` không còn nội suy, để dành cho `ui` ở Phase 3, hỏi bạn trước khi xoá)
- `envNames(value: unknown): string[]` (tên biến `${env:NAME}` ở mọi chỗ trong chuỗi, danh sách và map; không đọc giá trị)

**Tests:** parse có và không có frontmatter; khớp theo `paths` (có `~`) và theo `remotes` (ssh so với https, `.git`, hoa thường); không khớp trả `null`; `validateProfile` báo đúng từng lỗi; `interpolateEnv` liệt kê biến thiếu; lỗi YAML chỉ còn một dòng và không chứa đoạn nguồn; alias vòng bị báo `error`.

### Task 5: `src/commands/context.mjs` và `bin/fe-kit.mjs`

**Files:** Create `src/commands/context.mjs`, `bin/fe-kit.mjs`, `tests/context.test.mjs`.

**Interfaces:**
- Mọi lệnh: `run({ args: string[], flags: object, cwd: string, env: object, kitRoot: string }): Promise<{ data: object, text: string, exitCode?: number }>`
- `context` trả `data = { cwd, projectRoot, isGit, packageRoot, profile: {name,file,baseBranch,roles,standards,targets,env}|null, stack, commands: {dev,build,lint,typecheck,test}, tests: {policy, projectHasTestSetup}, drafts: {dir, initialized, ignored, trackedFiles}, conventions: {claudeMd, agentsMd} }`
- Gốc nháp = `projectRoot`; stack và lệnh lấy từ `packageRoot`. Lệnh của hồ sơ ghi đè lệnh dò được. Thư mục hồ sơ: `FE_KIT_PROFILES_DIR` hoặc `<kitRoot>/profiles`.
- `targets` không bị nội suy `${env:NAME}`; `profile.env` ghi `set` hoặc `missing` cho từng biến và không bao giờ có giá trị (một giá trị nội suy có thể là mật khẩu, mà `--json` đi thẳng vào ngữ cảnh của mô hình). `drafts.ignored` nghĩa là luật cuối của `.fe-kit/.gitignore` (một file thường, đọc như git đọc) là `*`; `drafts.trackedFiles` là số file git đang theo dõi dưới `.fe-kit` (`null` khi git không trả lời được), mà ignore không áp dụng cho chúng. Cả hai có cảnh báo. Mọi thứ `context` in ra đi qua `redactCredentials` một lần ở cuối (hồ sơ, scripts của `package.json`, cảnh báo), nên userinfo của mọi URL thành `[REDACTED]` (một URL cần đăng nhập lấy thông tin từ hồ sơ lúc chạy, không từ thứ `context` in ra; `profile.env` vẫn báo tên từng biến `${env:NAME}`); luật vẫn là dùng `${env:NAME}` và `validateProfile` cảnh báo mật khẩu viết thẳng.
- `bin/fe-kit.mjs`: `--json`, `--help`, `--version`; lệnh chưa làm trả mã thoát 2 và nói rõ "not implemented yet".

**Tests:** sandbox-like trả đúng lệnh từ `package.json` (không bịa `typecheck`); hồ sơ khớp ghi đè `lint`; chạy trong `packages/web` của monorepo cho gốc nháp ≠ gốc gói; ngoài git; `--json` parse được; lệnh lạ thoát mã 2; giá trị biến môi trường không bao giờ xuất hiện trong JSON hay text; thông báo lỗi YAML không chứa đoạn nguồn; hồ sơ có alias vòng là cảnh báo; `.fe-kit` mà git không ignore là cảnh báo.

### Task 6: `src/commands/init.mjs`

**Files:** Create `src/commands/init.mjs`, `tests/init.test.mjs`.

**Interfaces:** `init [--dry-run] [--no-agents-link]` trả `data.actions: Array<{ action: 'created'|'updated'|'unchanged'|'skipped', path: string, note?: string }>` (`updated` dùng cho `.git/info/exclude`).

- Tạo `.fe-kit/` và `.fe-kit/.gitignore` chứa `*` (git tự bỏ qua cả thư mục, không cần `.git/info/exclude`; test chứng minh `git status` sạch).
- Repo có `CLAUDE.md` mà không có `AGENTS.md` (kể cả symlink hỏng): tạo symlink `AGENTS.md → CLAUDE.md` và thêm `/AGENTS.md` vào `.git/info/exclude`. Ghi `exclude` **trước**, nếu không ghi được (`.git` chỉ đọc trong sandbox Codex) thì không tạo link và báo `skipped`. Bỏ qua khi `--no-agents-link`, khi `AGENTS.md` đã tồn tại, hoặc khi `CLAUDE.md` là symlink treo (có thể trỏ ngược về `AGENTS.md`, nên linking sẽ tạo vòng; không so chuỗi đường dẫn vì cách viết khác nhau qua symlink).
- Hai lần chạy song song đều thành công: `mkdir` recursive, `.fe-kit/.gitignore` ghi bằng cờ `wx`.
- `.fe-kit` là symlink hoặc file: `skipped`, không ghi gì xuyên qua nó.
- `.fe-kit/.gitignore` đã có nhưng luật cuối không phải `*` (`hasCatchAll` trong `src/lib/drafts.mjs`, đọc như git đọc: bỏ BOM, một CR trước LF, chỉ cắt dấu cách cuối dòng, bỏ dòng trống và chú thích; một `*` mà luật sau phủ định, hay `*` kèm tab hoặc NBSP, không tính): giữ nội dung cũ và thêm `*` ở cuối (`updated`), kể cả khi người dùng cố ý có phủ định, vì nháp không được commit. Một `.gitignore` nằm sâu hơn thắng mọi luật của dự án, nên một luật như `!/.fe-kit/reports/**` ở gốc không làm lộ nháp nữa (đã đo bằng git). Là symlink hoặc thư mục thì `skipped`; không ghi được thì `skipped` kèm lý do, không ném lỗi. Không đọc được cũng `skipped` (kể cả `--dry-run`): `hasCatchAll` ném lỗi khi file có mà không đọc được, và `appendLine` chỉ coi file không tồn tại là rỗng, nên không bao giờ nối vào thứ chưa đọc được (cả `.git/info/exclude`). `context` coi file không đọc được là chưa ignore.

**Tests:** repo mới: tạo đủ và `git status --porcelain` rỗng; chạy lần hai: toàn `unchanged`, `info/exclude` không trùng dòng; `.gitignore` của dự án đã ignore `.fe-kit/`: vẫn ổn; `AGENTS.md` là file thật: không đụng; `CLAUDE.md` → `AGENTS.md`: không tạo vòng; `--dry-run` không đổi đĩa; `--no-agents-link`; ngoài git: tạo `.fe-kit/` nhưng bỏ qua phần exclude và nói rõ; `.gitignore` tuỳ biến không ignore nháp được thêm `*` và `git status` sạch; `.gitignore` tuỳ biến đã ignore thì không đổi; `.fe-kit` là symlink hoặc file thì không ghi ra ngoài.

### Task 7: `src/commands/validate.mjs`

**Files:** Create `src/commands/validate.mjs`, `tests/validate.test.mjs`.

**Interfaces:** `validate [--skills-dir <dir>]` trả `data.problems: Array<{ skill: string, rule: string, message: string }>`, `exitCode` 1 nếu có vấn đề. Mặc định đọc `<kitRoot>/skills`.

Luật làm ở task này: `skill-md-missing`, `frontmatter-missing`, `frontmatter-yaml` (frontmatter phải parse được), `disable-model-invocation` (phải là boolean), `frontmatter-keys` (chỉ `name`, `description`, `disable-model-invocation`), `name` (trùng tên thư mục, kebab-case, ≤ 64 ký tự), `description` (có, ≤ 1024 ký tự; skill model tự gọi phải bắt đầu bằng "Use when"), `openai-yaml` (skill người gọi cần `agents/openai.yaml` có `policy.allow_implicit_invocation: false`), `body-length` (< 500 dòng). Các luật còn lại của plan §11 (router nhắc đủ skill người gọi, không skill nào gọi skill người gọi khác, link gãy, bí mật, em-dash) chờ có skill thật ở task sau.

**Tests:** mỗi luật một fixture sai và một fixture đúng; `description` có dấu `:` không bọc quote báo `frontmatter-yaml`; không có thư mục skills thì không vấn đề.

### Task 8: `src/lib/tools.mjs`

**Files:** Create `src/lib/tools.mjs`, `tests/tools.test.mjs`.

**Interfaces:** `TOOLS: Record<'claude'|'codex'|'antigravity', ToolTarget>`; mỗi `ToolTarget` có `skillsDir`, `rules`, `projectDocs`, `agents` (`{ scope, path }`), `hooks`, `guard`, `mcp`, `invokerOnly` và `verified: Record<string, { status: 'headless'|'docs'|'pending', version?: string, note?: string }>` theo từng khoá. `docs` bắt buộc có `source`: khoá của một tài liệu đã đọc và được liệt kê ở `docs/spike.md` §7 (test kiểm); không có nguồn thì là `pending`. `getTarget(tool)` ném lỗi với tên lạ.

Dữ liệu lấy từ `docs/spike.md` và `docs/plan.md` §6. Ô GUI ghi `pending`.

**Tests:** đủ 3 tool và đủ khoá; mọi ô có `status`; Antigravity `skillsDir` là `~/.gemini/config/skills` (không phải `antigravity-cli/skills`); Codex `skillsDir` là `~/.agents/skills`; không đường dẫn nào chứa `Cellar`.

### Task 9: `rules/` bản nháp và tổng kiểm

**Files:** Create `rules/fe-kit-core.md` (từ bản nháp spike), `rules/personal-core.md` (rút gọn từ `~/.claude/CLAUDE.md`, **bạn duyệt nội dung**, chưa cài đi đâu).

- [x] `npm test` xanh toàn bộ; chạy `fe-kit context` và `fe-kit init --dry-run` trên sandbox; `fe-kit validate` trên repo kit.
- [x] Soát: không file nào ngoài repo bị đổi; `git status` của fe-kit chỉ có file mới; ghi kết quả vào mục "Kết quả" bên dưới.

## Hoãn lại (cần GUI, thư mục toàn cục hoặc quyết định của bạn)

- `link`/`unlink`/`doctor`, `shell-guard` và adapter hook, skill `fe-kit` và `fe-setup`, cài superpowers cho Codex/Antigravity, bản cài `fe-kit-core`/`personal-core` ra các đích.
- Ô GUI của `tools.mjs`.
- Thích nghi test cho Windows (Phase 8): quyền tạo symlink, dấu phân cách đường dẫn trong các so sánh chuỗi của test. Phần mã đã chuẩn hoá đường dẫn của `git rev-parse` bằng `resolve`.

## Kết quả (2026-10-18)

- 169 test xanh (100 trước các vòng review Codex), chạy 3 lần liên tiếp không chập chờn, riêng `fsx` 10 lần. `oxlint` sạch (mượn binary của sandbox; kit chưa có linter riêng). Mã nguồn 1301 dòng, test 2161 dòng.
- Nghiệm thu trên sandbox thật: `context`, `init` (trước `init` git thấy `?? .fe-kit/`, sau `init` thì không), `validate` (0 skill vì chưa có), `verify` trả mã 2 "not implemented yet".
- Review code độc lập bằng subagent `feature-dev:code-reviewer` (chỉ đọc mã, không chạy được test). 12 điểm, mỗi điểm tôi đối chiếu với mã trước khi quyết; kết luận của reviewer là chưa chốt Phase 1 trước khi sửa #1 đến #3, và cả ba đã sửa:

| # | Điểm | Xử lý |
|---|---|---|
| 1 | Hồ sơ sai kiểu (`match.paths` là chuỗi) làm sập `context` ở mọi repo; `bin` không bắt lỗi | Sửa: giá trị sai kiểu bị bỏ qua, mọi hồ sơ được kiểm và báo cảnh báo, thư mục hồ sơ lỗi chỉ là cảnh báo; `bin` thoát mã 70 kèm JSON `error` khi `--json` |
| 2 | `init` tạo link rồi mới ghi `info/exclude`: crash và để lại `AGENTS.md` chưa exclude khi `.git` chỉ đọc | Sửa: ghi `exclude` trước, lỗi thì không tạo link |
| 3 | `fsx` copy-mode luôn xoá và copy lại, không atomic | Sửa: hash cây nguồn trong marker, copy sang thư mục tạm rồi `rename` |
| 4 | `validate` bỏ qua skill cài bằng symlink | Sửa |
| 5 | Đường dẫn trong hồ sơ không qua realpath | Sửa: `matchProfile` async; `findProjectRoot` luôn trả đường dẫn thật |
| 6 | Windows: `git rev-parse` trả dấu `/` | Sửa `resolve(top)`; thích nghi test hoãn sang Phase 8 |
| 7 | Chống vòng `AGENTS.md ↔ CLAUDE.md` bằng so chuỗi | Sửa: bỏ qua khi `CLAUDE.md` là symlink treo |
| 8 | Race ở `mkdir` và `writeFile` | Sửa: `recursive`, cờ `wx` |
| 9 | Code lệch spec (`removeInstalled`, thứ tự `packageManager`, `scriptCommand`, `tools.mjs`) | Sửa **spec** ở các mục Interfaces phía trên; thêm trường `gui` vào `tools.mjs` vì ô `headless` không nói gì về GUI |
| 10 | Test yếu: thiếu Unicode, `backupFile` xanh vì lý do sai | Thêm test Unicode; `backupFile` nhận `now` để test tiêm đồng hồ, kiểm đột biến: bỏ `COPYFILE_EXCL` thì test đỏ; thêm test copy không đổi, dry-run của update và remove, worktree |
| 11 | `~/package.json` lạc loài biến HOME thành gốc dự án | Sửa: ngoài git không tính `package.json` ở home trở lên; test không còn phụ thuộc tổ tiên của thư mục tạm |
| 12 | Helper `exists` trùng 3 bản | Gom vào `fsx.mjs` |

Ghi chú trung thực: test "cập nhật lỗi vẫn giữ bản cũ" chưa tái hiện được ca `cp` hỏng giữa chừng (cần một lỗi chèn được giữa `cp` và `rename`); nó chỉ chứng minh lỗi quyền ở thư mục cha không làm mất bản cũ.

## Review Codex qua herdr (tối đa 3 lượt, dừng khi `VERDICT: OK`)

Reviewer là một agent Codex chạy chỉ-đọc trong pane herdr riêng; prompt và báo cáo từng lượt ở `spike/review/` (bị xoá cùng `spike/`). Mỗi điểm tôi đối chiếu với mã trước khi sửa; sửa theo TDD (test đỏ trước), rồi kiểm đột biến: phá từng bản sửa thì đúng test của nó phải đỏ.

### Lượt 1: `CHANGES_REQUIRED`, 13 điểm, cả 13 đều đúng

| # | Mức | Điểm | Xử lý |
|---|---|---|---|
| 1 | BLOCKER | `fsx` xoá vô điều kiện thư mục tạm tên cố định `…-new-<pid>`, nên mất dữ liệu của người khác nếu trùng tên và hai lời gọi cùng tiến trình giẫm nhau | Tên tạm là UUID; chỉ dọn thư mục do chính lời gọi tạo; khôi phục bản cũ không được thì bỏ bản cũ thay vì để rơi. Test: thư mục lạ ở tên cũ còn nguyên, hai cài đồng thời không để lại gì. Đột biến: quay về tên theo pid thì cả hai test đỏ |
| 2 | BLOCKER | Ghi dấu đi theo symlink `.fe-kit-managed` mang từ nguồn, ghi đè file của người dùng | Xoá đường dẫn trùng tên dấu khỏi bản tạm rồi ghi bằng `wx`. Cùng gốc lỗi mà reviewer chưa nêu: nguồn **là** symlink tới thư mục (`cp` copy symlink, dấu rơi vào nguồn); test đỏ trước, sửa bằng `realpath` trước khi copy. Đột biến cho cả hai |
| 3 | MAJOR | Dấu bất kỳ (rỗng, hỏng, symlink, thư mục) khiến thư mục bị coi là của kit và bị xoá | `readMarker`: file thường, JSON `{source, hash}` kiểu chuỗi; còn lại `skip-foreign` cả lúc cài lẫn lúc gỡ |
| 4 | MAJOR | `init` đi theo `.fe-kit` là symlink và ghi ra ngoài dự án | `.fe-kit` không phải thư mục thật thì `skipped`, không ghi gì |
| 5 | MAJOR | `context --json` in giá trị biến môi trường đã nội suy (mật khẩu trong URL đích) | Không nội suy nữa: targets giữ `${env:NAME}`, thêm `profile.env` (`set`/`missing`). Đây là điểm an toàn nặng nhất và mâu thuẫn với nguyên tắc "bí mật không vào ngữ cảnh mô hình" của plan |
| 6 | MAJOR | Thông báo lỗi YAML trích đoạn nguồn, có thể chứa token | **Chưa đủ**: lượt 1 chỉ lấy dòng đầu; lượt 2 làm lại (điểm 2 bên dưới) |
| 7 | MAJOR | Có `.fe-kit/.gitignore` không bảo đảm git bỏ qua nháp (test cũ dùng `custom`) | **Chưa chứng minh được**: lượt 1 hỏi `git check-ignore` trên một tên thử; lượt 2 làm lại (điểm 3 bên dưới). Test cũ `custom` đổi thành `custom\n*\n` và có assertion `git status` sạch |
| 8 | MAJOR | `package.json` đúng JSON nhưng sai kiểu (`null`, `scripts: "bad"`) làm `context` thoát 70 | Phải là object, nếu không thì `error`; `dependencies`/`scripts`/`workspaces`/`packageManager` sai kiểu bị bỏ qua, chỉ script là chuỗi mới tính |
| 9 | MAJOR | Alias vòng trong YAML tràn ngăn xếp ở `resolveEnvDeep` | `loadProfiles` kiểm bằng `JSON.stringify` và báo `error`; `context` bỏ hồ sơ đó và đi tiếp |
| 10 | MAJOR | `rules/personal-core.md` bỏ nghĩa vụ quản lý công việc của bản gốc (todo, lessons, duyệt plan trước khi làm) | Khôi phục todo/lessons/check-in/ghi chú review, "elegance", diff với main, câu hỏi staff engineer; trỏ sang `.fe-kit/tasks/` trong dự án FE |
| 11 | MINOR | Dấu đóng frontmatter `---oops` vẫn được chấp nhận | Regex mới: dấu đóng nằm trọn một dòng hoặc ở cuối text; nhóm tuỳ chọn lazy để frontmatter rỗng thắng một `---` ở sau |
| 12 | MINOR | Ô `docs` không truy được nguồn như `tools.mjs` cam kết | Ô `docs` có `source`, liệt kê ở `docs/spike.md` §7 (đã đọc lại 3 trang trong ngày), test kiểm; 7 ô không có nguồn đã đọc chuyển sang `pending` |
| 13 | MINOR | plan §6 thiếu điều kiện `--add-dir` cho Claude headless | Đã thêm |

Dòng Dead code: `interpolateEnv` không còn nơi gọi trong `src/` (chỉ test); giữ lại cho `ui` ở Phase 3, chờ bạn quyết.

### Lượt 2: `CHANGES_REQUIRED`, 5 điểm; tôi tái hiện từng điểm bằng thực nghiệm trước khi sửa, cả 5 đều đúng

| # | Mức | Điểm | Đã đo | Xử lý |
|---|---|---|---|---|
| 1 | BLOCKER | `fsx`: lỗi ở cả hai lần `rename` (đưa bản mới vào, rồi khôi phục bản cũ) làm mất luôn bản cũ, vì mọi lỗi khôi phục đều dẫn tới `rm(previous)` | Chèn lỗi `ENOSPC` vào `rename` qua binding ESM: sau lỗi kép không còn `copy` lẫn `copy.fe-kit-old-*`; bản v1 mất | Chỉ bỏ bản cũ khi `target` đã tồn tại lại (một lần cài khác vừa lấp chỗ); ngược lại giữ nó và nói đường dẫn trong lỗi. **Chưa đủ**: lượt 3 bỏ luôn ngoại lệ đó, vì "target tồn tại" không chứng minh gì (điểm 1 bên dưới). 4 test chèn lỗi (`injectFs`): lỗi kép giữ bản cũ; lỗi đơn khôi phục được; `target` bị lấp thì bỏ bản cũ; `cp` hỏng giữa chừng. Test thứ 4 lấp lỗ hổng ghi trung thực ở lượt 1. Đột biến cả hai chiều |
| 2 | MAJOR | Lỗi YAML vẫn rò nguồn qua dòng đầu; tag làm thư viện tự in cảnh báo kèm nguồn ra stderr | Cả ba đều đúng: `\|glpat-…` (header block scalar), `*glpat-…` (alias, `ReferenceError`), `!!glpat-…` (cảnh báo stderr). Mật khẩu bắt đầu bằng `*`, `!`, `\|` là chuyện thật | `describeYamlError`: chỉ mã lỗi và vị trí; `logLevel: 'error'` tắt cảnh báo. Test chạy `bin` thật và quét cả stdout lẫn stderr cho 4 loại lỗi |
| 3 | MAJOR | Một tên probe không chứng minh nháp được git bỏ qua; file đã tracked không được bảo vệ | Với luật `/.fe-kit/*` + `!/.fe-kit/reports/**` ở gốc và `.fe-kit/.gitignore` là `custom`: probe báo "ignored" nhưng `git status` thấy `?? .fe-kit/reports/r.md`. Thêm `*` vào `.fe-kit/.gitignore` thì hết lộ (`.gitignore` nằm sâu hơn thắng). Git 2.55 không đọc `.gitignore` là symlink | Bỏ probe và `isIgnored` (mã chết do tôi tạo). `init` bảo đảm `.fe-kit/.gitignore` là file thường có dòng `*`; `context` báo `drafts.ignored` và `drafts.trackedFiles` (`listTracked`) kèm cảnh báo. Test dùng đúng kịch bản của reviewer với `git status` thật. **Chưa đủ**: lượt 3 đòi luật cuối phải là `*` (điểm 2 bên dưới) |
| 4 | MAJOR | Mật khẩu viết thẳng trong URL của hồ sơ vẫn vào JSON; test lượt 1 chỉ chứng minh giá trị biến môi trường | Đúng: test lượt 1 không có ca literal | `redactCredentials` che mật khẩu trong `scheme://user:mật-khẩu@host` (kể cả mật khẩu chứa `@`, và giữ nguyên tham chiếu `${env:NAME}`, kể cả trong phần user); `validateProfile` cảnh báo theo đường dẫn trường mà không lặp lại mật khẩu. Giới hạn đã ghi: chỉ che mật khẩu userinfo, token trong query không dò được |
| 5 | MINOR | `.fe-kit/.gitignore` không ghi được làm `init` ném lỗi, thoát 70 | Đúng (`appendLine` không bắt lỗi) | Bắt lỗi, `skipped` kèm lý do và cảnh báo nháp có thể lộ; test `chmod 0o444` |

Ghi trung thực: mutant đầu tiên của tôi cho `redactCredentials` là mutant hỏng (`&&` trả về vế phải nên không đổi gì); làm lại đúng thì bị bắt. Khoảng trống thật tìm được qua kiểm đột biến: không test nào bắt việc `hasCatchAll` đi theo symlink; đã thêm test ở `context`. Còn lại không kiểm tự động: dọn thư mục `*.fe-kit-new-*` bị bỏ lại khi tiến trình bị giết giữa chừng (chưa có `doctor`).

### Lượt 3 (cuối): `CHANGES_REQUIRED`, 6 điểm; tôi đo lại từng điểm, cả 6 đều đúng

Hết 3 lượt theo giới hạn của bạn; bạn cho thêm đúng một lượt để xem lại 6 điểm này (lượt 4 bên dưới).

| # | Mức | Điểm | Đã đo | Xử lý |
|---|---|---|---|---|
| 1 | BLOCKER | `fsx`: khôi phục bản cũ lỗi mà `target` đã có gì đó thì vẫn xoá bản cũ; "tồn tại" không chứng minh là bản thay thế hợp lệ | Chính test lượt 2 của tôi đặt một thư mục không dấu vào `target` và kỳ vọng bản cũ bị bỏ; file, symlink cũng vậy | Bỏ hẳn ngoại lệ: khôi phục lỗi thì luôn giữ bản cũ và nêu đường dẫn. 3 test theo thứ chiếm `target` (thư mục không dấu, file, symlink); đột biến bị bắt |
| 2 | MAJOR | `hasCatchAll` báo an toàn khi git vẫn thấy nháp: `*` rồi phủ định; `*` kèm tab; `*` kèm NBSP | Đo bằng git 2.55: `*` + phủ định lộ 1 nháp, `*` + TAB và `*` + NBSP lộ 3. Chiều ngược lại cũng sai: `﻿*\r\n` git coi là catch-all mà hàm cũ không nhận | Đọc như git: bỏ BOM, một CR, chỉ cắt dấu cách, bỏ dòng trống và chú thích; luật **cuối** phải là `*`. Bảng 11 ca ở `tests/drafts.test.mjs` và 5 ca `init` với `git status` thật. Hệ quả cần bạn biết: `init` giờ thêm `*` ở cuối kể cả khi bạn cố ý để phủ định trong `.fe-kit/.gitignore` |
| 3 | MAJOR | `validateProfile` in nguyên giá trị `tests.policy` sai, kể cả mật khẩu trong URL, vào cảnh báo của `context` kể cả khi hồ sơ không khớp | Đúng, đọc mã | Thông báo không lặp lại giá trị. Gom việc che về **một điểm** ở cuối `context` (`redactCredentials(data)`): hồ sơ, scripts của `package.json` (đang được in trong `stack.scripts`) và cảnh báo đều qua đó. Test chạy `bin` thật quét stdout và stderr |
| 4 | MAJOR | Khoá của map chứa URL có mật khẩu không bị che; đường dẫn trong cảnh báo còn đưa khoá ra | Đo: `redactCredentials({'https://u:FAKE_SECRET@h': …})` giữ nguyên khoá | `mapStrings` duyệt cả khoá; đoạn khoá trong đường dẫn luôn là bản đã che. Không cần loại hồ sơ như reviewer đề xuất |
| 5 | MINOR | Regex làm hỏng URL chỉ có username là tham chiếu môi trường | Đo: `https://${env:USER}@host/repo` thành `https://${env:[REDACTED]@host/repo`; cả 3 biến thể hỏng. Lỗi của chính tôi ở lượt 2 | `$` trong phần user chỉ được là nguyên `${env:NAME}` hoặc một `$` không mở placeholder; 3 ca mới trong test |
| 6 | MINOR | `listTracked` nuốt lỗi git thành "không có file" | Đo: chỉ mục hỏng thì `ls-files` thoát 128 trong khi `rev-parse` vẫn chạy (`isGit` vẫn đúng) | `null` khi git không trả lời được; `context` đặt `trackedFiles: null` và cảnh báo |

Ghi trung thực: ba điểm (3, 5, 4) là cùng một họ lỗi "lọc bí mật bằng heuristic nên còn kẽ hở"; mỗi lượt reviewer tìm thêm một kẽ ở đó. Giới hạn đã ghi vẫn còn: chỉ che mật khẩu dạng `scheme://user:mật-khẩu@host`; token trong query, trong văn bản tự do hay ở khoá tên `password` thì không dò được, và plan §5.4/§5.8 không hứa chặn tuyệt đối (`tokenEnv: GITLAB_TOKEN` là tên biến nên heuristic theo tên khoá sẽ báo nhầm).

### Lượt 4 (thêm, bạn cho phép): `CHANGES_REQUIRED`, 4 điểm; tôi tái hiện từng điểm trước khi sửa, cả 4 đều đúng

Bốn điểm này đã sửa; rồi bạn chọn đổi cách che bí mật sang "không bao giờ in userinfo" và cho xem lại ở lượt 5 (bên dưới), vì lượt nào cũng tìm ra thêm một kẽ hở ở cách che đúng chỗ mật khẩu.

| # | Mức | Điểm | Đã đo | Xử lý |
|---|---|---|---|---|
| 1 | MAJOR | Placeholder sai trong username (`u${env:}:mk`, `${env:USER:mk`) chặn regex, nên mật khẩu không bị che | `redactCredentials` trả nguyên văn cả hai, lộ `FAKE_SECRET`. Lỗi do nhánh `$` tôi thêm ở lượt 3 | Bỏ regex một cục, dùng bộ quét authority: tìm `scheme://userinfo@`, che placeholder đầy đủ bằng ký tự đệm rồi mới tìm dấu `:`; còn `${env:` dở dang thì che cả userinfo. Dùng chung cho che và cảnh báo (cảnh báo = "che có đổi gì không"). Test: ca dở dang, `$` và `{}` thường, nhiều URL trong một chuỗi, `@` trong query, và một ca đi qua `context` |
| 2 | MINOR | Hai khoá chỉ khác phần mật khẩu thành cùng một khoá sau khi che, mất một mục | `{"https://u:a@host":1,"https://u:b@host":2}` thành `{"https://u:[REDACTED]@host":2}` | Nhãn duy nhất theo anh em (`…`, `… (2)`, `… (3)`), dùng cho cả khoá in ra lẫn đường dẫn cảnh báo |
| 3 | MINOR | Lỗi dọn thư mục tạm che mất lỗi có đường dẫn bản cũ | Chèn lỗi `rename` và `rm`: lỗi ném ra chỉ là `EACCES`, mất dòng "kept at" | Lỗi dọn được nối vào thông báo gốc, giữ `cause`. Test chèn lỗi hai nơi. Test đầu của tôi mock `rm` quá rộng (làm hỏng cả file dấu); đã siết theo đúng đường dẫn thư mục tạm |
| 4 | MINOR | File ghi được mà không đọc được vẫn bị báo `updated`, và bị nối thẳng vào | Đo bằng CLI thật: `custom` (không newline, mode 0200) thành `custom*`, tức là không có luật `*` nào mà vẫn báo thành công | `hasCatchAll` ném lỗi khi không đọc được; `init` báo `skipped` kể cả dry-run; `appendLine` chỉ coi `ENOENT` là rỗng. Cùng đường này có lỗi thật mà reviewer chưa nêu: `info/exclude` không đọc được thì cũng bị nối bừa (`foo` thành `foo/AGENTS.md`); đã có test |

Ghi trung thực: lần này công cụ giải mã chuỗi `﻿` và ` ` trong lệnh của tôi thành ký tự thô, nên 3 file (`drafts.mjs` và hai file test) có BOM và NBSP vô hình trong mã. Hành vi vẫn đúng và test vẫn xanh, nhưng tôi đã phát hiện nhờ một thông báo thay đổi file, trả về dạng thoát tường minh và quét cả `src`, `bin`, `tests` không còn ký tự vô hình nào.

### Lượt 5 (thêm, bạn chọn đổi cách che bí mật rồi xem lại): `VERDICT: OK`, 1 điểm MINOR

Đây là điều kiện dừng bạn đặt ("đến khi nào REVIEWER OK"): reviewer không còn BLOCKER hay MAJOR nào. Thiết kế mới (userinfo của mọi URL không bao giờ được in; phần phân tích còn lại chỉ để cảnh báo) và 4 bản sửa lượt 4 đều được xác nhận, không có lời nào về chúng.

| # | Mức | Điểm | Đã đo | Xử lý |
|---|---|---|---|---|
| 1 | MINOR | Regex quét bậc hai trên chuỗi dài không chứa URL | `redactCredentials('a'.repeat(n))`: 10.000 ký tự 41 ms, 40.000 ký tự 706 ms, 80.000 ký tự 2,7 giây | Bỏ scheme khỏi mẫu (chỉ cần `://userinfo@` để che), nên mỗi chữ cái không còn là một điểm bắt đầu. 4 triệu ký tự mất 1 ms. Test ngưỡng 500 ms cho 100.000 ký tự và cho 20.000 chuỗi `://` không có userinfo (bản cũ mất 9 giây nên đỏ); đột biến đưa scheme lại thì đỏ. Hệ quả tốt kèm theo: `://u:p@h` không có scheme cũng bị che |

Ghi trung thực: sửa này làm **sau** khi reviewer nói OK nên Codex chưa xem; nó nhỏ, chỉ làm mẫu chặt hơn (che nhiều hơn, không bao giờ ít hơn mẫu cũ), có test và đột biến. Cuối cùng cả vòng review đi qua 5 lượt (13 + 5 + 6 + 4 + 1 điểm) cộng 12 điểm của lần review độc lập đầu.
