# Lessons

Ghi sau mỗi lần bị sửa (người dùng hoặc reviewer): mẫu lỗi và luật để không lặp lại.

## 2026-10-18 — review Codex lượt 1 (code do tôi viết, 13 điểm)

1. **Tên tạm cố định rồi `rm -rf` là xoá nhầm đồ của người khác.** Mọi thư mục tạm dùng tên ngẫu nhiên (UUID) và chỉ dọn thứ do chính lời gọi tạo. Viết test "thư mục lạ đứng ở tên tạm kiểu cũ vẫn nguyên" trước khi viết code.
2. **Một file "dấu" chỉ có tên thì ai cũng giả được.** Trước khi coi một thư mục là của kit (và xoá nó), phải kiểm dấu là file thường, đúng hình dạng JSON. Khi ghi dấu: xoá thứ cùng tên mà nguồn mang tới, rồi ghi bằng `wx`.
3. **Thứ gì mình ghi vào mà người dùng hoặc nguồn có thể đã thay bằng symlink thì phải `lstat` trước** (`.fe-kit`, file trong nguồn, chính thư mục nguồn). Ghi xuyên symlink là ghi ra ngoài dự án.
4. **Giá trị biến môi trường không bao giờ đi ra output của CLI**, kể cả `--json`: output của kit là ngữ cảnh của mô hình. Giữ `${env:NAME}` nguyên văn, chỉ báo `set`/`missing`. Cùng luật với thông báo lỗi YAML: nó trích đoạn nguồn, nên chỉ lấy dòng đầu.
5. **Dữ liệu viết tay đúng cú pháp vẫn có thể sai kiểu** (`null`, `scripts: "bad"`, alias vòng). Kiểm kiểu ở biên, coi là dữ liệu xấu chứ không để ném lỗi ra tận `bin`. Test cho mỗi trường kiểu nào thì viết cả giá trị sai kiểu.
6. **"Có file ignore" không bằng "git bỏ qua nháp".** Khi tính chất cần bảo đảm là "git không thấy", hỏi chính git (`check-ignore`), đừng suy từ việc file tồn tại.
7. **Rút gọn một file chỉ dẫn từ bản gốc thì đối chiếu từng mục của bản gốc**, kể cả các nghĩa vụ về quy trình (todo, lessons, duyệt plan trước khi làm). Mục "không phải code" vẫn là chỉ dẫn.
8. **Ô `docs` phải có nguồn truy được**, nếu không là `pending`. "Tài liệu nói" mà không dẫn được trang nào là bịa.
9. **Sau khi sửa, phá thử từng bản sửa (kiểm đột biến)**: test nào không đỏ thì test đó chưa chứng minh gì.

## 2026-10-18 — review Codex lượt 2 (sửa của lượt 1, 5 điểm)

10. **Mã khôi phục không bao giờ xoá thứ nó đang khôi phục từ đó.** "Khôi phục lỗi thì `rm` bản cũ" là sai: lỗi khôi phục thường là lúc bản cũ là bản duy nhất. Giữ nó, nói đường dẫn trong lỗi. Lượt 2 tôi thêm ngoại lệ "trừ khi `target` đã có gì đó" và lượt 3 reviewer chọc đúng vào đó: "tồn tại" không chứng minh là bản thay thế hợp lệ. Ngoại lệ tôi tự thêm vào một luật an toàn là chỗ hỏng kế tiếp; luật không ngoại lệ vừa đơn giản vừa đúng. Kiểm bằng chèn lỗi (`t.mock.method` trên `fs.promises` kèm `syncBuiltinESMExports`), không bằng suy luận.
11. **Thông báo lỗi của thư viện trích nguồn, kể cả dòng đầu, và thư viện còn tự in cảnh báo ra stderr.** Với đầu vào có thể chứa bí mật: chỉ in mã lỗi và vị trí, tắt log của thư viện, và test bằng tiến trình thật quét cả stdout lẫn stderr.
12. **Lấy mẫu không phải chứng minh.** "Một tên probe bị ignore" không cho biết mọi nháp bị ignore. Chọn bất biến (dòng `*` ở `.gitignore` sâu nhất thì thắng mọi luật phía trên), ép bất biến bằng cấu trúc, rồi thử bằng cấu hình đối kháng của reviewer với git thật.
13. **Test an toàn phải phủ mọi đường mà bí mật đi vào, không chỉ đường tôi nghĩ ra.** Lượt 1 tôi chặn giá trị biến môi trường và quên mật khẩu viết thẳng trong hồ sơ. Liệt kê các đường vào trước khi viết test.
14. **Kiểm đột biến phải kiểm cả đột biến.** Mutant `a && b` trả về `b` nên không đổi gì và "sống sót" vì lý do sai; mutant sống sót thì xem lỗi ở mutant hay ở test trước khi kết luận.
15. **Tính chất của git thì đo bằng git** (ví dụ `.gitignore` là symlink bị bỏ qua), đừng dựa vào trí nhớ về cách git hoạt động.

## 2026-10-18 — review Codex lượt 3 (sửa của lượt 2, 6 điểm)

16. **Đọc file cấu hình của công cụ khác thì mô phỏng đúng parser của nó rồi kiểm bằng chính công cụ đó**, bằng bảng ca: git bỏ BOM, bỏ một CR, chỉ cắt dấu cách (không cắt tab, NBSP), luật cuối thắng. `trimEnd()` và "có dòng `*` đâu đó" đều sai.
17. **Che bí mật ở một điểm đầu ra duy nhất**, không ở từng chỗ in. Mỗi chỗ in mới (cảnh báo, scripts của `package.json`, khoá của map) là một kẽ hở mới; một lần lọc cuối cùng đóng cả họ.
18. **Regex trên cú pháp lồng nhau**: ký tự phân cách (`:`) cũng xuất hiện bên trong token lồng (`${env:NAME}`). Tách token trước khi tìm phân cách, và thử ca "chỉ có username", "nhiều token", "token ở giữa chữ".
19. **"Không biết" khác "không có".** Lỗi của lệnh phụ (`git ls-files` thoát 128) phải ra `null` và thành cảnh báo, không được gộp thành danh sách rỗng.
20. **Lọc bí mật bằng heuristic thì mỗi lượt review sẽ tìm thêm một kẽ.** Ghi giới hạn thẳng vào tài liệu và test; đừng hứa "không bao giờ in bí mật". Chỗ chặn chắc chắn duy nhất là không đưa bí mật vào hồ sơ (`${env:NAME}`).

## 2026-10-18 — review Codex lượt 4 (sửa của lượt 3, 4 điểm)

21. **Sửa một kẽ hở bằng cách thêm nhánh vào regex thì kẽ hở dời sang nhánh mới.** Nhánh `$` tôi thêm ở lượt 3 để cứu `${env:USER}@host` lại khiến `${env:}` dở dang chặn cả phép khớp. Với dữ liệu cần lọc bí mật, dùng bộ quét có trạng thái (tách token hợp lệ, rồi mới tìm dấu phân cách) và quy tắc an toàn cho ca không hiểu được: che hết.
22. **Công cụ có thể biến đổi lệnh của mình trước khi chạy.** Chuỗi thoát `﻿` và ` ` trong lệnh bị giải mã thành ký tự thô và ghi vào mã nguồn. Sau khi ghi file có ký tự đặc biệt, quét lại byte (BOM, NBSP, Cf/Zs/Cc), và dựng chuỗi thoát từ mã ký tự thay vì gõ thẳng.
23. **Sửa lỗi "ném lỗi khi không đọc được" thì sửa cả họ.** Cùng một `readFile(...).catch(() => '')` nằm ở hai nơi (`.fe-kit/.gitignore` và `info/exclude`); reviewer chỉ nêu một. Tìm mọi chỗ dùng cùng mẫu rồi mới kết luận.
24. **Mock phải hẹp đúng bằng lỗi muốn tái hiện.** Mock `rm` theo `includes('fe-kit-new-')` làm hỏng cả bước xoá file dấu và test xanh vì lý do sai; khớp đúng đường dẫn cần lỗi.

## 2026-10-18 — lượt 5: đổi thiết kế rồi reviewer nói OK

25. **Khi mỗi lượt review tìm thêm một kẽ ở cùng một họ lỗi, đổi thiết kế, đừng vá tiếp.** Ba lượt liền tôi vá cách "tìm đúng chỗ mật khẩu" (lượt 2, 3, 4 đều có kẽ mới). Đổi sang "không bao giờ in userinfo của URL" bỏ hết phần phân tích khỏi đường in, và lượt kế tiếp reviewer nói OK. Dấu hiệu nên đổi: số điểm không giảm, và điểm mới nằm trong chính bản sửa trước. Đề xuất đổi thiết kế là việc của kiến trúc sư (người dùng), nên hỏi chứ không tự làm.
26. **Regex bắt đầu bằng một lớp ký tự lặp (`[a-z][a-z0-9+.-]*:\/\/`) bị thử lại ở từng chữ cái của một từ dài, tức bậc hai.** Chỉ khớp phần cần thiết (`://userinfo@`) và đo thời gian với chuỗi `'a'.repeat(100_000)`; test ngưỡng thời gian rộng (500 ms so với vài ms của bản tuyến tính) để không chập chờn.

## 2026-10-19 — Phase 2 (tự rút ra khi làm, chưa qua review)

27. **Trong `node:test`, hook `t.after` chạy theo thứ tự đăng ký, không ngược lại.** Dọn thư mục tạm đăng ký trước nên xoá mất thư mục trước khi hook khôi phục quyền chạy (ENOENT). Khôi phục trong `try/finally` ngay trong thân test.
28. **Bộ chạy đột biến phải có giới hạn thời gian và diệt cả nhóm tiến trình.** Một mutant để lại tiến trình con làm `node --test` không bao giờ thoát; bộ chạy cũ đợi mãi và còn để nguyên file đã bị sửa. Kết quả "SURVIVED" của cả loạt hoá ra do `$T` không tách từ trong zsh (một đường dẫn chứa dấu cách): kiểm một lần chạy sạch (không đột biến) trước khi tin cả loạt.
29. **Một test dọn tiến trình mồ côi trong `finally` có thể che chính lỗi nó định bắt.** Lỗi "bỏ cuộc chờ mà vẫn giữ ống nên fe-kit không thoát" chỉ lộ khi chạy tình huống trong một tiến trình riêng và đòi nó tự thoát trong hạn.
30. **`mergeConfig` nối mảng.** Công thức của spike (`mergeConfig(base, { test: { include } })`) đúng với config của sandbox và sai với dự án có `include` riêng (chạy 2 file thay vì 1). Thử bằng cấu hình đối kháng (có `include`, config là hàm), không chỉ bằng cái đang cầm.
31. **Cách truyền đối số cho script khác nhau theo trình quản lý gói, đo thật chứ không nhớ:** npm nuốt `--exclude` thành tuỳ chọn của npm nếu thiếu `--`; pnpm chuyển luôn dấu `--` vào script. Thêm đối số cho lệnh của dự án phải theo từng trình quản lý, kèm test.
32. **Đột biến sống sót mà không thể quan sát được (điều kiện thừa) thì đơn giản hoá mã, đừng thêm test cho đủ.** `!result.error` thừa vì lỗi khởi động không bao giờ có mã thoát 0.
33. **Một khái niệm "đã qua" chỉ định nghĩa một chỗ, ở thư viện**, để lệnh `test` và `verify` không lệch nhau (trước đó mỗi nơi tự viết điều kiện).
34. **Fixture giả cho công cụ ngoài (vitest, jest) phải viết bằng cú pháp chạy được ở Node thấp nhất mà kit hỗ trợ** (CommonJS `require`, không `import` trong file không đuôi), nếu không test chỉ xanh trên máy có Node mới.
35. **`node --test` không tham số chạy mọi file tên `test.mjs` hoặc `test-*.mjs`, kể cả trong `src/`.** Lệnh `test` của kit (`src/commands/test.mjs`) và `src/lib/test-runner.mjs` bị chạy như file test và tính là "pass". Giới hạn tường minh: `node --test tests/*.test.mjs` (Node 20 chưa hiểu glob, nhưng shell mở rộng giúp; Node ≥ 21 tự hiểu). Sau khi sửa, chạy cả bộ trên Node 20 thật: 521 xanh.

## 2026-10-19 — review độc lập của Phase 2 (17 điểm, tất cả đã xử lý; chi tiết `tasks/phase-2.md`)

36. **Mọi regex chạy trên đầu ra của lệnh khác phải tuyến tính, đo bằng một dòng 1 MB không có xuống dòng.** `/[^\n]*\r/g` thử lại từ từng ký tự của dòng dài, chạy đồng bộ trong `finish` nên timeout cũng không ngắt được: một báo cáo JSON một dòng làm `verify` treo hơn 5 phút. Tách theo dòng rồi `lastIndexOf`.
37. **Kết quả của một chương trình là lúc nó thoát (`exit`), không phải lúc mọi ống đóng (`close`).** Một tiến trình nền (`vite preview &`) giữ ống làm lệnh đã thoát 0 bị báo "quá hạn" và đỏ. Sau `exit`, chờ một lúc cho đầu ra tới nốt, dừng thứ nó để lại, rồi chốt.
38. **Bài học 3 ("ghi xuyên symlink") phải áp cho MỌI chỗ ghi, và phải grep chứ không nhớ.** Tôi chặn ở báo cáo của `verify` nhưng quên file overlay của `test`: nó ghi đè được file của dự án qua symlink. Một hàm dùng chung (`draftsAreReady`) cho mọi nơi ghi vào `.fe-kit`, cộng `lstat` file đích.
39. **Trích dẫn phụ thuộc ngữ cảnh.** `shellQuote` an toàn khi `{files}` đứng trần, nhưng hồ sơ viết `"{files}"` thì tên file `$(...)` chạy được. Đừng cố phân tích mọi dạng: từ chối (bước `SKIP` kèm lý do, cảnh báo ngay ở hồ sơ). Thêm `./` trước tên bắt đầu bằng `-`.
40. **Che bí mật phải đứng trước mọi chỗ cắt ngắn**, kể cả chỗ cắt do giới hạn đầu ra: cắt đôi một mật khẩu thì không còn `@` để regex tìm thấy (bài học 17 lần nữa). Cắt ở ranh giới từ, và che trước khi `slice`.
41. **Fixture giả in lại đầu vào của nó thì che mất lỗi nhận diện chuỗi đánh dấu.** Fake vitest in cả mã overlay (chứa chuỗi đánh dấu) nên mọi lần chạy thành "bỏ qua". Khớp dạng lỗi như công cụ thật in (`Error: <thông điệp>`), không khớp dòng mã ném lỗi.
42. **Danh sách dạng cú pháp rút từ trí nhớ thì thiếu đúng những dạng tôi không nghĩ ra** (`type X = any`, kiểu trả về của hàm, tuple, `keyof`, `readonly`, `x is any`). Liệt kê theo sản phẩm ngữ pháp (alias, tham số kiểu, kiểu trả về, tuple, toán tử kiểu), và đặt ca âm cạnh ca dương.
43. **Thêm đối số vào script của dự án phải biết script là gì**: `a && b` đưa đối số cho `b`; npm chạy cả hook `pretest`/`posttest` cho mỗi lần gọi (`--ignore-scripts` cho lần dò cấu hình). Nghi ngờ thì không thêm và ghi chú, đừng đoán.

44. Một chương trình giả gọi `process.exit` ngay sau `console.log` lớn thì ống bị cắt ở 64 KB: test về đầu ra lớn phải dùng `process.exitCode`, nếu không test xanh giả (điểm 8 của lượt Codex Phase 2).
45. `fn(...mangLon)` và `arr.push(...mangLon)` tràn ngăn xếp từ khoảng 10^5 phần tử; dữ liệu đến từ dự án người dùng (dòng của file, đoạn của đầu ra) thì luôn dùng vòng lặp.
46. Đường tắt "dòng bắt đầu bằng X thì bỏ" trong bộ tách mã che luôn phần sau X; để vòng lặp chính xử lý, đường tắt chỉ dành cho trường hợp chắc chắn là cả dòng.
47. Sửa một lớp lỗi thì tìm cả họ của nó trong toàn `src/` (spread mảng lớn, ghi qua link, lỗi đọc bị coi là "không có"), không chỉ chỗ được chỉ: lượt 2 của Codex bắt đúng những chỗ cùng họ mà lượt 1 chưa đụng.
48. Đường dẫn dùng chung giữa các lần chạy (overlay) phải có tên theo ngữ cảnh (package) và được ghi nguyên tử (file tạm rồi `rename`); `rm` rồi `wx` có cửa sổ trống giữa hai bước.
49. Máy trạng thái cho cú pháp lồng (nháy trong `$( )` trong nháy) không đáng vá từng ca: khi không có parser, thấy dấu hiệu lồng thì từ chối thừa; kiểm bằng fuzz có shell thật (agent con làm được 12 000 mẫu mỗi hạt).
50. Lệnh chỉ đọc (`scan`) và lệnh tổng (`verify`) phải cùng quy tắc "chưa kiểm gì thì không xanh"; sửa một nơi mà quên nơi kia là lỗi lặp lại (điểm 3 của agent con).
51. `--dry-run` phải chạy cùng các kiểm tra "ghi được không" như chạy thật; nếu không, nó hứa điều chạy thật sẽ từ chối.

## 2026-10-21 — Phase 3 (xem UI thật): review kế hoạch 2 lượt, review code 3 lượt của Codex (chi tiết `tasks/phase-3.md`)

52. **Đo trên trình duyệt thật trước khi tin tài liệu hay nhớ.** Plan nói "chặn bằng `context.route`"; thí nghiệm cho thấy mọi `fetch` và `sendBeacon` phát ra trong `pagehide` không đi qua `route`. Cả lớp vá lúc dỡ trang đến từ một script 40 dòng chạy thử, không từ suy luận. Viết thí nghiệm ra file, chạy, rồi mới thiết kế.
53. **Trạng thái của bộ chặn nằm trong script thì phải tính đến mọi "realm".** Iframe có cờ `unloading` riêng và bị dỡ sau trang cha; `window.parent` là `[Replaceable]` nên phải chụp trước script của trang; `document.open()` xoá listener của window nên phải gắn lại sau `open`/`write`; một iframe khác origin không hỏi được thì chỉ cho đọc thuần. Mỗi lỗ này chỉ lộ khi viết thử một trang đối kháng.
54. **Đừng gọi hàm nào mà trang thay được khi đang cầm hàm gốc trong tay.** `realFetch.apply(...)` đưa `fetch` gốc cho `Function.prototype.apply` mà trang đã đổi. Chụp `Reflect.apply`, `Reflect.construct`, `Promise.reject.bind` ngay ở đầu init script và chỉ gọi các bản đã chụp.
55. **Đừng lọc bí mật trên cả kết quả:** giá trị bước gõ là `desktop` biến `page.desktop.png` thành `page.[REDACTED].png` và trạng thái `failed` thành `[REDACTED]`. Lọc theo schema, chỉ những trường đến từ trang hoặc từ người dùng; từ của chính báo cáo thì không.
56. **Bộ lọc chạy trên nội dung trang (chạy đồng bộ, không timeout nào ngắt được) phải tuyến tính.** JWT và địa chỉ bằng regex là bậc hai trên `'eyJ'.repeat(n)` và `'https://x/'.repeat(n)` (10 giây); duyệt từng ký tự một lần thì hết. Mỗi mẫu mới thêm một chuỗi gài sẵn vào test tuyến tính.
57. **Một comment chèn giữa câu lệnh nuốt mất cả lời gọi** (`keep // ghi chú (result...)`), và test chỉ khẳng định "danh sách rỗng" vẫn qua. Mỗi bộ lọc cần một test dương: một trường hợp có dữ liệu thật mà bộ lọc phải để lại.
58. **Số liệu trong prompt gửi người review lấy từ lệnh chạy, không từ trí nhớ** (tôi viết 1 060 test, thật là 821).
59. **Đột biến cho code có trình duyệt hay tiến trình thật: chạy riêng file test của mô-đun (`MUTATE_ONLY`)**, không cả bộ (132 giây một mutant); và dọn `pkill` các tiến trình thử sau mỗi lô, vì một mutant "giữ khoá" hay "không dừng server" để lại tiến trình làm hỏng lô sau.
60. **Khoá bằng file mà không có khoá của hệ điều hành chỉ là cố gắng tốt nhất.** Công bố nguyên tử (ghi ra file tạm rồi `link`), chủ khoá có nonce, nhả chỉ khi còn là của mình, tiếp quản khoá cũ bằng cách chuyển sang tên riêng rồi xem lại nội dung. Vẫn còn khoảnh khắc ba lệnh cùng lúc; nói thẳng giới hạn đó thay vì hứa.


## 2026-10-21 — Phase 1b (shell-guard): review kế hoạch 2 lượt của Codex (`tasks/phase-1b.md`)

61. **Tín hiệu "đã cài" không phải bằng chứng "đang bảo vệ".** Manifest, file cấu hình và lần chạy thử hook đều không gắn với tool đang gọi và agent ghi được hết; cổng mở dựa vào chúng là cổng giả. Điều agent không làm được thì mới đáng làm cổng: một người gõ `yes` trên `/dev/tty`.
62. **Khi nhiều lớp cùng bắt một đầu vào, kiểm đột biến chỉ ra lớp nào chưa có test riêng.** `cat ~/.config/fe-kit/env` bị chữ `.config/fe-kit` bắt trước nên mọi đột biến của việc giải đường dẫn, symlink, glob đều "sống". Mỗi lớp cần một đầu vào mà chỉ lớp đó thấy: thư mục state tuỳ chỉnh không có chữ nhận diện, HOME là symlink, glob từ thư mục cha, `cwd` trong kho với lệnh không có đối số.
63. **Test tiến trình thật đặt `await` trước khi gọi hàm cần gắn handler thì mất sự kiện.** `setImmediate(() => stream.destroy(err))` rồi `workerPath: await worker(...)` làm lỗi phát ra khi chưa có `on('error')`; tính mọi thứ cần `await` trước khi tạo luồng.
64. **Mỗi mã "dự phòng" thừa là một đột biến sống:** `skipNewlines` sau toán tử, kiểm `(` giữa lệnh, kiểm `;;` đều bị vòng lặp chính đã bắt; bỏ đi thì ngắn hơn và vẫn xanh. Đột biến sống thì hoặc thêm test, hoặc xoá mã.

## 2026-10-22 — Phase 1b: review code lượt 1 của Codex (7 điểm, `tasks/phase-1b.md`)

65. **Từ khoá của shell có tuỳ chọn riêng (`time -p`) thì bỏ từ khoá mà không bỏ tuỳ chọn sẽ biến tuỳ chọn thành tên lệnh.** Mọi nơi bộ tách "bỏ bớt" một từ phải hỏi: từ đó có đi kèm gì không.
66. **Một quy tắc đã xét "lệnh X" phải xét cả những cách gọi X qua wrapper** (`command cd`, `builtin cd`): theo dõi cwd và `launchOf` dùng hai cách bóc wrapper khác nhau nên lệch nhau.
67. **Công cụ tìm kiếm không đường dẫn đọc thư mục hiện tại:** kiểm "đối số có chạm kho" bỏ sót trường hợp không có đối số nào. Phải kiểm cả phạm vi mặc định.
68. **Thông báo lỗi của parser (V8 JSON) trích lại đầu vào.** Với file có thể chứa token, đừng chuyển `error.message` ra ngoài; test bằng chuỗi ngắn (chuỗi dài bị V8 cắt nên test xanh giả).
69. **Journal phải ghi MỌI thay đổi của giao dịch, không chỉ loại thay đổi dễ nghĩ tới** (skill, không chỉ file cấu hình).
70. **Bao `{exitCode, stdout}` hợp lệ chưa đủ: stdout còn phải là thứ tool đọc được**, vì Claude/Codex cho lệnh chạy khi hook in ra thứ không đọc được. Và một hàm kiểm chạy trong handler không được ném lỗi.
71. **Luồng đọc từ file handle chờ lần đọc đang chạy khi đóng:** với `/dev/tty` không ai gõ, lần đọc không bao giờ xong. Dùng `tty.ReadStream` rồi `destroy()`; chỉ test được bằng pty thật (`script`), PassThrough giả không tái hiện.
72. **Bộ đếm "đã có đường dẫn chưa" phải phân loại từng từ (pattern, giá trị option, đường dẫn), không đếm gộp**; option chưa biết thì hỏi người, đừng đoán theo hướng cho qua.
73. **`tty.ReadStream` mở lại terminal cho riêng nó và giữ một descriptor sau `destroy()` (đo bằng `/dev/fd` trong pty thật):** chỉ đóng được phần của mình; đo trước khi tin lời "đã đóng".
74. **Giá trị gắn với option (`--file=x`, `-fx`) là một tên riêng:** kiểm đường dẫn trên từ nguyên vẹn (`--file=x`) sẽ bỏ sót. Tách giá trị ra rồi mới kiểm.
75. **Ghi vào record "điều đã xảy ra" từ journal chỉ ghi ý định là ghi sai nếu tiến trình dừng giữa chừng:** đọc trạng thái thực (symlink hay bản sao) rồi mới chốt.

