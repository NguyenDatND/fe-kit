# Phase 1b — shell-guard, link, doctor, skill `fe-kit` và `fe-setup`

Nguồn: `docs/plan.md` §5.3 (`link`, `doctor`, `ui-act`), §5.7 (hooks và quyền), §6 (bảng cài), §10 Phase 1; `docs/spike.md` S1, S3, S4, S12; fixture stdin thật ở `tests/fixtures/hooks/{claude,codex,agy}`.
Trạng thái: **kế hoạch đã duyệt (2026-10-21); đã xong P1B-1a, 1b, 2, 3, 4 (P1B-1..2 đã commit `e2da470`); tiếp theo P1B-8 (nghiệm thu)**. Chủ đề này đã dùng 2/3 lượt review.

## Mục tiêu (tiêu chí xong)

1. `shell-guard` chạy được trên cả 3 tool: hỏi trước `git commit|push`, `git reset --hard`, `git clean -f*`, `fe-kit ui-act|link|unlink|mr post|mr publish`; chặn đọc kho bí mật; hook crash, đầu ra sai hoặc quá hạn → từ chối (xem giới hạn ở giả định 6).
2. `fe-kit link` / `unlink` / `doctor` chạy đúng **trong HOME tạm** cho đủ 3 tool; mặc định dry-run; chạy lần 2 không đổi gì; không bao giờ để cấu hình của bạn tệ hơn trước.
3. Skill `fe-kit` (router) và `fe-setup` (dò dự án → hồ sơ) qua `fe-kit validate`, kèm trang `docs/skills/`.
4. **Mở `ui-act` là mốc riêng (P1B-9) và đổi cách duyệt: bạn gõ xác nhận trên terminal thật (`/dev/tty`), không dựa vào hộp hỏi của tool** (giả định 10). Trước đó cổng vẫn đóng.
5. **Phase 1 chưa được đánh dấu xong** bằng kết quả headless: ma trận nghiệm thu (P1B-8) ghi rõ ô nào chờ GUI, rules, superpowers.

## Giả định (sửa ngay nếu sai)

1. **Không đụng thư mục toàn cục thật** (`~/.claude`, `~/.codex`, `~/.gemini`, `~/.local`) trong cả phase này. Test và nghiệm thu dùng HOME tạm. Cài thật là việc bạn tự chạy `fe-kit link --yes` (hoặc nói "cài đi", tôi mới chạy), sau khi đọc dry-run.
2. **Không thêm dependency mới.** Cấu hình cần ghi đều là JSON, khối đánh dấu trong `AGENTS.md`, và file `.rules` của Codex.
3. **Rules chưa cài (bạn chọn 2026-10-21):** `link` chỉ có `skills` và `guard`; `rules` chỉ cài khi có `--with rules`, sau khi bạn duyệt nội dung. `doctor` in "rules: chưa cài (chờ duyệt)", không tính là đỏ.
4. **Hook đăng ký đúng một chuỗi lệnh sinh ra**: `<node ổn định> <đường dẫn tuyệt đối tới hooks/shell-guard.mjs>`. Nhận diện mục của kit bằng **so khớp cấu trúc và chuỗi lệnh chính xác**, không bằng substring `fe-kit` (Codex #6).
5. **Thêm vào cuối, không chèn trước, không ghi đè** (plan §5.3) và **sửa file an toàn** (Codex #5): kiểm trước toàn bộ đích; file không parse được, sai schema hoặc là symlink → dừng, không ghi gì và nói rõ; khoá `link`/`unlink` (một lần một); backup riêng tư (quyền 600) trước khi sửa; ghi qua file tạm rồi rename, giữ quyền file; **đọc lại ngay trước rename, nội dung đã đổi (tool tự ghi) → dừng**, không ghi đè bản gộp cũ; tool đang tự ghi mà không có giao thức phối hợp thì nhắc đóng tool trước. `install.json` ghi **từng mục đã thêm kèm dấu vân tay** và phân biệt mục có sẵn với mục kit thêm; `unlink` chỉ gỡ mục do kit thêm **và còn khớp dấu vân tay**, mục bạn đã sửa hoặc không rõ nguồn thì giữ và báo; không khôi phục backup đè lên chỉnh sửa mới. **Nhật ký giao dịch bền** (Codex lượt 17 #5): trước lần sửa đầu tiên `link` ghi một journal (quyền 600) gồm dấu vân tay trước khi sửa và phần dự định thêm; ghi nhận tiến độ sau mỗi file. Chạy lại (`link`, `unlink` hoặc `doctor`) thấy journal dở dang thì **phục hồi bằng cách so trạng thái hiện tại với trước/sau dự kiến**, không bao giờ tự nhận mục có sẵn là của kit. Ghi `install.json` hỏng hoặc tiến trình bị dừng giữa lúc sửa cấu hình và cập nhật state: lần chạy sau hoàn tất giao dịch, và `unlink` gỡ đủ mục kit tạo, giữ nguyên mục ngoại lai.
6. **Fail-closed có giới hạn nói thẳng** (Codex #3): `docs/spike.md` đã đo Claude và Codex cho lệnh chạy khi hook crash, in JSON hỏng hoặc bị giết vì timeout, nên `try/catch` không đủ. `hooks/shell-guard.mjs` là **bộ giám sát nhỏ**: **một hạn giờ cho cả bộ giám sát, bắt đầu trước khi đọc stdin** (ngắn hơn timeout của host, khoảng dự phòng cho khởi động và xuất kết quả; timeout host cụ thể được ghi vào cấu hình sinh ra), giới hạn byte cho stdin và stdout; chính sách chạy trong tiến trình con; hết hạn thì **exit 2 ngay và `SIGKILL` con, không chờ con tự kết thúc**; crash / đầu ra sai / quá hạn / không nhận ra tool → exit 2 hoặc `deny` đúng schema của tool; không đoán schema khi chưa nhận ra tool. Test: stdin không đóng, gửi nhỏ giọt, con treo, con bỏ qua `SIGTERM`. Còn lại là giới hạn không vá được: chính bộ giám sát không chạy được (script bị xoá, `node` mất khỏi PATH); `doctor` chạy thử hook để bắt.
7. **Phân tích lệnh bằng bộ tách token, không bằng regex trên cả chuỗi** (Codex #2). Cú pháp được hỗ trợ: nháy đơn/đôi/`$'…'`, backslash và nối dòng, `;` `&&` `||` `|` `&`, xuống dòng, `$(…)` và backtick, here-document, tiền tố `env VAR=…`, `command`, `exec`, `time`, `nohup`, `sudo`, đường dẫn tuyệt đối tới `git`/`node`, tuỳ chọn trước lệnh con của git (`-c k=v`, `-C dir`, `--git-dir`), `sh|bash|zsh -c` lồng (độ sâu có hạn). Dữ liệu (đối số của `echo`, thông điệp commit, thân here-document đưa vào lệnh thường) **không phải lệnh**; command substitution bên trong vẫn được xét, **trừ** thân here-document có delimiter được quote (shell không mở rộng ở đó). **Nguồn mã thì xét như mã** (Codex lượt 17 #2): here-document hoặc `-s`/stdin đưa vào `sh|bash|zsh` → hỏi; `xargs` có lệnh con là lệnh được bảo vệ, hoặc `xargs` mà stdin có thể bổ sung lệnh con không xác định → hỏi. Không tách được (nháy không đóng, quá sâu) → hỏi/từ chối, không allow. **Ngoài phạm vi, nói thẳng:** alias, hàm shell, mở rộng động (`$cmd`), script do agent tự viết. Phạm vi bảo vệ như plan: chặn agent làm quá đà theo cách gọi thông thường, không chặn agent cố tình lách.
8. **Chặn kho bí mật theo đường dẫn đã chuẩn hoá** (Codex #4): đầu vào chính sách là `{ thao tác, cwd, đường dẫn }`. Kho cần bảo vệ = `~/.config/fe-kit`, `~/.local/state/fe-kit/auth` **và** thư mục mà `FE_KIT_STATE_DIR` / `FE_KIT_HOME` đang trỏ tới. Đường dẫn tương đối tính từ `cwd` (theo dõi **tập cwd có thể có** qua `;` `&&` `||`, nhóm lệnh, subshell (cwd trong subshell không đổi shell cha) và `-c` lồng; `cd` có thể thất bại thì xét cả cwd cũ và mới; không xác định được thì thao tác đọc liên quan không được allow; `cwd` nằm trong kho thì mọi đối số kiểu đường dẫn đều bị xét), `~`, `$HOME`, `${HOME}` được mở, symlink giải bằng `realpath` trước khi kiểm chứa. Adapter ánh xạ đúng trường của fixture (Claude `file_path`, agy `AbsolutePath`, lệnh shell).
9. **Codex:** hook không hỏi được, nên lệnh cần hỏi đi bằng `.rules` (`prompt`); hook chỉ `deny`. Dạng nào cần bảo vệ mà `.rules` chưa bắt được thì **hook từ chối, không chuyển thành allow**. Hook Codex cần bạn duyệt một lần trong `/hooks` (in thành checklist). Trạng thái duyệt đó kit không quan sát được, nên **không được dùng làm bằng chứng mở cổng**.
10. **`ui-act` (Codex lượt 16 #1, lượt 17 #1):** mọi tín hiệu "đã cài guard" (manifest, cấu hình, thử chạy hook) đều **không gắn với tool đang gọi** và agent ghi được hết, nên không dùng làm điều kiện mở. Thay bằng **xác nhận của người ngay trên terminal thật**: `ui-act` in đúng request ghi sẽ đi qua (phương thức, origin, đường dẫn) rồi chờ bạn gõ `yes` trên `/dev/tty`; không có `/dev/tty` (agent chạy, headless, CI) hoặc không gõ `yes` → mã 2 kèm lệnh để bạn tự chạy. Hộp hỏi của tool (`ask`) vẫn có thể xuất hiện ở trên như lớp phụ, nhưng không còn là cổng. Giới hạn nói thẳng: một agent cố tình dựng pty giả thì lách được, nằm ngoài phạm vi (plan §5.7). **Đây là đổi so với plan §5.3** (hộp hỏi của tool): cần bạn đồng ý, và nếu duyệt thì sửa §5.3, `ui-act-gate.mjs`, `docs/skills/fe-ui-check.md`. Test: gọi không có TTY, stdin giả không phải tty, trả lời khác `yes`, đóng stdin.

## Tiến độ

- [x] P1B-1a `shell-tokens.mjs` (bộ tách lệnh): 25 test, 51 đột biến đã xử lý (còn sống: `seg-star` tương đương).
- [x] P1B-1b `shell-policy.mjs` (chính sách `allow`/`ask`/`deny`, kho bí mật, cwd, glob, symlink): 21 test, 85 đột biến đã xử lý.
- [x] P1B-2 `hookio.mjs`, `guard-rules.mjs`, `hook-supervisor.mjs`, `hooks/shell-guard.mjs` + `shell-guard-worker.mjs`: 28 test (cả tiến trình thật), 53 đột biến đã xử lý. 955 test xanh, lint sạch.
- [x] P1B-3 `guard-config.mjs` (sinh cấu hình, thêm vào cuối, gỡ theo dấu vân tay): 19 test, 42 đột biến đã xử lý.
- [x] P1B-4 `config-files.mjs`, `process-lock.mjs` (tách từ `dev-server.mjs`), `install.mjs`, lệnh `link`/`unlink`: 41 + 3 test, 55 + 27 đột biến đã xử lý; 1018 test xanh. Còn lại tương đương: `seg-star`, `plan-fs-error` (khác biệt chỉ khi có lỗi lập trình), `plan-unknown`.
- [x] P1B-5 `doctor`: 22 test, 41 + 18 đột biến đã xử lý (còn lại tương đương: không); 1040 test xanh.
- [x] P1B-6 skill `fe-kit` (router) và `fe-setup`, trang `docs/skills/`; `fe-kit context` thêm `profilesDir` và `remotes` để `fe-setup` không phải đoán. `validate` 5 skill, 0 vấn đề.
- [x] P1B-7 README, `docs/plan.md` (§5.3 `link`, `doctor`).
- [x] P1B-9 `ui-act` bật bằng xác nhận `yes` trên `/dev/tty` (`ui-act-gate.mjs`: `confirmOnTerminal`, `confirmUiAct`), runner giữ thêm khoá; 11 test, 15 đột biến đã xử lý. Chưa thử tay trong terminal thật (việc của bạn: một lần).
- [ ] P1B-8 nghiệm thu trên tool thật: chưa làm.

**Lệch kế hoạch ở P1B-4:** `--with rules` bị từ chối ("chưa có") thay vì có code ẩn sau cờ; tool chưa có thư mục thì bỏ qua trừ khi gọi `--tools`; xung đột khi hồi phục nhật ký chỉ là *ghi chú* (không chặn), vì file không khớp "trước" lẫn "sau" nghĩa là kit không ghi nó (rename nguyên tử) hoặc người dùng sửa sau đó, cả hai đều không làm kit gỡ nhầm.

**Cú pháp chưa kiểm trên tool thật (để P1B-8):** quy tắc `command(...)` và `read_file(…/**)` của `agy` CLI (suy từ spike, glob của deny chưa biết), `Read(~/…/**)` và `Bash(… :*)` của Claude (đã có trong docs/spike nhưng chưa thử bằng chính file kit sinh), hook `timeout: 10` ở cả 3 tool, `.rules` của Codex đọc `fe-kit.rules` (spike đã kiểm `prefix_rule(... decision=...)`).

**Ghi nhận:** để thử dry-run, tôi đã chạy `node bin/fe-kit.mjs link` (không `--yes`) trên HOME thật một lần: lệnh chỉ đọc các file cấu hình (`~/.claude/settings.json`, `~/.codex/hooks.json`, `~/.gemini/config/hooks.json`, `~/.gemini/antigravity-cli/settings.json`, và xem các thư mục skill) và in số mục sẽ thêm; không ghi gì, không in nội dung. Kết quả: cả 3 tool đọc được, không có vấn đề.

**Chỗ lệch kế hoạch (ghi để bạn biết):** Codex không hỏi được qua hook, nên hook chỉ im lặng khi lệnh là một dạng đơn giản mà `.rules` bắt (`guard-rules.mjs`), còn dạng khác cần hỏi (`git -C x push`, `bash -c 'git push'`, lệnh nối) thì hook **từ chối**. Policy trả thêm `argv` cho việc này.

**Giới hạn chưa vá, nói thẳng:** `git merge|rebase|cherry-pick|revert|am|pull` cũng tạo commit nhưng plan chỉ liệt kê 4 lệnh nên chưa hỏi; `node -e`/`python -c` gọi `git push` bên trong chuỗi mã; alias, hàm shell, `$cmd` làm lệnh; script vừa viết rồi chạy; `case` và hàm shell bị coi là "không đọc được" nên hỏi.

## Kế hoạch (TDD: test đỏ trước, mutation cho phần chính sách; mỗi mốc xong chạy cả bộ test)

| # | Việc | Ghi chú |
|---|---|---|
| P1B-1a | `src/lib/shell-tokens.mjs`: bộ tách lệnh theo giả định 7 (nháy, nối dòng, toán tử, `$(…)`, here-document, tập cwd có thể có). Chỉ tách, chưa có chính sách | tách riêng vì là phần dễ sai nhất; thu hẹp danh sách hỗ trợ nếu một dạng chưa làm được |
| P1B-1b | `src/lib/shell-policy.mjs` (thuần): `{ thao tác, cwd, lệnh/đường dẫn }` → `allow` / `ask` / `deny` + lý do | bảng test: `git -c k=v commit`, `g'it' co"mmit"`, `env X=1 git commit`, `command git push`, `/usr/bin/git`, `bash -c` lồng 2 tầng, nối dòng, here-document; **không hỏi nhầm** `echo "git push"`, `git commit -m "…git push…"` chỉ hỏi vì là commit; `$(git push)` trong đối số `echo` vẫn bị xét; nháy không đóng → không allow; `printf 'push\n' \| xargs git`, `sh <<'EOF'` thân `git push`; `cd "$HOME/.local/state/fe-kit"; cat auth/p/t.json`, subshell không đổi cwd cha, `cd` có thể thất bại; kho bí mật tuyệt đối, tương đối, `~`, `$HOME`, symlink, `FE_KIT_STATE_DIR`, `cwd` trong kho |
| P1B-2 | `src/lib/hookio.mjs` + `hooks/shell-guard.mjs` (bộ giám sát, giả định 6): đoán tool theo stdin (fixture thật), trả đúng một kiểu kết quả: Claude `permissionDecision`, Codex chỉ `deny`/exit 2 (không bao giờ `ask`), agy `force_ask`/`deny` camelCase | test bằng **tiến trình thật**: stdin rỗng, JSON hỏng, tool lạ, chính sách ném lỗi, chính sách treo (quá hạn), stdout quá lớn → exit 2/deny trước hạn giờ; mutation |
| P1B-3 | `src/lib/guard-config.mjs` (thuần): sinh phần cấu hình cho từng tool: Claude `permissions.ask/deny` + PreToolUse; Codex `fe-kit.rules` (một rule mỗi dạng gọi) + `hooks.json`; agy `settings.json` + `hooks.json` khoá `fe-kit`; hàm "thêm vào cuối, idempotent" + gỡ theo dấu vân tay (giả định 4, 5) | test với file có sẵn hook `herdr`, hook ngoại lai có chữ `fe-kit`, mục giống hệt có sẵn, mục bạn sửa sau cài, JSON hỏng, sai schema, symlink |
| P1B-4 | `link` / `unlink` (`src/commands/link.mjs`): thành phần `skills`, `guard` (và `rules` sau cờ); dry-run mặc định, `--yes`, `--tools`; khoá, backup 600, staging + rename, đọc lại trước rename, `install.json`; dùng `fsx.installDirectory` cho skill | HOME tạm, 3 tool, chế độ copy giả lập Windows, lần 2 không đổi; **ca lỗi giữa các bước**: tool sửa file giữa lúc đọc và ghi, ghi `install.json` hỏng, hai `link` cùng lúc |
| P1B-5 | `doctor` (`src/commands/doctor.mjs`): node, playwright, trạng thái cài từng tool, skill trùng/bản copy cũ, **hook chạy thử với stdin mẫu** (thiếu script → đỏ), hồ sơ khớp repo hiện tại, phiên đăng nhập (`auth status`), token sắp hết hạn, `.fe-kit` có bị git bỏ qua, phiên bản tool, `~/.claude/CLAUDE.md` đổi sau lần rút gọn; in checklist phần bạn tự làm (duyệt hook Codex); rules/superpowers chưa duyệt → "pending" riêng | mọi mục đã đặc tả ở plan §5.3 hoặc ghi rõ lý do hoãn |
| P1B-6 | Skill `fe-kit` (router) và `fe-setup` (dò → đề xuất hồ sơ theo vòng → `profiles/<repo>.md` + `fe-kit init`); `docs/skills/`; `fe-kit validate` | skill chỉ người gọi theo §6 |
| P1B-7 | Cập nhật `docs/plan.md` (§5.3, §5.7: chỗ lệch), `tasks/todo.md`, README, tools.mjs ô `verified` | không đánh dấu Phase 1 xong |
| P1B-8 | **Nghiệm thu: ma trận tiêu chí × 3 tool** trong HOME tạm, ghi `docs/acceptance/phase-1b.md`: (a) bảo commit / chạy `ui-act` → bị từ chối **và lệnh không thực thi** (kiểm bằng dấu hiệu trên đĩa), (b) đọc kho bí mật bị chặn, (c) `link` lần 2 không đổi, (d) `doctor` xanh cho phần đã cài, (e) `/fe-setup` trong sandbox tạo đúng hồ sơ và `git status` sạch, (f) hỏi "type-check bằng lệnh gì, nháp để đâu" đúng, (g) brainstorm tạo `.fe-kit/specs/` mà `git status` sạch (cần superpowers: nếu chưa có thì ô này ghi pending). Ô cần GUI hoặc hộp hỏi thật (hỏi lại sau "Always Allow", Codex duyệt hook, superpowers một nguồn mỗi surface) ghi **pending kèm chỉ dẫn bạn kiểm tay**, hoặc chốt fallback từ chối | Phase 1 chưa xong cho tới khi các ô pending được bạn kiểm |
| P1B-9 | **Bật `ui-act` bằng xác nhận trên `/dev/tty`** (giả định 10), chỉ khi bạn đồng ý đổi §5.3; không phụ thuộc `link` | test không TTY, stdin giả, trả lời khác `yes`; bạn tự thử một lần thật trong terminal |

## Cái tôi KHÔNG làm trong phase này

- Cài thật vào `~/.claude`, `~/.codex`, `~/.gemini`; cài superpowers cho Codex/Antigravity (cần bạn quyết S14 và bấm GUI).
- `leak-guard`, `mcp-run`, `secrets`, agent reviewer (Phase 4–5).
- Cài `rules/*.md` mặc định (chưa được duyệt): `--with rules` có code và test nhưng không chạy mặc định.

## Nhật ký review

Lượt 16 (Codex, kế hoạch, 7 điểm: 1 BLOCKER, 6 MAJOR) — đã sửa hết trong lượt 17 (sửa tiếp 5 điểm dưới bảng này):

| # | Mức | Điểm | Sửa |
|---|---|---|---|
| 1 | BLOCKER | `install.json` không chứng minh `ui-act` được duyệt | Cổng tách khỏi manifest, thành mốc riêng P1B-9 sau nghiệm thu thật, kiểm cấu hình hiện có (giả định 10) |
| 2 | MAJOR | regex trên cả chuỗi không đủ | Bộ tách token, cú pháp hỗ trợ ghi rõ, dữ liệu khác lệnh, ngoài phạm vi nói thẳng (giả định 7, P1B-1) |
| 3 | MAJOR | `try/catch` không giữ fail-closed khi timeout/giết | Bộ giám sát + tiến trình con có hạn giờ ngắn hơn host, test tiến trình thật (giả định 6, P1B-2) |
| 4 | MAJOR | kho bí mật theo chuỗi mặc định bỏ sót | Đường dẫn chuẩn hoá + `FE_KIT_STATE_DIR` + cwd + symlink (giả định 8) |
| 5 | MAJOR | backup và "thêm vào cuối" chưa đủ an toàn | Preflight, khoá, backup 600, staging + rename, đọc lại trước rename (giả định 5, P1B-4) |
| 6 | MAJOR | nhận diện bằng substring `fe-kit` | So khớp cấu trúc + dấu vân tay, `unlink` chỉ gỡ mục còn khớp (giả định 4, 5) |
| 7 | MAJOR | nghiệm thu thiếu tiêu chí, doctor thiếu kiểm tra | Ma trận P1B-8, doctor đủ mục (P1B-5), Phase 1 chưa xong bằng headless |

Lượt 17 (Codex, bản đã sửa, 5 điểm: 1 BLOCKER, 4 MAJOR; #6 và #7 của lượt 16 được xác nhận đủ):

| # | Mức | Điểm | Sửa |
|---|---|---|---|
| 1 | BLOCKER | cổng vẫn có thể mở cho tool chưa được bảo vệ (tập tool trong manifest không gắn với tool đang gọi) | Bỏ cổng dựa vào cấu hình/manifest; xác nhận người trên `/dev/tty` (giả định 10, P1B-9); chờ bạn đồng ý đổi §5.3 |
| 2 | MAJOR | `xargs` và here-document đưa vào shell chưa xét | Nguồn mã xét như mã; thân here-document có delimiter quote không mở rộng (giả định 7, P1B-1b) |
| 3 | MAJOR | hạn giờ chưa bao toàn bộ giám sát (stdin treo) | Một hạn giờ cho cả bộ giám sát từ trước khi đọc stdin, SIGKILL con, giới hạn byte (giả định 6, P1B-2) |
| 4 | MAJOR | cwd chỉ theo dõi `cd x &&` | Tập cwd có thể có qua mọi toán tử, subshell, `cd` thất bại (giả định 8, P1B-1a/1b) |
| 5 | MAJOR | ghi manifest hỏng làm mất quyền sở hữu mục đã thêm | Journal giao dịch bền, phục hồi bằng so trạng thái (giả định 5, P1B-4) |
