# Nghiệm thu Phase 2 (2026-10-19)

Mục tiêu (plan §10, Phase 2): trên một nhánh trong sandbox có **một `any`, một `dangerouslySetInnerHTML` và một test fail**, `fe-verify` ở cả 3 tool phải báo đủ 3, kèm lệnh và kết quả thật.

## Cách dựng

- **Bản sao của sandbox** (`~/Code/fe-kit-sandbox`), một repo git riêng trong thư mục tạm: một commit `base` sạch trên `main`, rồi nhánh `feature` có hai file mới `src/Panel.tsx` (có `data: any` và `dangerouslySetInnerHTML`) và `src/Panel.test.tsx` (test kỳ vọng `'bye'`, nhận `'hi'`). Không commit gì thêm trong sandbox thật.
- **Hồ sơ dự án** (ngoài repo kit, qua `FE_KIT_PROFILES_DIR`): `baseBranch: main` và `commands.typecheck: "npx tsc -b"`, vì sandbox chỉ có script `build`, không có `typecheck`.
- **Skill cho cả 3 tool qua thư mục cấp dự án** của bản sao (`.claude/skills/` cho Claude, `.agents/skills/` cho Codex và Antigravity), symlink tới `skills/` của kit; thư mục này nằm trong `.git/info/exclude`. Không đụng `~/.claude`, `~/.codex`, `~/.gemini`.
- `AGENTS.md` (cấp dự án, chỉ trong bản sao): nói `fe-kit` là `node …/bin/fe-kit.mjs`. Lý do: trong shell của Codex, `fe-kit` trên PATH là **stub của spike S4** (`~/.local/bin/fe-kit`), vì Codex dùng bản chụp PATH của shell đăng nhập, không nhận PATH ta đặt trước. Stub này che bản thật cho tới khi bạn chạy `spike/cleanup.sh` hoặc `fe-kit link` đặt đúng chỗ.
- Prompt (giống nhau cho cả 3): *"I think the work on this branch is done. Is it? Do not modify any of the project's source files."*
- Phiên bản: Claude Code 2.1.302 (`-p --setting-sources project --allowedTools "Bash(fe-kit:*)" Skill`), Codex 0.163.0 (`exec -s workspace-write`), `agy` 1.4.0 (`-p --dangerously-skip-permissions --sandbox`), Node 26.5.0, vitest 5.0.5.

## Kết quả của chính `fe-kit verify`

```
Verifying changes since main (merge-base db811477): 2 files, 11 added lines.
FAIL scan       2 findings
       src/Panel.tsx:1: no-explicit-any: explicit `any` turns type checking off; use a specific type or `unknown`
         export function Panel({ html, data }: { html: string; data: any }) {
       src/Panel.tsx:2: dangerously-set-inner-html: `dangerouslySetInnerHTML` renders raw HTML, an XSS risk; sanitize the input or avoid it
         return <div title={String(data)} dangerouslySetInnerHTML={{ __html: html }} />
PASS lint       npm run lint (0.2s)
PASS typecheck  npx tsc -b (0.8s)
FAIL test       npm run test -- --exclude '.fe-kit/**' (exit 1, 1.0s)
       > fe-kit-sandbox@0.0.0 test
       > vitest run --exclude .fe-kit/**
        RUN  v5.0.5 /Users/teavillageboy/.claude/jobs/d5aa9a63/tmp/accept/scenario
        ❯ src/Panel.test.tsx (1 test | 1 failed) 11ms
          × shows the html it is given 11ms
       ⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
        FAIL  src/Panel.test.tsx > shows the html it is given
       AssertionError: expected 'hi' to be 'bye' // Object.is equality
       Expected: "bye"
       Received: "hi"
        ❯ src/Panel.test.tsx:7:33
             5| it('shows the html it is given', () => {
             6|   const { container } = render(<Panel html="<b>hi</b>" data={1} />)
             7|   expect(container.textContent).toBe('bye')
              |                                 ^
             8| })
             9|
       ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯
        Test Files  1 failed | 1 passed (2)
             Tests  1 failed | 2 passed (3)
          Start at  00:44:49
          Duration  692ms (environment 70%, tests 14%, setup 13%, import 2%, transform 1%)
PASS local-test vitest run --config .fe-kit/vitest.overlay.config.mjs (0.4s)
Result: FAILED (scan, test).
Report: .fe-kit/reports/verify-2026-10-18T17-44-48-116Z.md
```

## Claude Code (headless)

- Skill `fe-verify` hiện ra trong danh sách skill của phiên (nguồn: `.claude/skills/`).
- 3 lần chạy song song với mô tả skill sau khi chỉnh: cả 3 gọi `Skill fe-verify` rồi `fe-kit verify`; cả 3 báo đủ `any`, `dangerouslySetInnerHTML` và test đỏ. Trước khi chỉnh mô tả: 1/2 lần gọi `fe-kit verify` (xem "Điều rút ra").
- Lệnh đã gọi (lần 1): Skill {"skill": "fe-verify"}; Bash {"command": "fe-kit verify 2>&1 | tail -60", "description": "Run fe-kit verification"}

Câu trả lời cuối (lần 1):

> Chưa xong. `fe-kit verify` vừa chạy cho kết quả **FAILED (scan, test)**.
> 
> | Bước | Kết quả |
> |---|---|
> | scan | **FAIL**, 2 phát hiện |
> | lint | PASS (`npm run lint`) |
> | typecheck | PASS (`npx tsc -b`) |
> | test | **FAIL**, exit 1 |
> | local-test | PASS |
> 
> **Hai phát hiện của scan**
> - `src/Panel.tsx:1` vi phạm `no-explicit-any`. Prop `data: any` tắt kiểm tra kiểu. Nên dùng `unknown` hoặc một kiểu cụ thể.
> - `src/Panel.tsx:2` vi phạm `dangerously-set-inner-html`. `html` được render thô nên có nguy cơ XSS. Cần sanitize đầu vào hoặc bỏ cách render này.
> 
> **Test hỏng**
> - Test `shows the html it is given` ở `src/Panel.test.tsx:7` hỏng.
> - Test mong đợi `'bye'` nhưng nhận `'hi'`. Với `html="<b>hi</b>"`, kết quả `'hi'` là đúng, nên có vẻ giá trị mong đợi trong test bị sai. Đây là phỏng đoán của tôi, cần bạn xác nhận ý định của test.
> 
> Cả hai file đều là file mới (untracked) trên nhánh này, nên lỗi nằm trong code của nhánh, không phải lỗi có sẵn từ trước.
> 
> Tôi chưa sửa gì vì bạn yêu cầu không sửa source file. `fe-kit verify` chỉ ghi vào `.fe-kit/`, thư mục git ignore. Báo cáo đầy đủ ở `.fe-kit/reports/verify-2026-10-18T17-30-48-960Z.md`.
> 
> Bạn có muốn tôi sửa các lỗi trên không? Với `dangerouslySetInnerHTML`, tôi cần biết `html` đến từ đâu để chọn giữa sanitize và bỏ hẳn. Tôi cũng chưa commit hay push gì.

## Codex (headless)

Đọc `.agents/skills/fe-verify/SKILL.md`, chạy `node …/fe-kit.mjs verify` (thoát 1), đọc báo cáo. Câu trả lời cuối:

> No—verification returned **FAILED (scan, test)**.
> 
> The blockers are:
> 
> - [Panel.tsx:1](/Users/teavillageboy/.claude/jobs/d5aa9a63/tmp/accept/scenario/src/Panel.tsx:1): explicit `any` violates the scan rule.
> - [Panel.tsx:2](/Users/teavillageboy/.claude/jobs/d5aa9a63/tmp/accept/scenario/src/Panel.tsx:2): unsanitized HTML rendering is flagged as an XSS risk.
> - [Panel.test.tsx:7](/Users/teavillageboy/.claude/jobs/d5aa9a63/tmp/accept/scenario/src/Panel.test.tsx:7): the test expects `"bye"` after rendering `"hi"`.
> 
> | Check | Command | Result |
> |---|---|---|
> | Scan | `fe-kit verify` scan step | 2 findings |
> | Lint | `npm run lint` | Exit 0 |
> | Types | `npx tsc -b` | Exit 0 |
> | Project tests | `npm run test -- --exclude '.fe-kit/**'` | Exit 1; 1 failed, 2 passed |
> | Local tests | `vitest run --config .fe-kit/vitest.overlay.config.mjs` | Exit 0; 1 passed |
> 
> Both Panel files are also untracked. I made no source changes.
> 
> [Full verification report](/Users/teavillageboy/.claude/jobs/d5aa9a63/tmp/accept/scenario/.fe-kit/reports/verify-2026-10-18T17-42-06-259Z.md)

## Antigravity `agy` (headless)

Hỏi riêng "liệt kê skill bạn thấy trong workspace" thì `agy` trả `fe-standards` và `fe-verify` (đọc được thư mục `.agents/skills/` cấp dự án, không cần cài toàn cục). Lần chạy prompt nghiệm thu này không có `FE_KIT_PROFILES_DIR` trong shell của `agy`, nên **không thấy hồ sơ**: bước `typecheck` được báo `SKIP` và nằm trong "Not verified", đúng thiết kế (không đoán lệnh). Câu trả lời cuối:

> No, the work on this branch is not done. 
> 
> Running `fe-kit verify` against the current changes returned:
> **`Result: FAILED (scan, test). Not verified: typecheck.`**
> 
> Full report: [verify-2026-10-18T17-43-11-630Z.md](file:///Users/teavillageboy/.claude/jobs/d5aa9a63/tmp/accept/scenario/.fe-kit/reports/verify-2026-10-18T17-43-11-630Z.md)
> 
> ---
> 
> ### Verification Breakdown
> 
> | Step | Status | Command / Details | Result |
> | :--- | :--- | :--- | :--- |
> | **`scan`** | **FAIL** | Rules check on added lines | **2 findings** |
> | **`lint`** | **PASS** | `npm run lint` | Exit code 0 (0.2s) |
> | **`typecheck`**| **SKIP** *(Not verified)* | None | Skipped: no `typecheck` script in `package.json` or `commands.typecheck` in profile |
> | **`test`** | **FAIL** | `npm run test -- --exclude '.fe-kit/**'` | Exit code 1 (1.0s): 1 failed test |
> | **`local-test`** | **PASS** | `vitest run --config .fe-kit/vitest.overlay.config.mjs` | Exit code 0 (0.4s) |
> 
> ---
> 
> ### Failures to Address
> 
> 1. **Rule Scan Failures** in [`src/Panel.tsx`](file:///Users/teavillageboy/.claude/jobs/d5aa9a63/tmp/accept/scenario/src/Panel.tsx#L1-L3):
>    - [`src/Panel.tsx:1`](file:///Users/teavillageboy/.claude/jobs/d5aa9a63/tmp/accept/scenario/src/Panel.tsx#L1) (`no-explicit-any`): Explicit `any` turns type checking off; use a specific type or `unknown`.
>    - [`src/Panel.tsx:2`](file:///Users/teavillageboy/.claude/jobs/d5aa9a63/tmp/accept/scenario/src/Panel.tsx#L2) (`dangerously-set-inner-html`): `dangerouslySetInnerHTML` renders raw HTML, presenting an XSS risk; sanitize the input or avoid it.
> 
> 2. **Test Failure** in [`src/Panel.test.tsx`](file:///Users/teavillageboy/.claude/jobs/d5aa9a63/tmp/accept/scenario/src/Panel.test.tsx#L5-L8):
>    - `shows the html it is given`:
>      ```text
>      AssertionError: expected 'hi' to be 'bye'
>      Expected: "bye"
>      Received: "hi"
>      ```
> 
> As requested, no source files were modified.

## Điều rút ra

1. **Đạt (headless):** cả 3 tool tìm được skill ở thư mục cấp dự án, chạy `fe-kit verify`, và báo đủ 3 vấn đề kèm lệnh và kết quả thật, kể cả bước bị bỏ qua.
2. **Sửa trong lúc nghiệm thu:** (a) `fe-kit <lệnh> --help` báo lỗi mã 2, và hai lần chạy Claude bỏ `fe-kit verify` sau khi thử `--help`; giờ mọi lệnh có `--help` (exit 0). (b) Mô tả skill cũ chỉ khớp 1/2 lần; mô tả mới nêu thêm các lúc gọi ("khi được hỏi việc đã xong/sẵn sàng chưa") khớp 3/3. (c) Một số lần chạy bỏ `fe-kit verify` vì prompt dặn "đừng đổi file nào" còn lệnh này ghi báo cáo; skill nay nói rõ nó chỉ ghi vào `.fe-kit/` (git bỏ qua) và nếu bạn cấm mọi thao tác ghi thì phải hỏi trước. (d) Workspace chỉ-đọc không còn làm `verify` sập: bước `local-test` và báo cáo bị bỏ qua kèm lý do.
3. **Chưa kiểm:** giao diện GUI của 3 tool (Antigravity App/IDE, Codex IDE); độ tin cậy gọi skill ngầm trên model GPT và Gemini (mới 1 mẫu mỗi bên); `fe-kit` trên PATH cho Codex khi chưa gỡ stub (xem trên).
