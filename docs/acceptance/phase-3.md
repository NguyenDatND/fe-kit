# Nghiệm thu Phase 3 (phần lõi): xem UI thật

Ngày 2026-10-21. Chạy trong Claude Code, bằng bản sao của `fe-kit-sandbox` (Vite + React, đăng nhập giả hai vai `admin` và `staff`, phiên nằm trong bộ nhớ server nên khởi động lại server là hết phiên). Bản sao có `.fe-kit/` do `fe-kit init` tạo; thư mục phiên là thư mục tạm (`FE_KIT_STATE_DIR`), không ghi vào `~/.local`. Hồ sơ có hai đích trỏ cùng một server: `local` (có `start`, ghi được) và `shared` (không có `start`, nên mặc định **chỉ đọc**, mô phỏng một môi trường dùng chung).

## Kết quả theo danh sách của plan (§10, Phase 3)

| Tiêu chí | Kết quả |
|---|---|
| Sandbox 2 vai → ảnh và báo cáo có trong `.fe-kit/ui/` | **Đạt.** Mỗi vai ra 3 ảnh (mobile, tablet, desktop) và `report.md`, `report.json`. Xem ảnh: admin thấy "Admin tools", staff không thấy |
| Phiên hết hạn → đưa đúng lệnh đăng nhập lại | **Đạt.** Khởi động lại server rồi chạy `ui --role admin`: thoát mã 3, `Login: expired` kèm ba bằng chứng (trang là `/login`, form đăng nhập hiện, probe `/api/me` trả 401) và đúng lệnh `fe-kit auth login --target local --role admin` |
| `ui` trên đích `readOnly`: giá trị đã nhập giữ nguyên, request submit bị chặn, dữ liệu không đổi | **Đạt.** Điền form đăng nhập rồi bấm "Sign in": `POST /api/login` bị chặn, `expectValue` thấy tên đã nhập vẫn còn, và sau `goto /` trang vẫn đòi đăng nhập (không có phiên nào được tạo) |
| Kịch bản bắn thêm một request ghi thứ hai: bị chặn | **Đạt** (bằng một request ghi khác, không qua `ui-act`): bấm "Sign out" bằng một vai đã đăng nhập: `POST /api/logout` bị chặn và phiên vẫn sống (`expectText "Signed in as"` đạt sau `goto /`) |
| `ui-act --allow-request` khớp: hỏi rồi đúng một request đi qua | **Hoãn**, đúng kế hoạch: cần `shell-guard`. Lệnh và bộ chạy từ chối với mã 2 (có trong nhật ký). Cơ chế "đúng một request, một lần" được kiểm bằng test với Chromium thật (`tests/ui-act.test.mjs`, `tests/ui-guard.test.mjs`), không phải ở đây |
| Headless: bị chặn | **Hoãn** cùng `ui-act` (hộp hỏi của `shell-guard`) |

Phần "Phase 3 xong hẳn" còn lại sau `shell-guard` và `link`: nghiệm thu `ui-act` với hộp hỏi, và chạy `fe-kit ui` trong Codex (Chromium không chạy trong sandbox của Codex, cần rule `allow`).

## Khác với kịch bản người dùng thật
- `auth login` mở cửa sổ có giao diện và chờ bạn bấm Enter nên **bạn tự chạy**; ở đây phiên được tạo bằng một script đăng nhập qua form trong trình duyệt headless rồi ghi bằng đúng `saveSession` mà `auth login` dùng. Phần tương tác của `auth login` được kiểm bằng test với trình duyệt giả; bạn nên thử một lần thật.
- Chỉ chạy trong Claude Code. Codex và Antigravity chưa chạy lệnh `ui` (Codex cần rule `allow` do `link` cài).

## Điều chạy thật làm lộ ra, đã sửa
- Đầu ra của `ui` ồn: lỗi WebSocket của Vite dài nhiều dòng, lặp lại. Giờ mỗi thông điệp console chỉ hiện dòng đầu (cắt ở 160 ký tự; đầy đủ trong `report.md`) và dòng lặp gom thành một dòng kèm `(xN)`.
- Trình duyệt tự ghi một dòng console `Failed to load resource: net::ERR_BLOCKED_BY_CLIENT.Inspector` cho mỗi request bị chặn; dòng này không còn bị tính là lỗi console của trang (bộ chặn tự báo).
- Trên đích chỉ đọc, trang cần WebSocket sẽ trông hỏng: Vite HMR báo lỗi kết nối. Đó là cái giá đã ghi trong skill, không phải lỗi.

## Nhật ký (đường dẫn tương đối; thời điểm là của lần chạy này)

```
$ fe-kit dev start --target local
Started the dev server for local (pid 62052): http://localhost:5199
Log: .fe-kit/dev.log
Stop it with: fe-kit dev stop
exit 0

$ fe-kit dev status
The dev server for local (pid 62052) is running and answers at http://localhost:5199.
exit 0

saved the login of admin: 1 cookie(s)
saved the login of staff: 1 cookie(s)

$ fe-kit auth status --target local --role admin
Saved login for local as admin: 1 cookie, 0 origins, saved 2026-10-21, no cookie with an expiry date (session cookies only).
exit 0

$ fe-kit ui --target local --role admin --path /
fe-kit ui: local as admin (writable), http://localhost:5199/
Login: authenticated
Pictures:
  - .fe-kit/ui/2026-10-21T12-15-43-921Z-local-admin/page.mobile.png (375x812)
  - .fe-kit/ui/2026-10-21T12-15-43-921Z-local-admin/page.tablet.png (768x1024)
  - .fe-kit/ui/2026-10-21T12-15-43-921Z-local-admin/page.desktop.png (1280x800)
Console errors: none
Failed responses: none
Report: .fe-kit/ui/2026-10-21T12-15-43-921Z-local-admin/report.md
exit 0

$ fe-kit ui --target local --role staff --path /
fe-kit ui: local as staff (writable), http://localhost:5199/
Login: authenticated
Pictures:
  - .fe-kit/ui/2026-10-21T12-15-46-166Z-local-staff/page.mobile.png (375x812)
  - .fe-kit/ui/2026-10-21T12-15-46-166Z-local-staff/page.tablet.png (768x1024)
  - .fe-kit/ui/2026-10-21T12-15-46-166Z-local-staff/page.desktop.png (1280x800)
Console errors: none
Failed responses: none
Report: .fe-kit/ui/2026-10-21T12-15-46-166Z-local-staff/report.md
exit 0

$ fe-kit ui --target shared --path /login --steps steps-login-write.json
fe-kit ui: shared (read-only), http://localhost:5199/
Pictures:
  - .fe-kit/ui/2026-10-21T12-15-48-466Z-shared/page.desktop.png (1280x800)
Steps: 7 ok
Console errors: 12
  - console: [vite] failed to connect to websocket. (x3)
  - console: Failed to send error to Vite server: TypeError: Cannot read properties of undefined (reading 'send') (x3)
  - console: Failed to load resource: the server responded with a status of 401 (Unauthorized) (x6)
Failed responses: 6
  - 401 GET http://localhost:5199/api/me (x6)
Refused by the guard: 7
  - ws://localhost:5199/: a WebSocket can carry writes the guard cannot read (x6)
  - POST http://localhost:5199/api/login: the target is read-only: POST requests are refused
Report: .fe-kit/ui/2026-10-21T12-15-48-466Z-shared/report.md
exit 0

$ fe-kit ui --target shared --role admin --path / --steps steps-logout-write.json
fe-kit ui: shared as admin (read-only), http://localhost:5199/
Login: authenticated
Pictures:
  - .fe-kit/ui/2026-10-21T12-15-49-905Z-shared-admin/page.desktop.png (1280x800)
Steps: 5 ok
Console errors: 4
  - console: [vite] failed to connect to websocket. (x2)
  - console: Failed to send error to Vite server: TypeError: Cannot read properties of undefined (reading 'send') (x2)
Failed responses: none
Refused by the guard: 5
  - ws://localhost:5199/: a WebSocket can carry writes the guard cannot read (x4)
  - POST http://localhost:5199/api/logout: the target is read-only: POST requests are refused
Report: .fe-kit/ui/2026-10-21T12-15-49-905Z-shared-admin/report.md
exit 0

$ fe-kit dev stop && fe-kit dev start --target local
Stopped the dev server for local (pid 62052).
Started the dev server for local (pid 62476): http://localhost:5199

$ fe-kit ui --target local --role admin --path /
fe-kit ui: local as admin (writable), http://localhost:5199/
Login: expired (first page: the page is the login page (/login); first page: the login form is visible (loginMarker); first page: the probe /api/me answered 401)
  Log in again, yourself: fe-kit auth login --target local --role admin
Console errors: 4
  - console: Failed to load resource: the server responded with a status of 401 (Unauthorized) (x4)
Failed responses: 4
  - 401 GET http://localhost:5199/api/me (x4)
Report: .fe-kit/ui/2026-10-21T12-15-51-703Z-local-admin/report.md
exit 3

$ fe-kit ui-act --target shared --role admin --allow-request "POST http://localhost:5199/api/logout"
fe-kit: ui-act is not enabled yet: it lets a write request through on a read-only target, which needs shell-guard to show you the request first (see docs/plan.md, Phase 1)
exit 2

$ fe-kit dev stop
Stopped the dev server for local (pid 62476).
exit 0
processes listening on 5199 after stop: 0
```
