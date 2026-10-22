# fe-setup

## What it does
Lần đầu vào một repo, gõ `/fe-setup` (Codex: `$fe-setup`). Skill dò dự án (`fe-kit context --json`, CI, kiểu key Jira từ commit và tên nhánh, nhánh gốc, tài liệu chuẩn), **đề xuất hồ sơ theo vòng tối đa 6 câu**, mỗi câu kèm đề xuất và bằng chứng; sau khi bạn đồng ý mới ghi `<thư mục profiles của kit>/<tên>.md`, chạy lại `fe-kit context` để bắt cảnh báo của hồ sơ, rồi `fe-kit init --dry-run` và `fe-kit init`. Cuối cùng liệt kê việc còn thiếu: biến môi trường hồ sơ nhắc tới, phiên đăng nhập từng vai (`fe-kit auth login`), MCP (chưa có trong kit), `fe-kit doctor`.

## When to reach
- Một lần cho mỗi repo. Hồ sơ đã khớp thì skill cho bạn xem và hỏi có sửa không.

## Common questions
- **Hồ sơ nằm đâu?** Ở thư mục `profiles/` của kit (hoặc `FE_KIT_PROFILES_DIR`), **không** nằm trong repo dự án và không commit vào dự án. `fe-kit context` in dòng `Profiles folder:` và `Remotes:`.
- **Nó có đọc `.env` hay phiên đăng nhập không?** Không. Chỉ ghi nhận có `.env`. Giá trị bí mật không bao giờ vào hồ sơ: URL không công khai hoặc có credential đi qua `${env:TÊN}`, và skill không bao giờ xin bạn dán giá trị vào chat.
- **Nó ghi những gì?** Đúng hai việc, đều báo trước: file hồ sơ và `fe-kit init` (tạo `.fe-kit/`, và nối `AGENTS.md` với `CLAUDE.md` khi cần).
- **Bạn trả lời "không chắc" cho một mục?** Mục đó bỏ trống và nằm trong checklist cuối, không bịa giá trị. Đích có đăng nhập mà thiếu `session.loggedInMarker`/`session.probe` thì `fe-kit ui --role` từ chối chạy.

## It's working if
- Sau `/fe-setup` trong repo mới: có `profiles/<tên>.md`, `fe-kit context` hiện `Profile: <tên>` không cảnh báo, có `.fe-kit/` mà `git status` sạch.
- Checklist cuối nêu lệnh `fe-kit auth login --target … --role …` cho từng vai.
