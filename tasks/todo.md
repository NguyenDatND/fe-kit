# Todo

**Xong:**
- Phase 0A phần headless: `docs/spike.md`.
- Phase 1 phần không phụ thuộc GUI: khung repo, 4 ADR, `fsx`, `git`, `detect`, `profile`, `frontmatter`, `context`, `init`, `validate`, `tools.mjs`, hai bản nháp `rules/`. Đã qua review code độc lập (12 điểm) và 5 lượt Codex qua herdr (13 + 5 + 6 + 4 + 1 điểm, đã sửa hết); lượt 5 Codex nói `VERDICT: OK`. Chi tiết: `tasks/phase-1.md`, bài học: `tasks/lessons.md`.
- Phase 2 (kiểm chứng code), phần code và nghiệm thu headless: `fe-kit scan | rules | test | verify`, skill `fe-standards` và `fe-verify`, 6 tài liệu chuẩn chung (`skills/fe-standards/references/`), vitest và jest. 613 test xanh (Node 26 và Node 20), mỗi thành phần qua kiểm đột biến; đã chạy với vitest 5.0.5 và jest 30.5.2 / 29.7.0 thật; nghiệm thu trên bản sao sandbox với cả 3 tool (`docs/acceptance/phase-2.md`). Hai lượt review độc lập (17 + 12 điểm) và lượt 1 và 2 của Codex (9 + 7 điểm) và lượt 3 bằng agent con (7 điểm) đã xử lý, phần chưa sửa ghi ở `tasks/phase-2.md`. Kế hoạch, giả định và bằng chứng: `tasks/phase-2.md`.

- Phase 3 (xem UI thật), phần lõi: `fe-kit auth | dev | ui`, chính sách request GraphQL-aware, bộ chặn ghi trên đích chỉ đọc (đo trên Chromium thật), skill `fe-ui-check`, nghiệm thu headless trên sandbox (`docs/acceptance/phase-3.md`). Review Codex: kế hoạch 2 lượt, code 3 lượt (`tasks/phase-3.md`). `ui-act` có cơ chế và test nhưng **chưa bật** (cần `shell-guard`).

**Chờ bạn:**
- S-1: thu hồi khoá Figma đã lộ.
- Kiểm tay GUI và quyết định S14 (`docs/spike.md` §5).
- Duyệt `rules/personal-core.md` và `rules/fe-kit-core.md` (chưa cài vào đâu).
- Sandbox `fe-kit-sandbox` vẫn chưa có commit nào (bạn chọn chỉ đẩy `fe-kit` lên GitHub); một lần xoá nhầm là mất.
- Thử `fe-kit auth login --target <đích> --role <vai>` một lần thật trong terminal của bạn (nó mở cửa sổ trình duyệt và chờ Enter; tôi chỉ kiểm bằng trình duyệt giả).
- Stub `fe-kit` giả của spike (`~/.local/bin/fe-kit`) **che bản thật** trong shell của Codex (Codex dùng bản chụp PATH nên không nhận PATH ta đặt trước). Gỡ bằng `spike/cleanup.sh` sau khi kiểm GUI xong, hoặc cho phép tôi thay nó bằng symlink tới `bin/fe-kit.mjs`.
- Xem các chỗ Phase 2 lệch hoặc làm rõ plan (đã sửa trong `docs/plan.md` §5.3): overlay của `test` thay `include` thay vì `mergeConfig`; mọi phát hiện của `scan` làm `verify` đỏ; `verify` không tự tạo `.fe-kit/`.

**Sau khi bạn kiểm GUI xong:** điền ô GUI của `tools.mjs`; phần còn lại của Phase 1 (`link`/`unlink`/`doctor`, `shell-guard`, skill `fe-kit` và `fe-setup`, cài superpowers cho Codex và Antigravity). Khi `link` xong, nghiệm thu Phase 2 chạy lại bằng skill cài toàn cục thay cho thư mục cấp dự án.

**Nhớ dọn:** stub `fe-kit` giả ở `~/.local/bin`, 3 symlink `hello-fe-kit-*` và dev server sandbox ở cổng 5173 (đều do spike): `spike/cleanup.sh`. Thư mục tạm của Phase 2 (`$CLAUDE_JOB_DIR/tmp`: lab jest 1.1 GB, bản sao sandbox, kết quả nghiệm thu) xoá được khi bạn không cần xem lại.

**Giới hạn đã biết của Phase 2** (chưa làm, có chủ ý): bỏ qua một phát hiện của `scan` tại dòng; `scan` bằng AST; jest nhiều `projects`; yarn/bun và Windows chưa kiểm; Antigravity App/IDE và Codex IDE chưa kiểm (cần GUI); độ tin cậy gọi skill ngầm trên model GPT/Gemini mới có 1 mẫu mỗi bên.

**Backlog:** Phase 4–8 theo `docs/plan.md` §10, và phần còn lại của Phase 3 (nghiệm thu `ui-act`, `ui` trong Codex) sau khi có `shell-guard` và `link`.
