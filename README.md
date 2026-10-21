# fe-kit

Bộ skill, agent và CLI cho dev Frontend, chạy giống nhau trên Claude Code, Codex và Antigravity. Là tầng FE nằm trên [superpowers](https://github.com/obra/superpowers): superpowers lo quy trình, fe-kit lo phần riêng của FE (kiểm chứng, xem UI thật, review, hồ sơ dự án) và vài chỉ dẫn luôn bật.

## Trạng thái

Phase 0 (spike) xong phần headless; Phase 1 xong phần không phụ thuộc GUI; Phase 2 (kiểm chứng code) xong phần code và nghiệm thu headless. Chưa cài gì vào thư mục toàn cục của bạn.

| Lệnh | Việc | Trạng thái |
|---|---|---|
| `fe-kit context` | Gốc dự án, hồ sơ khớp, stack và lệnh lấy từ `package.json` | có |
| `fe-kit init` | Tạo `.fe-kit/` trong dự án, nối `AGENTS.md` với `CLAUDE.md` | có |
| `fe-kit validate` | Kiểm skill của kit | có |
| `fe-kit scan` | Luật trên các dòng thêm mới (`any`, `innerHTML =`, `.only`, `console.log`…) | có |
| `fe-kit rules --files …` | Tài liệu chuẩn nào áp dụng cho các file sắp sửa | có |
| `fe-kit test` | Chạy test trong `.fe-kit/tests` bằng vitest hoặc jest của dự án | có |
| `fe-kit verify` | scan, lint, type-check, test dự án, test local; ghi báo cáo | có |
| `link`, `doctor`, `ui`, `mr`, `secrets`… | | chưa làm |

Skill: `fe-standards`, `fe-verify` (`skills/`, trang giải thích ở `docs/skills/`).

## Tài liệu

- `docs/plan.md`: thiết kế và kế hoạch từng phase.
- `docs/spike.md`: kết quả Phase 0, bằng chứng cho từng ô của bảng đích.
- `docs/adr/`: các quyết định nền.
- `tasks/`: kế hoạch và trạng thái từng phase (`todo.md` là điểm vào).

## Dùng thử

```bash
node bin/fe-kit.mjs context          # trong thư mục một dự án FE
node bin/fe-kit.mjs init --dry-run
node bin/fe-kit.mjs verify           # scan, lint, type-check, test; --json để máy đọc
npm test
```

Yêu cầu Node ≥ 20. Chỉ dùng Node, không script bash.
