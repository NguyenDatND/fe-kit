# Phase 0 — Kết quả spike

> Chạy ngày 2026-10-18 trên macOS (arm64). Mọi kết luận ghi rõ **headless** (CLI không tương tác) hay **GUI** (cần bạn kiểm tay). Log gốc ở `spike/logs/` (bị xoá cùng `spike/` khi hết Phase 0). Fixture hook thật giữ ở `tests/fixtures/hooks/`. **XONG** = có bằng chứng chạy thật. **CHỜ** = cần việc của bạn hoặc phiên sau.

## 1. Phiên bản đã dùng

| Thành phần | Phiên bản | Ghi chú |
|---|---|---|
| Claude Code | 2.1.302 | |
| Codex CLI | 0.163.0 | brew cask; lên từ 0.145.0 lúc 02:10 |
| Antigravity App / IDE | 2.1.4 / 2.5.5 | chưa kiểm |
| `agy` CLI | 1.4.0 | tự cập nhật từ 1.1.5 lúc 02:52; mọi kết quả `agy` từ S1 trở đi là 1.4.0 |
| Node / npm / pnpm | 26.5.0 / 11.17.0 / 11.15.1 | |
| Sandbox | Vite 8.3.4, React 19.3.1, TypeScript 6.0.3, vitest 5.0.5, RTL 16.3.3, Playwright 1.64.1 | lint của template là `oxlint`, không phải ESLint |

## 2. Bảng kết luận

| # | Trạng thái | Kết luận | Tác động lên plan |
|---|---|---|---|
| S-1 | CHỜ BẠN | Khoá Figma vẫn nằm trong `~/.claude.json` | Chỉ thêm lại ở Phase 4 qua `mcp-run` |
| S0 | XONG | Sandbox xanh (`tsc`, `oxlint`, test, build) | Antigravity App: CHỜ BẠN cập nhật |
| S1 | XONG headless | Mỗi tool đọc **một** thư mục skill riêng, xem §3.S1. Symlink dùng được ở cả 3 tool đã kiểm | §6 hàng Skills: Antigravity chỉ cần `~/.gemini/config/skills` |
| S3 | XONG phần CLI | `agy`: quyền, rule, hook, skill đã rõ (§3.S3). App/IDE: CHỜ BẠN | §6 hàng shell-guard: CLI dùng `permissions.ask\|deny` |
| S4 | XONG headless | Cả 3 CLI chạy được `fe-kit` ở `~/.local/bin`. GUI: CHỜ BẠN | §5.3: dùng `which node`, không dùng `process.execPath` |
| S5 | XONG | `storageState` giữ phiên; hết phiên nhận ra được (§3.S5) | `auth login` dùng `indexedDB: true` |
| S6 | XONG | Codex chặn mạng kể cả loopback; Chromium không chạy trong sandbox Codex; rule `allow` giải quyết cả hai (§3.S6) | §6: rule `allow` cho `fe-kit ui`, `dev`, `mr fetch` |
| S7, S11 | PHASE 0B | Cần quyền công ty | Chặn Phase 6 và việc thêm `atlassian` |
| S8 | XONG headless | Chỉ dẫn luôn bật nạp được ở cả 3; `CLAUDE.md` **không** đọc chéo ở Codex và `agy` | `init` tạo symlink `AGENTS.md → CLAUDE.md` |
| S9 | XONG 3 tool | 8 fixture thật, đã làm sạch | `hookio` nhận diện theo hình dạng stdin |
| S10 | XONG | Overlay chạy được; test mặc định của dự án **cũng nhặt** `.fe-kit/tests` | `verify` loại `.fe-kit/**` khi chạy test dự án |
| S12 | XONG headless | Hook Claude/Codex **fail-open**; Codex hook không hỏi được; cơ chế gốc chặn đúng (§3.S12). Hộp hỏi GUI: CHỜ | §5.7 và §6 hàng shell-guard đã sửa |
| S13 | XONG Claude | Overlay thắng superpowers: spec vào `.fe-kit/`, hỏi một vòng nhiều câu. Tool khác: CHỜ (chưa cài superpowers) | Giữ thiết kế "overlay", chạy lại sau Phase 1 |
| S14 | CHỜ BẠN | Cần quyết định plugin hay standalone cho Codex IDE | Xem checklist |

## 3. Bằng chứng theo spike

### S0 — phiên bản, cập nhật, sandbox
- npm 11.17 cảnh báo `allow-scripts` (script cài của `fsevents` không chạy); không ảnh hưởng spike.

### S1 — skill qua symlink (4 skill, mỗi skill nằm đúng một thư mục)

| Thư mục | Claude 2.1.302 | Codex 0.163.0 | `agy` 1.4.0 |
|---|---|---|---|
| `~/.claude/skills` | thấy | không | không |
| `~/.agents/skills` | không | thấy | không |
| `~/.gemini/config/skills` | không | không | thấy |
| `~/.gemini/antigravity-cli/skills` (symlink **và** bản copy thật) | không | không | **không** (tài liệu ghi là có) |

- `agy` tự liệt kê nguồn skill: `~/.gemini/config/skills/`, `~/.gemini/config/plugins/<plugin>/skills/`, `~/.gemini/antigravity-cli/builtin/skills/`.
- Đổi marker `ALPHA` thành `BETA` rồi chạy phiên mới: Claude và Codex trả `BETA` ngay. Phiên Claude đang chạy cũng tự thấy skill mới sau khi tạo symlink, không cần `/reload-skills`.
- Đọc `references/` nằm ngoài workspace: Claude cần `--add-dir` khi `-p`; Codex đọc qua shell, không cần gì; `agy` cần quyền `read_file` và `command` (xem S3).
- Changelog `agy` 1.3.6: `description:` có dấu `:` không bọc quote làm skill không nạp. `validate` phải parse YAML.

### S3 — Antigravity CLI (App/IDE: CHỜ BẠN)
- Headless `agy -p` **tự từ chối** mọi thao tác cần quyền: `jetski: no output produced — a tool required the "read_file" permission that headless mode cannot prompt for, so it was auto-denied.` Cùng thông báo cho `command`.
- Quyền nằm ở `~/.gemini/antigravity-cli/settings.json`, chỉ có cấp user: `{"permissions":{"allow":[…],"deny":[…],"ask":[…]}}`, dạng `command(prefix)`, `read_file(thư-mục)`, `write_file(thư-mục)`. Đã kiểm: `command(fe-kit)` và `command(which)` đủ để chạy stub.
- Rule: `~/.gemini/config/rules/*.md` với `trigger: always_on` được nạp. `AGENTS.md` và `GEMINI.md` của dự án được nạp. Hook dự án `.agents/hooks.json` chạy trong `agy -p`, không hỏi tin cậy.

### S4 — `fe-kit` trên PATH
- Stub ở `~/.local/bin/fe-kit` chạy được từ Claude, Codex, `agy` (headless). PATH của họ có cả `/opt/homebrew/bin` và `~/.local/bin`.
- `process.execPath` của node là `/opt/homebrew/Cellar/node/26.5.0/bin/node` (chứa số phiên bản); `which node` là `/opt/homebrew/bin/node` (ổn định). `npm prefix -g` là `/opt/homebrew`, nên `npm link` đặt bin ở `/opt/homebrew/bin`.

### S5 — Playwright `storageState`
- Đăng nhập bằng script, lưu vào `~/.local/state/fe-kit/auth/spike-admin.json`: file `600`, thư mục `700`. Cookie `sid` là cookie phiên (`expires=-1`, httpOnly, SameSite=Lax); `origins` rỗng vì sandbox dùng cookie.
- Context mới nạp state: `/` hiện `Signed in as admin`. Khởi động lại dev server (phiên trong bộ nhớ mất): cùng state bị đá về `/login`, `GET /api/me` trả 401.
- Phần "đăng nhập tay bằng cửa sổ có giao diện" để Phase 3 kiểm khi viết `fe-kit auth login`.
- Tài liệu Playwright: `storageState` gồm cookie, localStorage, IndexedDB (cần `indexedDB: true`); không gồm sessionStorage.

### S6 — sandbox Codex
- `-s read-only` và `-s workspace-write` mặc định: `curl localhost:5173` → exit 7, `curl https://gitlab.com/...` → exit 6. Mạng bị chặn **kể cả loopback**.
- `-c sandbox_workspace_write.network_access=true`: cả hai trả 401 (tới được).
- Chromium của Playwright trong sandbox Codex: `bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer: Permission denied (1100)`. Không khởi động được.
- Rule `.rules` `allow` cho đúng lệnh đó: Codex chạy nó **ngoài sandbox**, Chromium lên và tới được localhost dù mạng sandbox tắt. `prefix_rule(pattern=["node", "<script>"], decision="allow")` ở `.codex/rules/` (dự án đã tin cậy).
- `codex execpolicy check` coi `bash -lc '…'` là một argv nguyên khối, không phản ánh việc runtime tách `&&`. Kiểm rule phải chạy thật.

### S8 — chỉ dẫn luôn bật (mỗi nơi một marker `SPIKE-*`)

| Nguồn | Claude | Codex | `agy` |
|---|---|---|---|
| Rule user-level (`~/.claude/rules`, `~/.codex/AGENTS.md`, `~/.gemini/config/rules`) | thấy của mình | thấy của mình | thấy của mình |
| `AGENTS.md` dự án (có cả `CLAUDE.md`) | không | thấy | thấy |
| `CLAUDE.md` dự án | thấy | **không** | **không** |
| Không tool nào đọc rule user-level của tool khác | | | |

Repo chỉ có `CLAUDE.md`:
- Codex: không thấy; `project_doc_fallback_filenames=["CLAUDE.md"]` thì thấy; symlink `AGENTS.md → CLAUDE.md` thì thấy. Khi có `AGENTS.md`, fallback không được dùng.
- `agy`: không thấy; symlink `GEMINI.md → CLAUDE.md` thấy; **`@CLAUDE.md` bên trong `GEMINI.md` không thấy**; `@import` trong `.agents/rules/project.md` không thấy; symlink `AGENTS.md → CLAUDE.md` thấy.
- Claude: repo chỉ có `AGENTS.md` thì **vẫn đọc** (fallback); có cả hai thì chỉ đọc `CLAUDE.md`. Kiểm bằng hai marker khác nhau.
- `~/.codex/AGENTS.md` ban đầu rỗng; sau khi gỡ marker khôi phục đúng 0 byte (`cmp`).

### S9 — stdin thật của hook (`tests/fixtures/hooks/`)
- Claude: `session_id, transcript_path, cwd, prompt_id, permission_mode, effort, hook_event_name, tool_name, tool_input, tool_use_id`. `Bash{command,description}`, `Write{file_path,content}`, `Read{file_path}`.
- Codex: như Claude, thêm `turn_id`, `model`; không có `effort`, `prompt_id`. Khi tạo file, model dùng **shell** (`printf hello > fixture-note.txt`) chứ không phải `apply_patch`. Ép dùng `apply_patch` thì `tool_input.command` là patch (`*** Begin Patch / *** Add File: <path> / +dòng / *** End Patch`).
- `agy`: **không có `hook_event_name`**. Có `toolCall{name,args}`, `stepIdx`, `conversationId`, `workspacePaths`. `run_command{CommandLine,Cwd}`, `write_to_file{CodeContent,…}`, `view_file{AbsolutePath}`.

### S10 — vitest overlay
- `.fe-kit/vitest.overlay.config.ts` = `mergeConfig(base, defineConfig({ test: { include: ['.fe-kit/tests/**/*.test.{ts,tsx}'] } }))`. `npx vitest run --config …` chạy đúng 1 test local.
- `npm test` mặc định: **3 test, 2 file** (nhặt cả `.fe-kit/tests/login-local.test.tsx`).

### S12 — guard (headless). Lệnh bị bảo vệ: `touch ran-spike-guarded.flag`; "CHẠY" nghĩa là file được tạo

Hook trả lời theo từng chế độ:

| Chế độ hook | Claude | Codex | `agy` |
|---|---|---|---|
| `deny` | chặn | chặn | chặn |
| `exit 2` | chặn | chặn | chặn |
| `ask` | chặn (headless không prompt được) | **CHẠY** (không hỗ trợ `ask`) | **CHẠY** khi có allow-rule (ghi đè `ask`) |
| `force_ask` | n/a | n/a | chặn |
| crash (exit 1) | **CHẠY** | **CHẠY** | chặn |
| in JSON hỏng | **CHẠY** | **CHẠY** | chặn |
| timeout (hook bị giết sau 3s) | **CHẠY** | **CHẠY** | chặn |

Cơ chế gốc (không dùng hook):

| Tool | Cơ chế | Kết quả |
|---|---|---|
| Claude | `permissions.ask: ["Bash(touch:*)"]` + `--allowedTools "Bash(touch:*)"` | chặn: `ask` thắng `allow` (đối chứng không có `ask`: chạy) |
| Claude | `permissions.allow` ở `.claude/settings.json` của workspace chưa tin cậy | bị **bỏ qua**: `Ignoring 1 permissions.allow entry … this workspace has not been trusted` (hook cùng file vẫn chạy) |
| Claude | pattern `Bash(touch ran-spike-guarded:*)` với lệnh `touch ran-spike-guarded.flag` | **không khớp**: `ask` không chặn, lệnh vẫn chạy. Suy ra là khớp theo ranh giới từ (chưa kiểm trực tiếp); dùng pattern nhiều từ như `Bash(git commit:*)` |
| Codex | `.rules` `decision="prompt"` | từ chối: `approval required by policy, but AskForApproval is set to Never` |
| Codex | `.rules` `decision="forbidden"` | từ chối kèm lý do: `rejected: spike: never run` |
| `agy` | `allow` + `ask` cùng `command(touch)` | chặn (`ask` thắng) |
| `agy` | `allow` + `deny` | chặn: `Matches user-configured deny rule` |

Cấu hình hook thật đang có của bạn (herdr, `SessionStart`) có ở cả 3 tool: `~/.codex/hooks.json`, `~/.gemini/config/hooks.json` (khoá riêng `herdr`), `~/.claude/settings.json`. Codex lưu trạng thái tin cậy hook theo `file:event:chỉ-số` trong `~/.codex/config.toml`.

Codex chạy hook cấp dự án cần `-c 'projects."<path>".trust_level="trusted"'` và `--dangerously-bypass-hook-trust` (chỉ dùng trong spike, hook là script ghi log của tôi).

### S13 — chỉ dẫn luôn bật có thắng superpowers không (Claude, headless)
Cùng prompt "dùng brainstorming để thêm link Forgot password":

| | Không overlay | Có overlay (`fe-kit-core` nháp ở `~/.claude/rules`) |
|---|---|---|
| Nơi lưu spec | `docs/superpowers/specs/…`, thường commit | `.fe-kit/specs/…`, **không commit**; Claude tự nêu mặc định của skill rồi chọn theo rule |
| Cách hỏi | **một** câu | **một vòng 6 câu đánh số, mỗi câu có đề xuất** |
| Rule mục 1 | | tự thử chạy `fe-kit context` (bị chặn do headless không duyệt được) |

Bản nháp: `spike/rules/fe-kit-core.draft.md` (đầu vào cho Phase 1). Codex, Antigravity: CHỜ (chưa cài superpowers).

## 4. Hệ quả thiết kế (đã ghi vào `docs/plan.md`)

1. §5.7: adapter hook **bắt buộc** bọc lỗi thành `deny` (Claude, Codex fail-open); Codex hook chỉ `deny`, hỏi bằng `.rules`; `agy` dùng `force_ask`.
2. §5.7, §6: luật hỏi gốc dùng được ở Claude (`permissions.ask`), Codex (`.rules`), `agy` CLI (`permissions.ask|deny`); luật của kit đặt ở cấp user.
3. §6: Codex cần rule `allow` cho lệnh dùng Chromium hoặc mạng (chạy ngoài sandbox).
4. §6, §5.3: `AGENTS.md → CLAUDE.md` thay cho các cách nạp `CLAUDE.md` khác; Antigravity chỉ cần `~/.gemini/config/skills`.
5. §5.3: `link` chỉ thêm vào cuối hook sẵn có; `which node` thay `process.execPath`; `verify` loại `.fe-kit/**`; `storageState` có `indexedDB: true`.
6. §12: 6 rủi ro mới (CLI tự cập nhật, tài liệu sai thực tế, YAML có dấu `:`, hook fail-open, `allow` cấp dự án bị bỏ qua, Chromium trong sandbox).

## 5. Việc bạn làm tay

Trạng thái máy lúc này: 3 symlink skill (`hello-fe-kit-claude`, `-agents`, `-gcfg`) và stub `~/.local/bin/fe-kit` **đang được cài** để bạn kiểm GUI. Rule marker đang **gỡ**; bật bằng `! ~/Code/fe-kit/spike/s8-arm.sh`, gỡ bằng `! ~/Code/fe-kit/spike/cleanup.sh ~/Code/fe-kit/spike/installed-s8.txt`. Dev server sandbox đang chạy ở `localhost:5173`.

**Làm một lần:**
- [ ] **S-1:** thu hồi khoá Figma đã lộ (trang cài đặt tài khoản Figma), rồi gỡ MCP `figma` khỏi `~/.claude.json` (`claude mcp remove figma`).
- [ ] Cập nhật Antigravity App (2.1.4) nếu có bản mới; ghi phiên bản mới.

**Kiểm trên GUI** (mở thư mục `~/Code/fe-kit-sandbox`; prompt có sẵn ở `spike/prompts/`):

| GUI | Skill (prompt `s1.txt`) | PATH (prompt `s4.txt`) | Rule (bật marker, prompt `s8.txt`) |
|---|---|---|---|
| Antigravity App | như trên | như trên | như trên |
| Antigravity IDE | như trên | như trên | như trên |
| Codex IDE | như trên | như trên | như trên |

**Hộp hỏi thật (S12, quan trọng nhất):** mở từng thư mục `~/Code/fe-kit/spike/guard/<tool>` (`agy` cho Antigravity, `codex`) trong GUI, đặt chế độ rồi bảo "Run `touch ran-spike-guarded.flag` in the shell":
- Antigravity IDE/App: `echo force_ask > ~/Code/fe-kit/spike/mode-agy.txt`; như trên.
- Codex IDE: hook `ask` không dùng được, kiểm `.rules` `prompt` (tôi sẽ đặt rule trong thư mục đó khi bạn sẵn sàng).
- Ghi lại: hộp hỏi hiện hay lệnh bị từ chối im lặng.

**Quyết định S14:** Codex IDE không hỗ trợ plugin. Phương án mặc định: cài superpowers dạng skill standalone vào `~/.agents/skills` cho cả Codex CLI lẫn IDE và không bật plugin Codex. Cần bạn đồng ý trước khi tôi cài.

## 6. Dọn dẹp

```bash
~/Code/fe-kit/spike/cleanup.sh --dry-run   # xem sẽ gỡ gì (3 symlink skill, stub fe-kit, file phiên Playwright)
~/Code/fe-kit/spike/cleanup.sh             # gỡ thật
kill $(lsof -ti tcp:5173)                  # dừng dev server sandbox
```

Sau khi bạn kiểm GUI xong: xoá `~/Code/fe-kit/spike/`, `~/Code/fe-kit-sandbox/.fe-kit/`, `~/Code/fe-kit-sandbox/.codex/` (rule `allow` thử nghiệm) nếu không còn dùng.

## 7. Nguồn của các ô `docs` trong `src/lib/tools.mjs`

Ô `docs` nghĩa là một tài liệu của nhà cung cấp nói như vậy, chưa chạy thật. Trường `source` của ô là một khoá dưới đây; `tests/tools.test.mjs` kiểm mọi khoá đều có mặt ở đây. Ô nào không có nguồn đã đọc thì là `pending`, không phải `docs`. Đọc lại ngày 2026-10-18.

| Khoá | URL | Ô dùng | Điều tài liệu nói |
|---|---|---|---|
| `claude-skills-doc` | https://code.claude.com/docs/en/skills | `claude.invokerOnly` | `disable-model-invocation: true` ngăn Claude tự nạp skill; dùng cho quy trình chỉ gọi tay bằng `/tên` |
| `antigravity-skills-doc` | https://antigravity.google/docs/skills?tab=ide | `antigravity.invokerOnly` | frontmatter chỉ có `name` và `description`; không có cơ chế chỉ-người-gọi |

Các ô `pending` vì chưa có nguồn: `agents` của Claude và Codex, `mcp` của Claude, Codex, Antigravity, và `invokerOnly` của Codex (`agents/openai.yaml`; `validate` đang đòi file này, nên cần kiểm trước khi tin).
