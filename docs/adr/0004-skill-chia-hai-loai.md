# 0004. Skill chia hai loại: người gọi và model tự gọi

## Bối cảnh

Skill nặng (dựng màn hình, sửa bug, review MR) tốn ngữ cảnh và có thể bị model GPT kích hoạt quá đà. Skill kỷ luật nhỏ thì nên tự được gọi đúng lúc.

## Quyết định

- **Người gọi**: `disable-model-invocation: true` (Claude) và `agents/openai.yaml` với `allow_implicit_invocation: false` (Codex). Description viết cho người đọc.
- **Model tự gọi**: description bắt đầu bằng "Use when…".
- Skill người gọi được gọi skill model tự gọi, không bao giờ gọi skill người gọi khác.

## Hệ quả

- Antigravity không có cơ chế "chỉ người gọi" (tài liệu xác nhận): description phải ghi rõ cách gọi, `validate` kiểm.
- `description` phải là YAML hợp lệ. Dấu `:` không bọc quote làm skill không nạp trên `agy` (changelog 1.3.6), nên `validate` parse frontmatter bằng YAML thật.
- Mỗi tool đọc một thư mục skill riêng (`docs/spike.md` §3.S1); `fe-kit link` sẽ đặt skill vào đúng thư mục của từng tool.
