# Theo dõi upstream

Các repo nguồn đã clone ở `~/Code`. Cột "SHA" là bản đã đọc khi viết plan.

| Repo | Đường dẫn | SHA |
|---|---|---|
| superpowers | `~/Code/superpowers` | `bb92a77` |
| mattpocock/skills | `~/Code/skills` | `49dd158` |
| claude-plugins-official | `~/Code/claude-plugins-official` | `ea10b213` |

So lại khi upstream đổi:

```bash
git -C ~/Code/superpowers fetch && git -C ~/Code/superpowers diff bb92a77..origin/main --stat
```

Nâng superpowers là sự kiện cần chạy lại spike S13 (chỉ dẫn luôn bật của kit có còn thắng không), xem `docs/spike.md`.
