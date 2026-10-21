# 0001. Superpowers là quy trình, fe-kit là tầng FE

## Bối cảnh

Cần một quy trình brainstorm → plan → TDD → review → verify chạy được trên Claude Code, Codex và Antigravity. Superpowers có plugin chính chủ cho cả ba.

## Quyết định

Dùng nguyên superpowers (ghim phiên bản, không fork). fe-kit chỉ thêm skill FE và một khối chỉ dẫn luôn bật (`fe-kit-core`) ghi đè hai chỗ: spec và plan lưu vào `.fe-kit/` và không commit; hỏi theo vòng nhiều câu có đề xuất thay vì từng câu một. Không cài plugin của Matt Pocock song song, vì sẽ có hai bộ TDD, debug, review tranh nhau.

## Hệ quả

- Spike S13 trên Claude: overlay thắng. Spec được lưu ở `.fe-kit/specs/`, không commit, và Claude hỏi một vòng 6 câu đánh số kèm đề xuất (`docs/spike.md` §3.S13).
- Chưa kiểm trên Codex, Antigravity vì chưa cài superpowers cho chúng. Chạy lại sau khi cài và sau mỗi lần nâng superpowers (`UPSTREAM.md`).
- Nếu overlay không thắng trên một tool: dừng và quyết định giữa skill phủ nhỏ hoặc fork, không tự chọn.
