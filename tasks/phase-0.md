# Phase 0 — Spike Implementation Plan

> **For agentic workers:** dùng `superpowers:executing-plans` (làm tại chỗ). Spike là thăm dò nên không viết test trước: mỗi task kết thúc bằng bằng chứng ghi vào `docs/spike.md`. Code spike nằm ở `spike/` (gitignored, xoá cuối phase). Chỉ `docs/spike.md` và `tests/fixtures/hooks/` được giữ.

**Goal:** Chốt bảng đích của từng tool (`src/lib/tools.mjs`, plan §6) bằng bằng chứng chạy thật, trước khi viết code Phase 1.

**Approach:** Mỗi spike là một giả thuyết của plan → lệnh → bằng chứng → kết luận (PASS / đổi thiết kế / cần bạn kiểm tay). Làm headless bằng CLI trước; chỗ chỉ GUI làm được thì vào checklist của bạn.

**Spec:** `docs/plan.md` §10 (Phase 0A), §5.7, §6.

**Trạng thái 2026-10-18:** phần headless xong ở Task 1, 3, 4, 5, 6 và phần CLI của Task 2. Còn chờ: bạn kiểm tay trên GUI, quyết định S14 (`docs/spike.md` §5). Kết quả chi tiết ở `docs/spike.md`.

## Global constraints

- Không commit, không push. Không đọc hay ghi `~/.claude.json`, `~/.codex/auth.json`, `~/.gemini/oauth_creds.json`.
- Hook, rule, skill sẵn có của bạn (hook `herdr` ở cả 3 tool) giữ nguyên. Cấu hình project-level đặt trong sandbox hoặc `spike/guard/`. Thứ nào đặt ở user-level thì ghi lệnh gỡ vào `spike/installed*.txt` ngay lúc tạo (`spike/cleanup.sh`).
- Thử lệnh bị bảo vệ chỉ trong repo scratch `spike/guard/<tool>`, dùng `touch ran-spike-guarded.flag` thay cho `git commit` để kết quả không lẫn với việc sandbox Codex vốn chặn ghi `.git`.
- Lệnh headless: `claude -p`, `codex exec`, `agy -p`. Hạ effort khi chạy spike để nhanh (vd `-c model_reasoning_effort="low"` cho Codex).

## Risks

1. Headless khác GUI (hook, hộp hỏi, PATH): mỗi kết luận ghi rõ "headless" hay "GUI".
2. Hook project-level cần workspace "trusted" (Codex): với Codex dùng `-c 'projects."<đường dẫn>".trust_level="trusted"'` thay vì sửa `config.toml`.
3. Kết quả phụ thuộc phiên bản và CLI tự cập nhật giữa phiên: ghi phiên bản cạnh mỗi kết luận.
4. Mỗi lần chạy CLI tốn token: chỉ chạy lại khi bằng chứng mơ hồ.

---

### Task 1: S0 — phiên bản, cập nhật, sandbox

**Files:** Create `~/Code/fe-kit-sandbox/` (Vite + React + TS, vitest + RTL, đăng nhập giả 2 vai).

- [x] Ghi phiên bản: claude 2.1.302; codex 0.163.0; Antigravity App 2.1.4, IDE 2.5.5, `agy` 1.4.0.
- [x] Scaffold sandbox + dependency (lint = `oxlint`).
- [x] App đăng nhập giả: cookie session trong bộ nhớ (khởi động lại dev server = hết phiên), 2 test RTL. `npx tsc -b`, `npm run lint`, `npm test`, `npm run build` đều xanh; API kiểm bằng curl.
- [ ] Việc bạn tự làm: cập nhật Antigravity App (2.1.4, plan §6 cần ≥ 2.18) nếu có bản mới.

### Task 2: S1 + S3 (phần CLI) — skill qua symlink

**Files:** `spike/skills/hello-fe-kit-{claude,agents,gcfg,gcli}/` (mỗi skill nằm đúng một thư mục tool, để biết tool nào đọc thư mục nào).

- [x] 4 skill, mỗi skill trả marker riêng từ `references/marker.md`.
- [x] Symlink vào `~/.claude/skills`, `~/.agents/skills`, `~/.gemini/config/skills`, `~/.gemini/antigravity-cli/skills`. Lệnh gỡ trong `spike/installed.txt`.
- [x] Claude, Codex, `agy` chạy headless: mỗi tool chỉ thấy skill ở đúng một thư mục; đổi marker thành `BETA` thì phiên mới thấy ngay.
- [x] Bảng tool × thư mục ghi ở `docs/spike.md` §3.S1.

### Task 3: S4 + S6 — PATH và sandbox mạng

**Files:** `~/.local/bin/fe-kit` (stub Node, gỡ cuối phase).

- [x] Claude, Codex, `agy` chạy được `fe-kit --version`.
- [x] `npm prefix -g` = `/opt/homebrew`; `which node` ổn định, `process.execPath` chứa số phiên bản. GUI: chờ kiểm tay.
- [x] Codex: mạng bị chặn kể cả loopback ở `read-only` và `workspace-write`; mở bằng `network_access=true`.
- [x] Thêm: Chromium không chạy trong sandbox Codex; rule `.rules` `allow` chạy được lệnh ngoài sandbox.

### Task 4: S5 + S10 — Playwright và vitest overlay

**Files:** `spike/s5.mjs`; `~/Code/fe-kit-sandbox/.fe-kit/tests/login-local.test.tsx`; `~/Code/fe-kit-sandbox/.fe-kit/vitest.overlay.config.ts`.

- [x] `s5.mjs`: đăng nhập bằng script, `storageState` (file 600), nạp ở context mới còn phiên; khởi động lại server thì bị đá về `/login`. Đăng nhập tay bằng cửa sổ có giao diện để Phase 3.
- [x] S10: overlay chạy đúng; `npm test` mặc định cũng nhặt `.fe-kit/tests`.

### Task 5: S8 — chỉ dẫn luôn bật nạp ở đâu

**Files:** `spike/s8-arm.sh`, `spike/prompts/s8.txt`.

- [x] Marker riêng cho Claude, Codex, Antigravity (user-level), cùng `CLAUDE.md` và `AGENTS.md` trong sandbox.
- [x] Claude, Codex, `agy` liệt kê token thấy được; Codex với fallback; thêm các biến thể `AGENTS.md → CLAUDE.md`, `GEMINI.md`, `@import`.
- [x] Gỡ marker, `cmp` xác nhận `~/.codex/AGENTS.md` về đúng 0 byte.

### Task 6: S9 + S12 (headless) — stdin của hook và guard

**Files:** `spike/hooklog.mjs`, `spike/guard-setup.sh`, `spike/guard-series.sh`; `tests/fixtures/hooks/<tool>/*.json`.

- [x] `hooklog.mjs` ghi stdin thô và trả lời theo chế độ `log | deny | ask | force_ask | exit2 | crash | badjson | timeout`.
- [x] Fixture thật của Claude, Codex (cả `apply_patch`), `agy`; đã làm sạch (`<HOME>`, UUID).
- [x] Series guard cho 3 tool; thêm cơ chế gốc: Claude `permissions.ask`, Codex `.rules` `prompt|forbidden`, `agy` `permissions.ask|deny`.
- [x] Codex dùng `--dangerously-bypass-hook-trust` chỉ trong spike (hook là script ghi log của tôi).
- [ ] Hộp hỏi GUI: chờ kiểm tay.

### Task 7: tổng kết

- [x] `docs/spike.md` kèm bảng S0–S14, bằng chứng, checklist việc bạn làm tay.
- [x] Sửa `docs/plan.md` §5.3, §5.7, §6, §12 theo kết quả.
- [x] S13 cho Claude (thêm so với kế hoạch ban đầu): overlay thắng superpowers.
- [ ] `spike/cleanup.sh`: chạy thật sau khi bạn kiểm GUI xong (đã chạy thử `--dry-run`).
- [ ] Cập nhật memory; hỏi bạn trước khi commit.
