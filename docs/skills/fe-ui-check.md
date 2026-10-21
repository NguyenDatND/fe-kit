# fe-ui-check

## What it does
Khi cần nhìn UI thật (tái hiện bug UI, kiểm một thay đổi trên màn hình, so với thiết kế), skill này chạy `fe-kit ui`: mở đích trong Chromium thật, chụp ảnh **cả trang** ở mobile, tablet và desktop (hoặc kích thước bạn chọn), ghi lỗi console, response ≥ 400 và request hỏng, chạy kịch bản bước nếu có. Ảnh và báo cáo nằm ở `.fe-kit/ui/<giờ>-<đích>[-vai]/` (`page.<viewport>.png`, `report.md`, `report.json`); git bỏ qua thư mục này.

Các lệnh liên quan:
- `fe-kit dev start|stop|status`: chạy dev server của đích có `start` ở nền (log `.fe-kit/dev.log`). `start` chờ địa chỉ trả lời, từ chối nếu đã có thứ khác trả lời ở địa chỉ đó, và không khởi động lần hai. `stop` chỉ dừng đúng nhóm tiến trình kit đã chạy (còn khớp bản ghi), không đụng tiến trình khác dù trùng pid.
- `fe-kit auth login|status --target --role`: **bạn tự chạy** để đăng nhập một lần cho mỗi vai (mở cửa sổ trình duyệt, đăng nhập xong quay lại bấm Enter). Phiên lưu ngoài dự án (`~/.local/state/fe-kit/auth/…`, file 600); `status` chỉ cho biết có bao nhiêu cookie và khi nào cookie đầu tiên hết hạn, không bao giờ in giá trị.
- `fe-kit ui --target --role --path --viewports --steps`: lệnh chính. Mã thoát: 0 ổn, 1 một bước hỏng hoặc quá giờ hoặc không xác minh được phiên, 2 dùng sai, **3 phiên đăng nhập đã mất hoặc chưa lưu**.

## Đích dùng chung chỉ đọc
Đích mà kit không tự chạy (không có `start`) mặc định là `readOnly`: mọi request ghi (POST, PUT, PATCH, DELETE) trang gửi đều bị chặn ở tầng mạng. Bấm và nhập thoải mái: giá trị đã nhập vẫn nằm trong ô, nút "Lưu" không lưu gì, và báo cáo liệt kê request bị chặn. Đích có `start` (dev server của bạn) cho ghi bình thường, trừ khi khai `readOnly: true`; đích không có `start` muốn ghi phải khai `readOnly: false`.

Ngoại lệ do hồ sơ khai trong `safeRequests`:
- Chuỗi `"POST /graphql"` là **GraphQL**: kiểm origin và đường dẫn đúng, đọc body (kể cả batch tối đa 100, body tối đa 1 MiB), chỉ cho `query`. `mutation`, `subscription`, persisted query không kèm văn bản, body đọc không được, query nằm trên URL đều bị chặn.
- Endpoint không phải GraphQL phải khai `{ request: "POST /search", body: "any" }`: bạn tự nhận trách nhiệm rằng nó chỉ đọc.

Request ghi được cho qua đi bằng đường riêng (`route.fetch`, không theo redirect): redirect sau đó bị chặn; request trang gửi không kèm cookie (`credentials: 'omit'`) bị từ chối khi phiên có cookie; lỗi gửi không bao giờ được gửi lại bằng cách khác.

## Hồ sơ cần khai gì
```yaml
targets:
  local:   { start: "pnpm dev", url: "http://localhost:5173", session: { loggedInMarker: "[data-user]" } }
  staging:
    url: "${env:SHOP_STAGING_URL}"
    safeRequests: ["POST /graphql"]
    session:
      loginPath: /login                 # mặc định /login; đúng cả đoạn đường dẫn, và chỉ tính trên chính đích
      loginMarker: "form#login"         # chỉ trang đăng nhập mới có; thấy nó là phiên đã mất
      loggedInMarker: "[data-user]"     # chỉ trang đã đăng nhập mới có
      probe: { path: /api/me, expired: [401], loggedIn: [200] }   # một GET chỉ đọc; không theo redirect; 403 không mặc định là hết phiên
roles: [admin, staff]
```
Chạy với `--role` cần ít nhất `loggedInMarker` hoặc `probe`, nếu không là lỗi cấu hình (mã 2): không có bằng chứng dương thì không thể nói phiên còn sống. Kết quả phiên là `authenticated`, `expired` (mã 3), `unknown` (mã 1) hoặc `not-required` (không dùng vai); bằng chứng hết phiên thắng bằng chứng còn sống. Phiên được kiểm sau trang đầu, sau mỗi bước `goto` và sau kịch bản. Một trang đăng nhập ở host khác không phải bằng chứng về phiên của đích.

## When to reach
- Agent cần xem màn hình thật, tái hiện bug UI, kiểm một thay đổi trên màn hình; `fe-verify` gọi nó khi thứ người dùng nhìn thấy đã đổi. Skill model tự gọi.

## Common questions
- **Phiên hết hạn thì sao?** `fe-kit ui` thoát mã 3 và in đúng lệnh `fe-kit auth login --target … --role …`. Agent không được tự đăng nhập hay đi tìm file phiên: nó nhờ bạn chạy lệnh đó ở terminal của bạn.
- **Vì sao kịch bản chỉ chạy một viewport?** Kịch bản chạy một lần: chạy lại cho từng kích thước thì bước "Lưu" gửi lặp trên đích ghi được. Dùng `--steps` cùng nhiều `--viewports` là lỗi cách dùng; chụp các kích thước khác bằng một lần chạy không có `--steps`.
- **Giá trị `fill` có vào báo cáo không?** Không: báo cáo ghi hành động và selector, không ghi giá trị đã nhập, không ghi cookie, token hay query string của URL.
- **Dòng `Result:`?** Cuối đầu ra: `ok`, `failed (lý do)` hoặc `login lost`. Ngoài bước hỏng, quá giờ, không mở được trang và phiên `unknown`, một request ghi **đã được cho qua rồi hỏng giữa đường** (lỗi gửi, bị redirect, lỗi của chính bộ chặn) cũng làm lệnh thoát 1: lúc đó trang chưa được xem trọn vẹn. Việc chặn một request ghi theo chính sách thì không phải lỗi.
- **Bí mật có lọt ra đầu ra không?** Kit che trong mọi chuỗi của kết quả: giá trị cookie và local storage của phiên đã lưu, giá trị bước `fill`/`expectValue` đã gõ, `Bearer …`, JWT, `token=…`/`password=…`/`cookie: …`, và cắt query string cùng fragment khỏi mọi địa chỉ (đường dẫn của bước `goto` chỉ giữ phần path). Che trước khi cắt ngắn. Không hoàn hảo: một bí mật kit không biết, ở dạng kit không nhận ra (một mã nằm trong thông điệp console), vẫn có thể lọt; đọc đầu ra console trước khi dán vào báo cáo.
- **Phiên lưu ở đâu, an toàn thế nào?** Thư mục `auth` và thư mục của hồ sơ phải là thư mục thật của bạn, chế độ 700; file phiên chế độ 600. Link, thư mục người khác vào được hoặc file người khác đọc được thì kit **từ chối đọc** (cả `ui` lẫn `auth status`) và nói lệnh `chmod` cần chạy. File mở không theo link.
- **Chạy `dev start` hai lần cùng lúc?** Mỗi dự án có một khoá (`.fe-kit/dev.lock`): lệnh thứ hai nói đang có lệnh `dev` khác chạy và không làm gì (thoát 1). Khoá của tiến trình đã chết thì bị bỏ qua. `dev.log` và `dev.pid` là link thì bị từ chối, không ghi xuyên.
- **Console error có làm lệnh đỏ không?** Không: console error và response ≥ 400 là phát hiện để đọc, lệnh vẫn thoát 0 nếu các bước ổn. Mã 1 chỉ khi một bước hỏng, quá giờ (mặc định 5 phút), không mở được trang hoặc không xác minh được phiên.
- **`ui-act` đâu?** Cơ chế có sẵn và có test, nhưng **chưa bật**: lệnh và bộ chạy đều từ chối (mã 2) cho tới khi có `shell-guard` (hiện hộp xác nhận kèm đúng request sẽ đi qua). Mở sớm thì agent tự gọi được `--allow-request` mà không ai duyệt.
- **Chặn chắc đến đâu?** Đã đo trên Chromium (lớp chặn lúc dỡ trang không bị tắt bằng `pageshow` giả, bằng cách đổi `Function.prototype.apply` hay `window.parent`, bằng `document.open()`, hay bằng `fetch` của một iframe; một iframe mà trang bên trên khác origin chỉ được đọc thuần): popup, iframe, form, worker, `<a ping>`, `sendBeacon` và `keepalive` đều bị chặn; service worker bị chặn; WebSocket bị đóng trước khi nối (trang cần WebSocket sẽ trông hỏng); request trang gửi **trong lúc đang đóng hoặc rời trang** không đi qua bộ chặn nên được vá bằng script chạy trong mọi frame. Không chặn được: một GET có tác dụng phụ, và một script Playwright do agent tự viết (kit không hứa chặn tuyệt đối, xem plan §5.8).
- **Codex?** Chromium không chạy trong sandbox của Codex (`MachPortRendezvousServer: Permission denied`): `fe-kit ui` ở đó phải chạy ngoài sandbox bằng rule `allow` do `fe-kit link` cài (Phase 1 phần còn lại, chưa làm).
- **Windows?** `dev` chưa hỗ trợ; chưa kiểm phần còn lại.

## It's working if
- Hỏi "màn hình này trông thế nào?": agent chạy `fe-kit ui`, mở ảnh và mô tả đúng ảnh, nêu viewport.
- Trên đích dùng chung, bấm "Lưu": không có gì được lưu, báo cáo có dòng `Refused by the guard`.
- Phiên hết hạn: lệnh thoát 3, agent đưa lệnh đăng nhập lại và chờ bạn, không tự xoay sở.
- Có `.fe-kit/ui/<giờ>-<đích>/report.md` và các ảnh; `git status` vẫn sạch.
- Báo cáo của agent nêu cả console error và response lỗi, kể cả khi lệnh thoát 0.
