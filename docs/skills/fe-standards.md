# fe-standards

## What it does
Trước khi agent viết hoặc sửa file frontend, skill này chạy `fe-kit rules --files …` để biết **tài liệu chuẩn nào áp dụng cho đúng những file đó**, rồi chỉ đọc các tài liệu ấy. Nguồn gồm: tài liệu của dự án (khai trong `standards` của hồ sơ, hoặc mặc định `CONTRIBUTING.md`, `CLAUDE.md`, `AGENTS.md`) và 6 tài liệu chung của kit (`skills/fe-standards/references/`: typescript, react, next, testing, a11y, security). Chuẩn của dự án thắng chuẩn của kit.

Lệnh `fe-kit rules` khớp theo frontmatter của từng tài liệu: `paths:` (glob của file) và `frameworks:` (framework `fe-kit context` dò được, ví dụ `next`). Tài liệu không có frontmatter áp dụng cho mọi file.

## When to reach
- Agent sắp viết hoặc sửa component, hook, style, test, config.
- Không cần gọi tay: đây là skill model tự gọi ("Use when …"). Gọi tay khi bạn muốn nó đọc lại chuẩn trước khi sửa tiếp.

## Common questions
- **Tại sao không đọc hết thư mục docs?** Chuẩn chi tiết thuộc về reviewer; người viết code chỉ cần phần liên quan, để ngữ cảnh nhỏ.
- **Thêm chuẩn riêng của dự án thế nào?** Viết tài liệu markdown, thêm đường dẫn hoặc glob vào `standards:` trong `profiles/<dự-án>.md`. Muốn tài liệu chỉ áp dụng cho một số file, thêm `paths: ["src/**/*.tsx"]` ở đầu tài liệu.
- **Một tài liệu có `paths` hỏng thì sao?** Nó được coi là áp dụng cho mọi file và `fe-kit rules` in cảnh báo; với tài liệu của kit, `fe-kit validate` báo lỗi.
- **Giới hạn:** `fe-kit rules` chỉ khớp theo đường dẫn và framework; nó không hiểu nội dung file.

## It's working if
- Bảo agent sửa một file `.tsx`: trong lịch sử lệnh có `fe-kit rules --files …` trước khi nó viết.
- Nó chỉ đọc các tài liệu có trong danh sách; không mở cả `docs/`.
- Khi chuẩn của dự án mâu thuẫn với chuẩn của kit, nó theo dự án và nói một câu là theo cái nào.
- Sửa file `.css`: danh sách không có tài liệu typescript hay react.
