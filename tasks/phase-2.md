# Phase 2 — Kiểm chứng code

Mục tiêu: `fe-kit scan | rules | test | verify` và hai skill `fe-standards`, `fe-verify`.
Nghiệm thu (plan §10): branch trong sandbox có một `any`, một `dangerouslySetInnerHTML` và một test fail → `fe-verify` ở cả 3 tool báo đủ 3, kèm lệnh và kết quả thật.

## Giả định tôi đã chốt (bạn sửa được, tôi chưa có gì không thể đổi)

1. **`scan` quét dòng thêm mới** so với merge-base của nhánh nền. Nhánh nền: `--base` → `baseBranch` của profile → `origin/HEAD` → `origin/main|master` → `main|master` → `HEAD` (khi đó chỉ có thay đổi chưa commit). Gồm thay đổi chưa commit và file chưa theo dõi (không bị ignore). Repo chưa có commit nào thì mọi thứ là mới. `--scope all` quét mọi dòng của mọi file.
2. **Mọi phát hiện của `scan` làm `verify` đỏ** (thoát 1). Chưa có cách bỏ qua từng dòng; ghi ở "Chưa làm".
3. **`verify` chạy hết mọi bước**, không dừng ở bước đỏ đầu tiên, rồi báo tất cả. Bước không có lệnh thì `SKIP` kèm lý do; không bao giờ đoán lệnh (cùng luật với `context`) và báo "chưa kiểm" ở dòng kết.
4. **`{files}` trong lệnh lint** = các file JS/TS đã đổi (đã xoá thì bỏ); danh sách rỗng thì bỏ qua bước. Lệnh không có `{files}` chạy nguyên dự án. Type-check luôn nguyên dự án.
5. **Test dự án chạy với `--exclude '.fe-kit/**'`** (vitest, đã kiểm). Với `npm` thì chèn `--` trước. Jest và runner khác: theo kết quả kiểm thật (xem "Điểm mở").
6. **Overlay của `test` thay `test.include`, không `mergeConfig`.** Đã kiểm với vitest 5.0.5: `mergeConfig` nối mảng, nên khi dự án có `include` riêng thì overlay của spike chạy luôn test của dự án (2 file thay vì 1). Cách thay chạy đúng cả khi config gốc là hàm.
7. **`verify` và `test` không tự tạo `.fe-kit/`.** Chưa `init` (không có `.fe-kit/.gitignore` với `*`): `verify` vẫn chạy nhưng không ghi report và cảnh báo; `test` từ chối. Lý do: report nằm ngoài `.gitignore` là nháp lọt vào `git status`.
8. **Mỗi bước có timeout 15 phút**; quá hạn là bước đỏ. Đầu ra bỏ mã màu ANSI, giới hạn 2 MB (giữ đầu và cuối), qua `redactCredentials` một lần trước khi in hoặc ghi.
9. **Report: `.fe-kit/reports/verify-<ts>.md`**, đầy đủ đầu ra từng bước. Chuẩn đầu ra chính là văn bản; `--json` trả cấu trúc (có đoạn cuối đầu ra, không có toàn bộ).
10. **Chỉ hỗ trợ layout một package cho `test`** cho tới khi kiểm xong monorepo thật (ghi kết quả bên dưới).

## Việc làm (mỗi việc: test đỏ trước, rồi mã)

- [x] **P2-1 `src/lib/project.mjs`**: tách `resolveProject` ra khỏi `context` (hai lệnh mới dùng chung: gốc dự án, stack, profile khớp, lệnh, cảnh báo). Chỉ chuyển mã, 169 test hiện có là lưới an toàn.
- [x] **P2-2 `UsageError` + mã thoát 2** trong `bin/fe-kit.mjs`; `--json` in `{ "error": … }`.
- [x] **P2-3 `src/lib/glob.mjs`** (`**`, `*`, `?`, `{a,b}`, `[abc]`; chạy Node ≥ 20, không thêm phụ thuộc).
- [x] **P2-4 `src/lib/diff.mjs`** (`parseAddedLines`, theo số dòng của hunk, không theo tiền tố `+++`) với diff do git thật sinh ra.
- [x] **P2-5 `src/lib/changes.mjs`** (+ hàm git trong `git.mjs`): nhánh nền, merge-base, diff từ merge-base tới working tree, file chưa theo dõi, `--scope all`.
- [x] **P2-6 `scan`**: 8 luật chung, mỗi luật một fixture dương và một âm; bỏ comment và nội dung chuỗi; luật theo đuôi file; luật của profile (`scan:` trong frontmatter, kiểm trong `validateProfile`).
- [x] **P2-7 `src/lib/exec.mjs`** (`runCommand`: timeout, giới hạn đầu ra, bỏ ANSI, không dùng shell khi không cần).
- [x] **P2-8 `rules`** + `skills/fe-standards/references/{typescript,react,next,testing,a11y,security}.md` (mỗi file có `paths:`); `validate` kiểm `paths`.
- [x] **P2-9a `test` (vitest)**: tìm vitest của dự án, sinh overlay thay `include`, chạy; kiểm trên vitest 5.0.5 thật (bản sao sandbox: config thường, config có `include` riêng, config là hàm, monorepo `apps/web`).
- [x] **P2-9b jest**: theo bản kiểm jest 30.5.2 / 29.7.0 của subagent (xem "Bằng chứng jest" bên dưới); kiểm lại bằng jest thật (bản sao các dự án của subagent: config hẹp có alias và setup, config mặc định, jest 29): test local chạy, và `jest --listTests` cho thấy cờ của kit bỏ `.fe-kit/tests` khỏi lần chạy của dự án mà vẫn giữ `src/greet.spec.js`.
- [x] **P2-10 `verify`**: 5 bước, report, mã thoát.
- [x] **P2-11 skill `fe-standards`, `fe-verify`** + `docs/skills/*.md` (What it does · When to reach · Common questions · It's working if); `fe-kit validate` xanh.
- [ ] **P2-12 nối dây**: `bin/fe-kit.mjs` (AVAILABLE/PLANNED/HELP), README, `docs/plan.md` (chỗ lệch: overlay), `tasks/todo.md`.
- [x] **P2-13 nghiệm thu**: bản sao sandbox có `any`, `dangerouslySetInnerHTML`, test đỏ → `fe-kit verify` thật; headless trên 3 tool bằng thư mục skill cấp dự án (không đụng cấu hình toàn cục). Bản ghi: `docs/acceptance/phase-2.md`.
- [ ] **P2-14 review độc lập** (subagent) và sửa.

## Điểm mở

- **Jest**: đã có bằng chứng chạy thật (mục dưới); cài đặt là P2-9b.
- **Monorepo cho `test` (vitest)**: đã thử bằng vitest thật (`apps/web` có config và `node_modules`, test ở `.fe-kit/tests` của gốc): `include` trỏ ra ngoài package (`../../.fe-kit/tests/**`) chạy được; import theo tên từ test local (`@testing-library/react`) hỏng vì `.fe-kit` không có `node_modules`, đã sửa bằng plugin phân giải theo package trong overlay (chạy lại: 1 passed). Chưa thử pnpm với `node_modules` cách ly thật.
- **Antigravity trong nghiệm thu headless**: skill nằm ở `~/.gemini/config/skills` (cấu hình toàn cục). Nếu `agy` không đọc skill cấp dự án thì phần Antigravity chờ `fe-kit link` và sự đồng ý của bạn.

## Chưa làm (cố ý)

- Bỏ qua một phát hiện của `scan` bằng comment tại dòng; mức độ nặng/nhẹ theo luật.
- `scan` bằng AST (hiện là regex trên dòng thêm mới, theo plan).
- Windows: `{files}` được trích dẫn theo kiểu cmd nhưng chưa kiểm (Phase 8).

## Bằng chứng jest

Một subagent chạy jest thật (30.5.2 và 29.7.0, Node 26.5; scratch ở `$CLAUDE_JOB_DIR/tmp/jest-lab`, xoá được). Các kết luận dưới đây là đầu vào của P2-9b, chưa phải mã.

- Jest quét cả thư mục bắt đầu bằng dấu chấm: với config mặc định, `jest --listTests` liệt kê `.fe-kit/tests/*.test.js`.
- **Test local:** `jest <filter…> --roots=<từng root của configs[0].roots> --roots=<dự án>/.fe-kit/tests --testMatch=<rootDir>/.fe-kit/tests/**/*.test.{…} --coverage=false`; `roots` và `testRegex` lấy từ `jest --showConfig` (JSON ở stdout). Khi config dùng `testRegex` thì thay `--testMatch` bằng `--testRegex=[/\\]\.fe-kit[/\\]tests[/\\].*\.test\.[cm]?[jt]sx?$` (cả hai cùng đặt thì jest báo lỗi). Đã thử với config hẹp (`roots: ['<rootDir>/src']`, alias `moduleNameMapper`, `setupFilesAfterEnv`, transform riêng), `jest.config.js`/`.mjs`/`.ts`, khoá `jest` trong `package.json`, jest 29: alias, setup và transform vẫn có hiệu lực.
- Không dùng được: đường dẫn làm positional, `--runTestsByPath`, `--rootDir=.fe-kit`, và chỉ `--roots=.fe-kit/tests` (mất `__mocks__` của node module). Cờ dạng mảng nuốt positional đứng sau nó, nên filter phải đứng trước cờ. `.fe-kit/tests` không tồn tại thì jest báo Validation Error (kit tự kiểm trước). `coverageThreshold` của dự án làm lần chạy thoát 1 dù test qua, nên thêm `--coverage=false`.
- **Test dự án:** cờ mảng của dòng lệnh **thay** giá trị trong config, không nối. Công thức: đọc `testPathIgnorePatterns` hiệu lực bằng `--showConfig` **qua đúng đường chạy thật** (script có `--config=x` thì `jest --showConfig` trần đọc config khác), rồi lặp `--testPathIgnorePatterns=<p>` cho từng pattern và thêm `<rootDir>[/\\]\.fe-kit[/\\]`. Phải neo `<rootDir>`: pattern không neo làm mất sạch test khi một thư mục tổ tiên tên `.fe-kit`.
- `projects` (đa project): cả hai công thức đều vỡ, nên báo rõ là chưa hỗ trợ.
- Gọi binary trực tiếp bỏ qua biến môi trường và cờ của script `test` (ví dụ `NODE_OPTIONS=--experimental-vm-modules jest`): với test dự án phải đi qua script; với test local chạy binary trực tiếp, config kiểu đó có thể cần cùng biến (ghi là giới hạn).
- Jest 30 tự chuyển sang reporter `agent` (gọn, không có dòng PASS) khi có biến môi trường của agent (`CLAUDE_CODE`, `CODEX_SANDBOX`…); mã thoát không đổi.
- `CI=true` (kit đặt sẵn) làm jest không ghi snapshot mới và thoát 1 nếu thiếu; không đặt thì jest ghi snapshot mới vào cây làm việc. Chỉ `FORCE_COLOR=0` tắt màu chắc chắn (kit đặt sẵn). Open handle làm jest treo không thoát: đã có timeout của kit.
- Chưa kiểm: Windows, watchman, pnpm/yarn PnP, jest < 29, test local `.ts` chạy thật (mới kiểm discovery), đường dẫn dự án chứa ký tự glob.

## Review độc lập (2026-10-19)

Một subagent đọc mã mới, chạy thử trong thư mục tạm (vitest thật, Node 20.19.5 và 26.5), báo 17 điểm, mỗi điểm kèm tái hiện. Đã tái hiện lại từng điểm bằng test đỏ trước khi sửa (điểm 3 và 6 treo thật); sau khi sửa chạy lại kiểm đột biến của phần liên quan.

| # | Mức | Điểm | Xử lý |
|---|---|---|---|
| 1 | Important | `writeFile` overlay ghi xuyên symlink (file overlay hoặc chính `.fe-kit` là link) | `draftsAreReady` (thư mục thật + `.gitignore` có `*`) dùng chung cho báo cáo và overlay; `lstat` file overlay, không phải file thường thì từ chối |
| 2 | Important | `{files}` trong dấu nháy của hồ sơ: tên file thành mã shell; tên bắt đầu bằng `-` thành tuỳ chọn | `isQuoted` từ chối (bước `SKIP`, cảnh báo ngay ở hồ sơ); thêm `./` trước tên bắt đầu bằng `-` |
| 3 | Important | `clean()` bậc hai trên dòng dài (1 MB: treo > 5 phút) | tách dòng + `lastIndexOf`, tuyến tính; test dòng 1 MB < 3 s |
| 4 | Important | thêm đối số vào script `a && b` đưa cho `b` (đỏ giả, `.fe-kit/tests` không bị loại) | script có toán tử shell: giữ nguyên lệnh và ghi chú; chuyển hướng `2>&1` không tính là toán tử |
| 5 | Important | glob `[z-a]` làm `rules`/`scan` thoát 70 | glob không biên dịch được là không hợp lệ, không bao giờ khớp; cảnh báo ở hồ sơ, ở tài liệu (`paths`), và `validate` báo cho tài liệu của kit |
| 6 | Important | lệnh thoát 0 nhưng tiến trình nền giữ ống: chờ đến hết timeout rồi báo đỏ | chốt theo `exit`, chờ `drainMs`, dừng thứ còn lại |
| 7 | Important | overlay vitest hỏng với `test.dir`, `projects`/`workspace`, coverage có ngưỡng | `dir: undefined`; `projects`/`workspace` thì overlay dừng và bước thành `SKIP` kèm lý do; `--coverage.enabled=false` (cả ba kiểm lại bằng vitest thật) |
| 8 | Important | báo cáo cắt dòng còn 200 ký tự rồi mới che: lộ tiền tố mật khẩu | che trước khi cắt; đầu ra bị cắt ở ranh giới từ |
| 9 | Important | `any` sót `type X = any`, `=> any`, tuple, `readonly`, `keyof`, `is` | thêm các dạng, kèm ca âm |
| 10 | Important | `fit(`/`xit(` khớp cả phương thức (`model.fit(...)`) | chỉ gọi trần, chỉ ở file test |
| 11 | Minor | chỉ chuyển tiếp SIGINT/SIGTERM | thêm SIGHUP (SIGKILL không bắt được: giới hạn) |
| 12 | Minor | sót `outerHTML`, `insertAdjacentHTML`, `document.write`, `(0, eval)()`; nháy lẻ làm trống cả dòng; `=======` đứng riêng trong `.snap`/`.yaml` | thêm sink và eval gián tiếp; nháy `'`/`"` không đóng trong dòng không phải chuỗi. **Chưa làm:** `=======` riêng lẻ trong file không phải tài liệu vẫn bị báo (hiếm) |
| 13 | Minor | tên file có ký tự điều khiển: git viết bát phân | giải mã `\ooo` và `\a \b \f \v` |
| 14 | Minor | repo SHA-256 chưa có commit: cây rỗng sai | hỏi `rev-parse --show-object-format` |
| 15 | Minor | glob nhiều `*` bậc mũ | quá 6 cụm `*` là không hợp lệ |
| 16 | Minor | skill ghi "changes nothing in the project" nhưng script của dự án có thể ghi | sửa câu chữ ở skill và trang docs |
| 17 | Minor | khoảng trống test (dòng dài, tiến trình nền, SIGHUP) | đã thêm cùng các sửa trên |

Thêm ngoài danh sách: lần dò cấu hình jest chạy cả hook `pretest`/`posttest` của npm một lần nữa; nay dùng `--ignore-scripts` cho lần dò. `node --test` không tham số chạy `src/commands/test.mjs` và `src/lib/test-runner.mjs` như file test (tên khớp mẫu mặc định): `npm test` giới hạn ở `tests/*.test.mjs`.

Giới hạn còn lại đã biết (không sửa): `=======` đứng riêng ở file không phải tài liệu; `scan` là heuristic theo dòng (regex literal, JSX, chuỗi nhiều dòng); tên file có ký tự lạ đã kiểm trên macOS, chưa kiểm Windows.

## Review lượt 2 (2026-10-21, chỉ xem các bản sửa của lượt 1)

12 điểm; mỗi điểm đáng sửa đã có test đỏ trước rồi mới sửa, kiểm đột biến xong (582 test xanh).

| # | Điểm | Xử lý |
|---|---|---|
| 1 | cấu hình có `root` làm `local-test` đỏ giả (`dir: undefined` quay về `root`) | `dir` là đường dẫn tuyệt đối của package (kiểm lại với vitest 5.0.5 thật) |
| 2 | toán tử trong `commands.test` của hồ sơ (`npm test && ...`, `| tee`) vẫn bị nối `--exclude` (còn tạo file rác `--`) | kiểm toán tử trên cả lệnh của hồ sơ |
| 3 | thứ lệnh để lại mà đã chuyển hướng đầu ra thì sống mãi | dừng cả nhóm tiến trình khi chốt kết quả |
| 5 | `--ignore-scripts` không thêm khi lệnh đã có ` -- ` | chèn trước ` -- ` |
| 6b | giới hạn `*` đếm xuyên các nhánh `{}`, từ chối nhầm glob thật | đếm theo nhánh giàu nhất |
| 7 | `isQuoted` không hiểu chú thích `#` (từ chối nhầm, và lọt qua tên file có xuống dòng) | chú thích chạy tới hết dòng, `{files}` trong chú thích bị từ chối |
| 8 | `no-eval` báo `function eval(...)` trong `.d.ts` | bỏ file `.d.ts` và khai báo `function eval` |
| 9 | `exit` đặt hẹn giờ cả khi đã chốt | `if (settled) return` |

**Chưa sửa (ghi lại):** (4) đầu ra bị cắt mà không có khoảng trắng trong 4 KB gần mép (một token dài, JSON một dòng trên 2 MB) vẫn có thể để lại nửa mật khẩu; (6a) glob có 6 cụm `*` vẫn chậm với tên file dài bất thường (đồng bộ); (8) hàm cục bộ tên `fit` gọi trần trong file test bị báo là test; (10) `vitest.workspace.*` cạnh cấu hình (vitest ≤ 3) và `test.includeSource` chưa xử lý, chưa tái hiện được vì chỉ có vitest 5; (11) quyết định bỏ qua dựa trên đoạn văn bản trong đầu ra; (12) `|`/`;` trong dấu nháy của script làm mất bước loại `.fe-kit` (an toàn nhưng cụt).

**Khoảng trống test mà reviewer chỉ ra (T1–T9):** các test của `test`/`verify` dùng vitest và jest giả (kiểm dây nối, không kiểm hành vi thật); hành vi thật đã được kiểm tay bằng vitest 5.0.5 và jest 30.5.2/29.7.0 (ghi ở trên) nhưng chưa thành test tự động. Cách khắc phục đáng làm sau: một test tích hợp có điều kiện (chạy khi có `FE_KIT_SANDBOX`) dùng vitest thật.

## Review Codex qua herdr, lượt 1 (2026-10-21)

Codex (agent `reviewer`, chỉ đọc) báo 9 điểm (1 BLOCKER, 8 MAJOR), `VERDICT: CHANGES_REQUIRED`; báo cáo ở `spike/review/r6-report.md`. Mỗi điểm đã tái hiện bằng test đỏ rồi mới sửa, rồi kiểm đột biến (592 test xanh, lint sạch). Điểm 8 chỉ đỏ khi đầu ra đủ lớn (≥ 200 000 đoạn backtick trên Node 26) và khi chương trình con không tự `process.exit` (thoát sớm làm ống bị cắt ở 64 KB).

| # | Mức | Điểm | Xử lý |
|---|---|---|---|
| 1 | BLOCKER | `{files}` trong backtick (hoặc sau `<<` here-document) vẫn được mở rộng: tên file có backtick chạy mã | `isQuoted` coi backtick là dấu nháy và `<<` là vùng không an toàn → bước thành `SKIP` |
| 2 | MAJOR | `passWithNoTests: true` của dự án làm local test PASS khi không tìm thấy test nào | overlay đặt `passWithNoTests: false` (cả nhánh có và không có config) |
| 3 | MAJOR | scan PASS khi mọi file cần quét đều không đọc được | không dòng nào được quét mà có file bỏ qua → `SKIP` kèm danh sách file |
| 4 | MAJOR | overlay ghi xuyên hardlink vào file của dự án | xoá file cũ rồi tạo bằng cờ `wx` |
| 5 | MAJOR | tiến trình con tự tạo nhóm riêng (`detached`) sống sau timeout | **không sửa**: không có cách đáng tin trên POSIX nếu không có cgroup; đã có test ghi nhận giới hạn (`tests/exec.test.mjs`, "escaped the process group") và `drainMs` giúp lệnh vẫn trả kết quả |
| 6 | MAJOR | lỗi đọc file (EACCES) bị coi là file đã xoá | chỉ `ENOENT` là đã mất; lỗi khác vào `skipped` kèm mã lỗi |
| 7 | MAJOR | `push(...lines)` tràn ngăn xếp với file 200 000 dòng (dưới 1 MB) | vòng lặp |
| 8 | MAJOR | `Math.max(...matches)` trong `fence` tràn ngăn xếp, mất cả verdict | vòng lặp |
| 9 | MAJOR | `/* c */ code` ở đầu dòng làm `codeView` rỗng, luật không thấy mã phía sau | bỏ đường tắt cho dòng bắt đầu bằng `/*` (vòng lặp đã xử lý chú thích) |

Test của `verify` "files that were not read by the scan are named under it" đổi: nay có thêm một file có dòng để scan chạy (nếu chỉ có file không đọc được thì scan là SKIP, theo điểm 3).

## Review Codex qua herdr, lượt 2 (2026-10-21)

Codex xem các bản sửa của lượt 1: 7 điểm (1 BLOCKER, 5 MAJOR, 1 MINOR), `VERDICT: CHANGES_REQUIRED`; báo cáo ở `spike/review/r7-report.md`. Cũng tái hiện bằng test đỏ trước, kiểm đột biến xong (602 test xanh trên Node 26 và Node 20, lint sạch). Điểm 5 của lượt 1 (nhóm tiến trình tách riêng): Codex không đưa cách rẻ nào, giữ nguyên là giới hạn.

| # | Mức | Điểm | Xử lý |
|---|---|---|---|
| 1 | BLOCKER | `$'a\'{files}'`: trong `$'...'` dấu `\` thoát được nháy, `isQuoted` đọc sai nên `{files}` lọt ra ngoài | thêm trạng thái `$'` (backslash thoát ký tự kế) |
| 2 | MAJOR | `init` ghi nối vào `.fe-kit/.gitignore` là hardlink, hoặc `.git/info/exclude` là symlink: ghi xuyên sang file khác | `appendLine` từ chối symlink và file có nhiều hardlink; `init` ghi `skipped` và không tạo link AGENTS.md |
| 3 | MAJOR | hai package cùng dự án dùng chung đường dẫn overlay: chạy song song đọc nhầm của nhau | overlay mỗi package một tên (`vitest.overlay.<8 ký tự băm>.config.mjs`; gốc dự án giữ tên cũ); ghi vào file tạm rồi `rename` (nguyên tử, cũng thay luôn hardlink) |
| 4 | MAJOR | lỗi `lstat` (EACCES, thư mục cha không tìm được) bị coi là file đã xoá | chỉ ENOENT/ENOTDIR là đã mất; lỗi khác vào `skipped` |
| 5 | MAJOR | `fe-kit test -- --help` truyền `--help` cho runner: in trợ giúp, thoát 0, báo PASS; `--passWithNoTests` ghi đè overlay | đối số bắt đầu bằng `-` là `UsageError` (file tên bắt đầu bằng `-` viết `./-tên`) |
| 6 | MAJOR | `push(...danh sách lớn)` ở `validateProfile` và `lines.push('Warnings:', ...)` ở 4 lệnh tràn ngăn xếp (200 000 mục) | vòng lặp; `warningsBlock` trong `format.mjs` |
| 7 | MINOR | `$((1<<2))` bị nhận nhầm là here-document | đếm độ sâu `$(( ))`; `<<` trong đó là phép dịch bit |

Giới hạn còn lại của `isQuoted` (an toàn, từ chối thừa): `{files}` đứng trần trong `"$(...)"` bị từ chối như ở trong nháy; mọi `<<` ngoài `$(( ))` coi là here-document.

**Lượt 3 (2026-10-21) chưa có kết quả:** hai lần gửi (`spike/review/prompt-8.md`, rồi `prompt-9.md` với lời lẽ trung tính hơn) đều bị bộ lọc của Codex chặn ("flagged for possible cybersecurity risk", không có báo cáo; xem `task_complete` thứ 8 và 9 trong rollout). Không thử diễn đạt lại thêm. Các bản sửa của lượt 2 vì vậy mới được kiểm bằng test đỏ và kiểm đột biến, chưa có người đọc độc lập.

## Review độc lập lượt 3, bằng agent con (2026-10-21)

Vì lượt 3 của Codex bị chặn, một agent con của Claude (chỉ đọc, chạy thử trong thư mục tạm, fuzz có cấu trúc cho `isQuoted` với shell thật) review các bản sửa của lượt 2 và quét họ lỗi trong toàn `src/`. 7 điểm (1 BLOCKER, 3 MAJOR, 3 MINOR), `KẾT LUẬN: CẦN SỬA`. Đã tái hiện bằng test đỏ trước, sửa, kiểm đột biến (613 test xanh).

| # | Mức | Điểm | Xử lý |
|---|---|---|---|
| 1 | BLOCKER | nháy kép lồng trong `$(...)`, backtick hoặc `${...}` nằm trong chuỗi nháy kép: `isQuoted` đảo `"` một cấp nên `{files}` bị đọc là trần (`echo "$(echo "{files}")"`) | trong nháy kép, thấy `$(`, `${` hoặc backtick thì mọi `{files}` phía sau coi là trong nháy (từ chối thừa, phía an toàn) |
| 2 | MINOR | `$((echo a); echo b)` là subshell nhưng làm bộ đếm `$((` kẹt, `<<EOF` sau đó không còn là here-document | bỏ bộ đếm; `$((` chỉ coi là số học khi có `))` và bên trong không có `; & \| xuống dòng`, backtick, `$(`; vùng số học được bỏ qua |
| 3 | MAJOR | `fe-kit scan` thoát 0 "No findings (0 added lines)" khi mọi file bị bỏ qua | `scan` thoát 1 và in `Nothing was scanned: …` (cùng quy tắc với `verify`) |
| 4 | MAJOR | một file không đọc được (EACCES) cạnh file quét sạch: `verify` vẫn PASSED | `UNREADABLE` trong `changes.mjs`: file có mà không đọc được làm bước scan FAIL (và `scan` thoát 1, in `Could not read:`); binary, symlink, file quá lớn vẫn chỉ là ghi chú |
| 5 | MINOR | `fe-kit test` thoát 0 khi vitest workspace làm test local không chạy được | thoát 1 riêng cho lý do đó; "không có test local" vẫn là 0 |
| 6 | MINOR | `init --dry-run` nói khác chạy thật khi file đích là hardlink; `ensureExcluded` nuốt EACCES/EISDIR | `assertAppendable` dùng chung, gọi cả ở dry-run; `planDraftsIgnore` kiểm hardlink; chỉ ENOENT là rỗng |
| 7 | MINOR | `readdir` lỗi bị coi là thư mục rỗng (`walk`, `kitDocuments`) | `expandGlobs` trả `unreadable`; `rules` cảnh báo, `findLocalTests` báo lỗi (không nói "no local tests"); `kitDocuments` cảnh báo trừ ENOENT |

Agent con xác nhận đúng: tên overlay theo package và ghi nguyên tử, `readWhole` chỉ ENOENT/ENOTDIR là "gone", `fe-kit test -- --x` không vòng qua được, không còn spread mảng lớn trên dữ liệu theo dự án (trừ `Math.max` theo số nhánh `{a,b}` của một glob viết tay), các đường ghi của `init`/`writeReport`/`test-runner` đều chặn link; `fsx.installDirectory`/`backupFile` chưa có chỗ gọi (Phase 3), chưa kiểm sâu.

**Vòng cuối của Codex (2026-10-21) cũng không có kết quả:** `prompt-10.md` (nêu thẳng mục đích rà soát tính đúng đắn) lại bị bộ lọc của Codex chặn, không có báo cáo. Tổng cộng ba lần gửi sau lượt 2 đều bị chặn; không diễn đạt lại thêm. Lượt review cuối có người đọc là agent con (mục trên).
