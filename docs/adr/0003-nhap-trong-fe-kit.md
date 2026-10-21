# 0003. Nháp nằm trong `.fe-kit/` của từng dự án

## Bối cảnh

Spec, plan, review, report, handoff và test chứng minh không được lọt vào code hay commit của dự án công ty. Superpowers mặc định ghi vào `docs/superpowers/` và commit.

## Quyết định

Mọi nháp ở `<dự-án>/.fe-kit/`, kèm `.fe-kit/.gitignore` chứa `*`. Chỉ dẫn luôn bật bảo các tool dùng đường dẫn này thay cho mặc định của skill khác.

## Hệ quả

- `.fe-kit/.gitignore` với `*` đủ để `git status` sạch, không cần sửa `.gitignore` của dự án hay `.git/info/exclude` (test của `init` chứng minh).
- Lệnh test mặc định của dự án **cũng nhặt** `.fe-kit/tests` (vitest, spike S10). `verify` phải loại `.fe-kit/**` khi chạy test dự án và chạy test local qua config phủ riêng.
- Test chứng minh theo chính sách của hồ sơ: dự án đã có bộ test thì commit như code (vẫn hỏi trước), chưa có thì giữ ở `.fe-kit/tests/`.
