# 0002. Không dùng rulesync hay ruler

## Bối cảnh

Một nguồn chỉ dẫn cho nhiều tool nghe hợp lý, và đã có công cụ làm việc đó.

## Quyết định

Không dùng. rulesync đổi bản major liên tục và vẫn ghi vào chỗ prompt Codex đã bỏ. ruler không có hook và không cài ở mức user. Kit tự sinh phần khác nhau giữa các tool.

## Hệ quả

- Phần khác nhau lớn hơn dự kiến ban đầu: thư mục skill (Antigravity chỉ đọc `~/.gemini/config/skills`), cách nạp quy ước dự án (Codex và Antigravity không đọc `CLAUDE.md`), cách hỏi và chặn lệnh (hook, `.rules`, `permissions.ask`). Xem `docs/spike.md`.
- Vì vậy mọi khác biệt nằm ở một chỗ, `src/lib/tools.mjs`, mỗi ô ghi trạng thái đã kiểm (`headless`, `docs`, `pending`) kèm phiên bản.
