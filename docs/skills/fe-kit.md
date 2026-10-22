# fe-kit

## What it does
Router cho người gọi: khi bạn không nhớ dùng skill nào hay đang ở bước nào, gõ `/fe-kit` (Codex: `$fe-kit`). Nó chạy `fe-kit context` và `git status` để biết bạn đang đứng đâu, mở `SKILL.md` của skill định gợi ý (không nói theo trí nhớ), rồi chỉ ra **bước tiếp theo** của luồng (kit + superpowers), **quyết định nào là của bạn**, và **nên tiếp tục, `/clear`, bàn giao hay giao subagent**. Gợi ý xong thì dừng; nó không tự chạy bước đó.

## When to reach
- Mới vào một repo: nó gợi ý `/fe-setup`.
- Có ý tưởng chưa chốt: brainstorming rồi writing-plans của superpowers (spec và plan nằm trong `.fe-kit/`).
- Cần nhìn UI thật: `fe-ui-check`. Sắp báo xong hoặc commit: `fe-verify`. Nghi máy chưa cài đủ: `fe-kit doctor`.

## Common questions
- **Sao không có `fe-screen`, `fe-bug`, `fe-review`…?** Chưa làm (các phase sau). Router nói thẳng là chưa có và chỉ skill superpowers thay thế (`systematic-debugging`, `test-driven-development`, `requesting-code-review`), không hứa skill chưa tồn tại.
- **Nó có tự gọi `fe-setup` không?** Không: `fe-kit` và `fe-setup` chỉ chạy khi bạn gõ. Skill người gọi không gọi skill người gọi khác.
- **Tool nào tự kích hoạt nó?** Claude: `disable-model-invocation: true`; Codex: `agents/openai.yaml` đặt `allow_implicit_invocation: false`. Antigravity không có cơ chế này (docs/spike.md): description ghi rõ "chỉ chạy khi bạn gõ /fe-kit".

## It's working if
- Hỏi "tiếp theo làm gì?": agent đọc `fe-kit context`, trả lời một bước kèm lý do, nêu quyết định của bạn, rồi dừng.
- Nó không nhắc tên skill nào không có trong danh sách skill.
