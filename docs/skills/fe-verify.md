# fe-verify

## What it does
Trước khi agent báo "xong", commit hoặc mở MR, skill này chạy `fe-kit verify`: **scan** (luật trên các dòng thêm mới), **lint**, **type-check**, **test của dự án** và **test local** (`.fe-kit/tests`), theo phần đã đổi. Mọi bước đều chạy dù bước trước đỏ. Lệnh nào dự án không có thì bước đó `SKIP` kèm lý do và nằm trong dòng `Not verified`; kit không đoán lệnh. Kết quả đầy đủ ghi ở `.fe-kit/reports/verify-<giờ>.md`.

Chi tiết các bước:
- `scan`: mỗi phát hiện kèm file, dòng và luật (`any`, `dangerouslySetInnerHTML`, `eval`, `innerHTML =`, `.only`/`.skip`, `console.log`, conflict marker, nhắc tới `.fe-kit/`; thêm luật của hồ sơ trong `scan:`).
- `lint`: lệnh lấy từ script `lint` hoặc `commands.lint` của hồ sơ. Nếu lệnh có `{files}` thì chỉ chạy trên file JS/TS đã đổi (xếp theo lô khi danh sách dài).
- `typecheck`: script `typecheck` (hoặc `type-check`, `check-types`, `tsc`) hoặc `commands.typecheck`. Dự án chỉ có `build` thì bước này `SKIP`; thêm `commands.typecheck` vào hồ sơ nếu muốn.
- `test`: lệnh test của dự án; với vitest, kit thêm `--exclude '.fe-kit/**'`, với jest thêm `--testPathIgnorePatterns` (xem dưới), để test local không chạy lẫn vào.
- `local-test`: test trong `.fe-kit/tests` chạy bằng vitest hoặc jest của dự án. Vitest: qua file cấu hình phủ do kit sinh (thay hẳn `test.include`). Jest: qua `--roots` và `--testMatch` đặt trên dòng lệnh.

## When to reach
- Agent sắp nói "xong", sắp commit, sắp viết mô tả MR. Skill model tự gọi; gọi tay khi bạn muốn kiểm lại.

## Common questions
- **Nó có đổi file của dự án không?** Chính `fe-kit` chỉ ghi vào `.fe-kit/` (git bỏ qua): báo cáo và file cấu hình phủ cho test local. Còn các script lint, type-check, test của dự án vẫn chạy như bình thường nên có thể ghi những gì chúng vẫn ghi (cache build, hoặc sửa file nếu script có `--fix`). Nếu bạn dặn "đừng ghi gì cả", agent phải hỏi trước khi chạy. Trong workspace chỉ-đọc, các bước vẫn chạy; chỉ test local và báo cáo bị bỏ qua kèm lý do.
- **Báo cáo nằm đâu?** `.fe-kit/reports/`. Chưa chạy `fe-kit init` thì kết quả vẫn in ra nhưng không ghi báo cáo (cảnh báo), để file không lọt vào `git status`.
- **Bước nào đó đỏ do code cũ?** Vẫn báo; agent nói rõ là đã đỏ từ trước và không tự sửa phần không liên quan.
- **`scan` chặn một chỗ cố ý?** Chưa có cách bỏ qua từng dòng (cố ý, để luật chính xác dần qua `fe-retro`). Agent nêu ngoại lệ với bạn.
- **Jest?** Có, cả hai bước: test local chạy bằng `--roots` của chính config cộng `.fe-kit/tests`; test dự án được thêm `--testPathIgnorePatterns` (đọc các pattern đang có bằng `--showConfig` qua đúng lệnh test của dự án, rồi thêm một pattern cho `.fe-kit`). Jest nhiều `projects` chưa hỗ trợ: bước `local-test` bị bỏ qua kèm lý do, còn test dự án chạy nguyên lệnh và có ghi chú.
- **Không bước nào chạy được thì sao?** Dòng kết là `Result: NOTHING VERIFIED` và lệnh thoát 1: không có gì được kiểm thì không được coi là qua. `PASSED` luôn kèm danh sách `Not verified` khi có bước bị bỏ qua.
- **`scan` bắt được gì, sót gì?** Là luật regex trên từng dòng thêm mới, đã bỏ comment và nội dung chuỗi; không phải AST. Bắt: `any` ở chỗ đứng của kiểu (`: any`, `as any`, `<any>`, `type X = any`, `=> any`, tuple, `keyof`/`readonly`/`is any`), `dangerouslySetInnerHTML`, `eval`/`new Function`/`(0, eval)()`, ghi HTML thô (`innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`), `.only`/`.skip` (và `fit`/`xit`… trong file test), `console.log`, conflict marker, nhắc tới `.fe-kit`. Sót hoặc nhầm trong vài dạng viết lạ: regex literal chứa dấu nháy, JSX có nhiều dấu nháy trên một dòng, chuỗi nhiều dòng, dòng `=======` đứng riêng trong file không phải tài liệu bị báo nhầm. Dòng dài hơn 2000 ký tự (mã đã nén) bị bỏ qua.
- **Giới hạn:** mỗi bước có timeout 15 phút; đầu ra giữ tối đa 2 MB (đầu và cuối); Windows chưa kiểm.

## It's working if
- Hỏi "xong chưa?": agent chạy `fe-kit verify` thay vì trả lời theo trí nhớ.
- Báo cáo của agent nêu lệnh và kết quả thật của từng bước, và nêu rõ bước nào chưa kiểm.
- Có `any` thêm mới, `dangerouslySetInnerHTML` thêm mới và một test đỏ: cả ba đều xuất hiện trong báo cáo.
- Có file mới `.fe-kit/reports/verify-*.md`; `git status` vẫn sạch.
- Bước đỏ: agent sửa nguyên nhân và chạy lại; không sửa test hay luật cho qua.
