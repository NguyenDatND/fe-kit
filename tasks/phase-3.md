# Phase 3 — Xem UI thật

Nguồn: `docs/plan.md` §10 Phase 3, §5.3 (lệnh `auth`, `dev`, `ui`, `ui-act`), §5.4 (`targets`, `roles`), §5.8 (mô hình đe doạ), `docs/spike.md` S5, S6, S12.
Trạng thái: **phần lõi xong (2026-10-21)**: `auth`, `dev`, `ui`, chính sách request, bộ chặn, skill `fe-ui-check`, nghiệm thu headless trên sandbox (`docs/acceptance/phase-3.md`). Kế hoạch qua 2 lượt review Codex; code qua 3 lượt (xem cuối file). **Còn lại để "Phase 3 xong hẳn":** nghiệm thu `ui-act` với hộp hỏi của `shell-guard` và chạy `ui` trong Codex, cả hai sau `shell-guard`/`link` của Phase 1.

## Mục tiêu (tiêu chí xong)

Chạy `fe-kit ui --target --role --path` trên sandbox với 2 vai, ra ảnh chụp và báo cáo trong `.fe-kit/ui/`; phiên hết hạn thì thoát mã 3 kèm đúng lệnh đăng nhập lại; trên đích `readOnly` mọi request ghi bị chặn ở tầng mạng (trừ `safeRequests`); `ui-act` cho đúng một request ghi khai báo đi qua.

**Hai mốc, không gộp** (Codex #6): *Phase 3 lõi* = `auth`, `dev`, `ui`, chính sách request và cơ chế `ui-act` có test, nghiệm thu headless trên sandbox. *Phase 3 xong hẳn* = thêm nghiệm thu của `ui-act` (hộp hỏi, request thứ hai, headless), chỉ làm được sau `shell-guard`/`link` của Phase 1. Đến lúc đó phase chưa được đánh dấu xong.

## Giả định (sửa ngay nếu sai)

1. `playwright` vào `dependencies` của kit đúng plan §4 (hiện chỉ có `yaml`). Nạp bằng `import()` lười. Chromium đã có trong `~/Library/Caches/ms-playwright` (revision 1228 và 1248); nếu bản Playwright của kit đòi revision khác thì tôi dừng và hỏi trước khi chạy `npx playwright install` (ghi ra ngoài dự án).
2. Thư mục phiên mặc định `~/.local/state/fe-kit/auth/`, nhưng **mọi test và nghiệm thu dùng thư mục tạm** qua `FE_KIT_STATE_DIR`. Không ghi vào `~/.local` thật.
3. `auth login` mở Chromium có giao diện nên **bạn tự chạy**. Nghiệm thu của tôi đăng nhập sandbox bằng script vào thư mục tạm.
4. **Chặn request ghi** (sửa theo Codex #1, #4): tạo context mới với `serviceWorkers: 'block'`, `await context.route('**/*', …)` **trước mọi page và mọi điều hướng**, giữ route tới khi đóng context. Phương thức khác GET/HEAD/OPTIONS bị `abort`. Đã đối chiếu tài liệu Playwright: handler chỉ được gọi cho URL đầu của chuỗi redirect, Chromium tự theo các bước sau mà không hỏi lại. Vì vậy request ghi được phép đi qua (`safeRequests` hoặc `--allow-request`) **không chuyển tiếp bằng `route.continue()`** mà dùng `route.fetch({ maxRedirects: 0, maxRetries: 0 })` rồi `fulfill`; gặp 3xx thì chặn và báo rõ. `routeWebSocket` đăng ký ở context để WebSocket không đi lọt (ghi vào báo cáo nếu đích dùng). **Hợp đồng transport** (Codex lượt 2 #3, bước riêng P3-7b): `route.fetch` dùng cookie jar của context, gom đủ body và không stream, nên bản đầu chỉ cho request ghi có payload lấy đủ byte và response hữu hạn; upload file (multipart), endpoint streaming và request mà ngữ nghĩa `credentials` không giữ được thì **bị chặn rõ ràng, thoát 1**; lỗi transport không được rơi về `continue()` hay gửi lại. Fixture so sánh với request trình duyệt thật: Cookie, nhiều Set-Cookie, header của response, CORS, FormData có file, Blob. Giới hạn còn lại, ghi vào skill: một GET có tác dụng phụ không chặn được.
5. **`safeRequests`** (Codex #2): dạng chuỗi `"POST /graphql"` hiểu là **GraphQL**: so khớp origin của đích và đường dẫn đúng (không glob cả URL), đọc body JSON (kể cả mảng batch), chỉ cho `query`; `mutation`, `subscription`, persisted query không có văn bản và body không đọc được đều **bị chặn**. Giới hạn tài nguyên (Codex lượt 2 #4): kiểm kích thước buffer **trước** khi giải mã, tối đa 1 MiB và 100 phần tử batch; vượt thì chặn với lý do riêng; test sát ngưỡng và vượt ngưỡng, server đếm phải không nhận request bị chặn. Endpoint không phải GraphQL phải khai dạng đối tượng `{ request: "POST /search", body: "any" }`, tức bạn tự nhận trách nhiệm là chỉ đọc. Đổi theo đây ở `docs/plan.md` §5.4 và `validateProfile`.
6. **`--allow-request`** (Codex #3): một quota cho cả lần gọi CLI (mọi viewport và context dùng chung), chuyển sang "đã dùng" **đồng bộ, trước mọi `await`**, không hoàn lại khi lỗi hay timeout. Sau khi dùng quyền, mọi request ghi khác vẫn bị chặn. Redirect của request được phép bị chặn (giả định 4).
7. **Nhận biết hết phiên** (Codex lượt 1 #5, lượt 2 #2): bốn trạng thái `authenticated`, `expired`, `unknown`, `not-required` (không dùng vai). Khai trong `targets.<tên>.session`: bằng chứng **hết phiên** (`loginPath` kèm origin, mặc định `/login`; `loginMarker` là dấu hiệu DOM; `probe.expired`, mặc định chỉ `[401]`, **không** mặc định 403 vì có thể chỉ là thiếu quyền của phiên còn hiệu lực) và bằng chứng **đang đăng nhập** (`loggedInMarker` hoặc `probe` trả đúng danh tính). Chạy với `--role` mà đích không khai bằng chứng dương thì là **lỗi cấu hình, mã 2** (một lần, `/fe-setup` sẽ ghi sẵn). `expired` → mã 3 kèm đúng `--target`/`--role` để chạy lại `auth login`; `unknown` (có cấu hình nhưng không khớp gì) → mã 1. Kiểm ba lần: sau điều hướng đầu tiên, trước thao tác đầu của kịch bản, và sau kịch bản. Test đủ bốn trạng thái.
8. Chromium không chạy trong sandbox của Codex (S6); nghiệm thu chạy trong Claude Code. Phần Codex cần rule `allow` do `link`/`shell-guard` của Phase 1 cài.
9. **`ui-act`** (Codex lượt 1 #6, lượt 2 #1): khoá đặt **ở runner**, không chỉ ở `bin`: mọi `allowRequest` trong đường chạy production bị từ chối (`UsageError`, mã 2: "chưa bật: cần shell-guard") **trước khi tạo quota**, cho đến khi tích hợp quyết định duyệt của guard. Chính sách được test bằng transport giả và tuỳ chọn nội bộ chỉ test dùng; thêm test gọi trực tiếp handler và runner mà vẫn bị từ chối. Giới hạn nói thẳng (§5.8): một agent tự viết script Playwright riêng thì kit không chặn được; khoá này chỉ che đường lệnh và thư viện của kit. Không có người duyệt thì agent tự gọi `--allow-request` được, nên mở sớm là mở một lối vào bỏ qua `readOnly`.
10. Test cần trình duyệt tự bỏ qua (kèm lý do) khi Chromium không khởi động được; logic thuần (chính sách, kịch bản, kho phiên) không cần trình duyệt.

## Kế hoạch (TDD: test đỏ trước, rồi mutation; mỗi bước xong đều chạy cả bộ test)

| # | Việc | Ghi chú |
|---|---|---|
| P3-1 | `playwright` vào dependencies; `src/lib/browser.mjs` nạp lười, lỗi rõ khi thiếu | không tải trình duyệt |
| P3-2 | Kiểm `targets`/`roles`/`safeRequests` (hai dạng) trong `validateProfile`; `src/lib/targets.mjs`: chọn đích, nội suy `${env:…}`, `readOnly`, `loginPath`, `loginMarker`, `sessionProbe` | `profile.mjs` hiện chưa kiểm `targets` |
| P3-3 | `src/lib/request-policy.mjs` (thuần): cho hoặc chặn theo `readOnly`, `safeRequests` (GraphQL-aware, giới hạn 1 MiB và 100 phần tử), `--allow-request` (quota chung, đồng bộ) | test đồng thời, batch, nhiều operation chọn bằng `operationName`, document không có `operationName`, fragment, GET mang GraphQL, `application/graphql`, redirect, sát ngưỡng |
| P3-4 | `src/lib/auth-store.mjs`: đường dẫn, quyền 700/600, từ chối symlink, tên file an toàn, `status` không in nội dung | `FE_KIT_STATE_DIR` |
| P3-5 | Lệnh `auth login\|status` | `login` chỉ kiểm bằng seam giả; bạn chạy thật |
| P3-6 | `src/lib/ui-steps.mjs` (goto, click, fill, press, waitFor, screenshot, expectText, expectVisible) và `templates/ui-steps.json` | |
| P3-7 | `src/lib/ui-guard.mjs`: gắn chặn vào context (thứ tự đăng ký, `route.fetch` không theo redirect, `routeWebSocket`); test bằng một server đếm request thật: tải trang đầu, popup, iframe, form, worker, beacon, keepalive khi đóng trang, 307/308 cùng và khác origin | phần rủi ro nhất, tách riêng để review |
| P3-7b | Hợp đồng transport cho request ghi được phép (giả định 4): payload hữu hạn, từ chối upload file/streaming/credentials không giữ được, không fallback `continue()`; fixture so sánh với trình duyệt thật | Codex lượt 2 #3; trước P3-8 |
| P3-8 | `src/lib/ui-runner.mjs` + lệnh `ui`: storageState, viewport, lỗi console, response ≥ 400, bốn trạng thái phiên (3 khi `expired`, 1 khi `unknown`, 2 khi thiếu cấu hình), kiểm ba lần, ảnh và báo cáo vào `.fe-kit/ui/<thời điểm>/` | Chromium thật trên sandbox |
| P3-9 | `src/lib/dev-server.mjs` + lệnh `dev start\|stop\|status` (Codex #7): spawn detached, log vào `.fe-kit/`, `unref`, chờ sẵn sàng có hạn chót; lưu PID/PGID kèm thời điểm khởi chạy và lệnh; `stop` chỉ dừng tiến trình còn khớp | test PID cũ, start trùng; `exec.mjs` là cho lệnh một lần nên không dùng lại được |
| P3-10 | Lệnh `ui-act` (cùng bộ chạy, thêm `--allow-request`); runner và `bin` từ chối mã 2 cho đến khi có `shell-guard` | test gọi thẳng runner/handler |
| P3-11 | Skill `fe-ui-check`, trang `docs/skills/`, nối `bin`, README, plan, todo | |
| P3-12 | Nghiệm thu **phần lõi** trên bản sao sandbox, 2 vai (`docs/acceptance/phase-3.md`, không để đường dẫn cá nhân) | |
| P3-13 | Review độc lập (Codex nếu qua bộ lọc, nếu không thì agent con), sửa, mutation | |
| (sau) | Nghiệm thu `ui-act` đầy đủ sau `shell-guard`/`link` | mốc "Phase 3 xong hẳn" |

## Review Codex lượt 1 (kế hoạch, 2026-10-21; `spike/review/r11-report.md`)

| # | Mức | Điểm | Xử lý |
|---|---|---|---|
| 1 | BLOCKER | Redirect vượt chính sách: handler chỉ gọi cho request đầu (đã đối chiếu docs Playwright) | Giả định 4: `route.fetch({maxRedirects:0})` cho request ghi được phép; test 307/308 |
| 2 | BLOCKER | `POST /graphql` cho cả query lẫn mutation | Giả định 5: dạng chuỗi hiểu là GraphQL, chỉ cho `query`; dạng đối tượng cho endpoint khác |
| 3 | MAJOR | Quyền một lần chưa rõ phạm vi và thời điểm tiêu thụ | Giả định 6 |
| 4 | MAJOR | Vòng đời đăng ký route | Giả định 4 và P3-7 |
| 5 | MAJOR | URL cuối không đủ để kết luận hết phiên | Giả định 7 |
| 6 | MAJOR | P3-12 bỏ sót tiêu chí cần `shell-guard`; `ui-act` chưa được bảo vệ | Hai mốc; giả định 9 |
| 7 | MAJOR | Dev server nền không hợp với `exec.mjs` | P3-9 riêng |

Cả 7 điểm đúng; hai chỗ tôi chọn cách sửa hơi khác gợi ý: (2) vẫn cho endpoint không phải GraphQL qua dạng đối tượng có chủ ý, thay vì chặn hẳn; (6) giữ cơ chế `ui-act` trong thư viện nhưng đóng đường lệnh.

## Review Codex lượt 2 (bản đã sửa, 2026-10-21; `spike/review/r12-report.md`)

Codex xác nhận các điểm 1, 2, 3, 4, 5, 7 của lượt 1 đã sửa; điểm 6 chưa hết. Bốn điểm mới, đều đúng và đã đưa vào kế hoạch:

| # | Mức | Điểm | Xử lý |
|---|---|---|---|
| 1 | MAJOR | Khoá `ui-act` ở `bin` để ngỏ đường thư viện | Giả định 9: khoá ở runner, test gọi thẳng |
| 2 | MAJOR | Chỉ kiểm sau kịch bản; thiếu bằng chứng dương; 403 không nên mặc định là hết phiên | Giả định 7: bốn trạng thái, ba lần kiểm, thiếu cấu hình là mã 2 |
| 3 | MAJOR | Khác biệt của transport `route.fetch` chưa có giới hạn và test | Giả định 4 và bước P3-7b |
| 4 | MINOR | Đọc JSON/batch chưa giới hạn tài nguyên | Giả định 5: 1 MiB, 100 phần tử |

## Chưa làm có chủ ý

Hộp hỏi `ui-act` (cần `shell-guard`), chạy trong sandbox Codex (cần `link` + rule allow), kiểm tay trên GUI, đích dùng chung thật của công ty (chưa có quyền truy cập), `auth` bằng SSO/2FA đặc thù (bạn đăng nhập tay nên không cần code riêng).

## Rủi ro

- Chặn ở tầng mạng không biết GET nào ghi dữ liệu; `readOnly` là lớp giảm rủi ro, không phải bảo đảm tuyệt đối.
- `route.fetch` chạy request từ Node chứ không từ trình duyệt, nên một request ghi được phép có thể khác chút (CORS, một số header) so với lúc người dùng thật gửi. Chỉ áp dụng cho request ghi đã được cho phép, hiếm.
- `storageState` là bí mật: agent cùng tài khoản đọc được (mô hình §5.8). Lệnh của kit không in cookie hay token, và test phải chứng minh điều đó.
- Test có trình duyệt chậm và phụ thuộc máy; giữ ít và tách khỏi test logic.

## Review Codex cho code (3 lượt, 2026-10-21; `spike/review/r13-report.md`, `r14-report.md`, `r15-report.md`)

| Lượt | Kết quả | Việc đã làm |
|---|---|---|
| 13 | 1 BLOCKER + 6 MAJOR | `pageshow` giả tắt lớp chặn lúc dỡ trang (chỉ nhận sự kiện thật); bí mật lọt ra đầu ra (`scrub.mjs`); `dev.log`/`dev.pid` ghi xuyên symlink; start/stop đồng thời (khoá); đường đọc phiên bỏ qua symlink thư mục cha và quyền; lỗi guard/transport vẫn thoát 0 (`problemsOf`, dòng `Result:`); kiểm phiên cuối bị bỏ khi một bước hỏng |
| 14 | 1 BLOCKER + 5 MAJOR + 1 MINOR (và chưa hết điểm 2, 3, 4 cũ) | `Function.prototype.apply` đưa `fetch` gốc cho trang; **iframe cùng origin có cờ dỡ trang riêng (tôi tự tìm thấy khi thí nghiệm)**; khoá công bố nguyên tử; rollback sau spawn; URL có query ở đường xuất của `dev` và `auth`; JSON và IndexedDB trong `scrub`; lọc theo schema thay cho lọc cả kết quả; regex JWT/URL bậc hai; log cũ quyền 0644 |
| 15 (cuối) | 2 BLOCKER + 4 MAJOR + 1 MINOR | `window.parent` thay được (chụp trước, cờ ba trạng thái, frame khác origin chỉ cho đọc thuần); `document.open()` xoá listener (bọc `open`/`write`/`writeln`); record cũ có query; JSON có escape và dạng JSON của bí mật đã biết; selector/path/evidence còn sót; JWE khoá rỗng và JWT cuối câu. **MINOR chưa sửa:** hai lời gọi `withLock` tiếp quản cùng một khoá cũ trong một tiến trình sống lâu có thể để lại khoá bị coi là sống (CLI không bị: tiến trình thoát thì khoá hết hiệu lực) |

Sau lượt 15 tôi không gửi thêm lượt thứ tư (đã hết 3 lượt cho code). Mọi điểm đã sửa có test đỏ trước và mutation (các mutant tương đương còn sống được ghi trong `tasks/lessons.md`).

## Giới hạn đã biết của phần lõi

- Một GET có tác dụng phụ không chặn được; script Playwright agent tự viết nằm ngoài bộ chặn; Windows chưa hỗ trợ (`dev`) hoặc chưa kiểm.
- `credentials: 'omit'` bị từ chối khi phiên có cookie (`route.fetch` luôn gắn cookie).
- Bộ lọc bí mật không hoàn hảo: bí mật kit không biết, ở dạng không nhận ra, vẫn có thể lọt.
- Khoá của `dev` là khoá bằng file (Node không có khoá hệ điều hành): ba lệnh cùng một khoảnh khắc vẫn có thể thắng nhau; xem điểm MINOR lượt 15.
- Trang cần WebSocket sẽ trông hỏng trên đích chỉ đọc (Vite HMR báo lỗi kết nối).
- `ui-act` chưa bật; `auth login` tương tác chỉ kiểm bằng trình duyệt giả, bạn nên thử một lần thật.

