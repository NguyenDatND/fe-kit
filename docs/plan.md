# Plan: `fe-kit` — bộ skill/agent cho dev Frontend, chạy trên Claude Code, Codex, Antigravity

> Thiết kế + kế hoạch triển khai cho công ty mới. Chưa tạo file nào ngoài file plan này.
> Chỗ ghi **(spike)** là điều chưa kiểm được trên máy thật; Phase 0 kiểm trước khi viết code thật.
> Không dùng bối cảnh CIC. Từ workspace cũ chỉ lấy vài ý tưởng chung (ghi rõ ở §9).

---

## 0. Bối cảnh

- **Môi trường công ty mới (đã biết):**
  - Jira và Confluence bản self-host (Data Center/Server);
  - code và Merge Request trên **GitLab self-host**;
  - chưa biết máy chạy hệ điều hành nào;
  - chưa biết stack FE cụ thể.
- **Bạn dùng 3 tool:** Claude Code, Codex (CLI + IDE), Antigravity. Trên máy này đang có Claude Code 2.1.302, Codex 0.145, Antigravity IDE 2.5.5 và App 2.1.4.
- **Cả 4 đoạn của vòng FE đều tốn công:** dựng màn hình mới, sửa bug, review code/MR, kiểm thử và xem UI thật.
- **Kết quả mong muốn:** repo riêng `~/Code/fe-kit`, dùng cục bộ. Đó là **tầng FE nằm trên superpowers**, mang các kỷ luật đã chắt lọc từ repo Matt Pocock, chạy giống nhau trên 3 tool, và nháp không bao giờ bị commit.

## 1. Đã chốt với bạn

| # | Quyết định |
|---|---|
| 1 | Bộ kit cá nhân, dùng cục bộ. "Gemini" là **Antigravity**. |
| 2 | **Lõi dùng chung** cho mọi dự án FE, không gắn stack nào. Phần riêng của từng dự án nằm ở **hồ sơ dự án**. |
| 3 | Làm **phần kiểm chứng trước**: lint, type-check, test, xem UI thật. |
| 4 | Xem UI thật hỗ trợ: chạy local có đăng nhập, môi trường chung, dữ liệu hoặc vai riêng, không đăng nhập. **Script Playwright dùng chung là đường chính.** Bạn đăng nhập tay một lần cho mỗi vai; phiên lưu ngoài repo; kit không giữ mật khẩu. |
| 5 | **Quy trình là superpowers**, giữ nguyên và cài cho cả 3 tool. Kit thêm phần FE và các kỷ luật lấy từ Matt Pocock. |
| 6 | Nháp (spec, plan, review, report, handoff) nằm trong `.fe-kit/` của từng dự án, git bỏ qua, **không commit**. |
| 7 | Skill FE bên thứ ba vẫn cài bằng `npx skills`. Kit chỉ gọi tên, không chép. |
| 8 | Review MR **đăng comment lên GitLab self-host**, dưới dạng draft note. Bạn tự bấm Submit review. |
| 9 | **AI phải hỏi trước mỗi `git commit`** (và cả push, `reset --hard`, `clean`), ở cả 3 tool. |
| 10 | **Test chứng minh theo dự án:** dự án đã có bộ test và quy ước thì test được commit như code (vẫn hỏi trước khi commit); chưa có thì giữ ở `.fe-kit/tests/`, không tự thêm thư viện test. |
| 11 | **Đưa bản rút gọn nguyên tắc làm việc** trong `~/.claude/CLAUDE.md` sang 2 tool kia. Quy ước trong `CLAUDE.md` của dự án cũng được 2 tool kia đọc. |
| 12 | **Jira và Confluence lấy qua MCP Atlassian**, cấu hình cho cả 3 tool, mặc định **chỉ đọc**. |
| 13 | **Hỏi theo vòng, kèm đề xuất** (kiểu grilling): mỗi vòng hỏi hết các câu không phụ thuộc nhau, đánh số, mỗi câu có đề xuất. AI tự tra fact. |
| 14 | Hệ điều hành chưa biết: **mọi script viết bằng Node**, chạy được trên macOS/Linux/Windows. Test macOS trước. |
| 15 | **Giữ nguyên toàn bộ phạm vi** (đã cân nhắc góp ý "quá lớn so với kit cá nhân" của reviewer, 2026-10-18). |
| 16 | **Bỏ Cursor khỏi phạm vi** (bạn không dùng, 2026-10-18): kit chỉ còn Claude Code, Codex, Antigravity; mọi phần Cursor, kể cả spike S2, đã bỏ khỏi plan, spike và code. |

## 2. Mục tiêu, không làm, coi là hỏng

- **Mục tiêu**
  - Một lệnh `fe-kit link` cài mọi phần mà tool cho phép cài bằng file/CLI. Phần bạn tự làm được in thành checklist và `doctor` kiểm lại. Phần này gồm việc chỉ làm được trên giao diện (duyệt hook trong `/hooks` của Codex, cài plugin qua giao diện) và lệnh cài plugin bên thứ ba mà kit không chạy thay bạn (vd `agy plugin install`). Chạy lại không đổi gì (idempotent).
  - Sửa skill trong `~/Code/fe-kit` là tool thấy ngay, hoặc sau một lệnh `fe-kit link`.
  - Các luồng FE cho cùng kết quả trên 3 tool.
  - Vào một repo mới chỉ cần `/fe-setup` một lần.
- **Không làm ở bản này**
  - BE.
  - Ghi vào Jira hay Confluence (để sau, nếu cần thì có bước xác nhận).
  - Chia sẻ cho team qua marketplace plugin.
  - Kế hoạch nhiều phiên kiểu `wayfinder`, chạy song song kiểu `implement-spec`.
- **Coi là hỏng nếu**
  - AI commit mà không hỏi, hoặc push hay đăng comment khi chưa được bảo.
  - Mỗi tool chạy một kiểu.
  - Kit phình nặng.
  - Nháp lọt vào code hay commit.
  - Dữ liệu trên môi trường dùng chung bị đổi mà bạn không biết.
  - Bí mật nằm trong file cấu hình của tool hoặc đi qua chat, hoặc agent đọc thẳng kho bí mật mà không bị chặn (phạm vi cam kết và rủi ro còn lại: §5.8).

## 3. Kiến trúc

```
 Claude Code │ Codex │ Antigravity
─────────────┴───────┴──────────────────────────────────────────────
 Tầng quy trình  superpowers (plugin chính chủ của từng tool)
                 brainstorm → plan → TDD → review → verify → finish
 Tầng FE         skill fe-* chia 2 loại (theo Matt Pocock):
 (fe-kit)          • người gọi (điều phối): fe-kit, fe-setup, fe-screen, fe-bug, fe-mr-review, fe-handoff, fe-retro
                   • model tự gọi (kỷ luật): fe-standards, fe-verify, fe-ui-check, fe-review, fe-tdd, fe-pr, fe-prototype
                 3 reviewer (Correctness / Standards / Spec) → sinh agent gốc từng tool
                 chỉ dẫn luôn bật: fe-kit-core (3 tool) + personal-core (2 tool, không gồm Claude)
                 hook: shell-guard (hỏi trước commit và lệnh ghi; chặn đọc kho bí mật), leak-guard
                 MCP qua wrapper: atlassian (Jira+Confluence, chỉ đọc), figma, chrome-devtools, context7
 Cầu nối chung   CLI `fe-kit` (Node), tool nào có shell là gọi được
 Dữ liệu         profiles/<dự-án>.md   (YAML frontmatter + mô tả bằng lời, nằm trong repo kit)
                 <dự-án>/.fe-kit/      (nháp + test local, tự git-ignore)
```

**Nguyên tắc**
1. **Một nguồn, nhiều đích.** Viết một lần trong `~/Code/fe-kit`. `fe-kit link` đặt nội dung vào đúng chỗ của từng tool: symlink (junction trên Windows) nếu tool đọc được, ngược lại thì copy.
2. **Skill giống nhau ở mọi repo; phần khác nhau nằm trong hồ sơ dự án mà skill đọc lúc chạy** (ý của Matt). Cách gọi Jira, Confluence, GitLab của từng nơi được mô tả bằng lời trong hồ sơ, không hard-code vào skill.
3. **Môi trường là nguồn sự thật.** Lệnh lint/test lấy từ `package.json` lúc chạy. Hồ sơ chỉ ghi phần ghi đè và những gì không tra ra được.
4. **Việc cần chính xác giao cho script, việc cần phán đoán giao cho skill.** Lỗi máy móc phải thành check tự động (scan, lint), không thành câu chỉ dẫn.
5. **Skill mô tả hành động, không gọi tên tool** ("dispatch a read-only subagent", "load the `fe-verify` skill"). Mỗi lần gọi skill khác chỉ gọi một skill.
6. **AGENTS.md / khối luôn bật chỉ chứa con trỏ.** Chuẩn chi tiết thuộc về reviewer, không nhồi vào ngữ cảnh của người viết code.
7. **Không sửa cấu hình của bạn khi chưa hỏi:** dry-run mặc định, backup, file state, `fe-kit unlink` gỡ được hết.
8. **Bí mật không đi qua chat, không nằm trong file cấu hình của tool, và lệnh đọc trực tiếp kho bí mật bị chặn.** Rủi ro còn lại ghi ở §5.8.
9. **Cờ do agent tự thêm (`--yes`…) không phải là xác nhận của bạn.** Mọi thao tác ghi ra ngoài là một lệnh con riêng, đi qua hộp hỏi của tool (§5.7).

## 4. Cấu trúc repo `~/Code/fe-kit`

```
fe-kit/
├── README.md · AGENTS.md · CLAUDE.md (@AGENTS.md)
├── NOTICE.md            ghi công: superpowers (MIT), Matt Pocock (MIT), Anthropic plugins (Apache-2.0)
├── UPSTREAM.md          SHA đã chắt lọc + cách so lại khi upstream đổi
├── package.json         bin: fe-kit · type: module · engines node>=20 · deps: playwright, yaml, smol-toml
├── bin/fe-kit.mjs · bin/mcp-run.mjs
├── src/commands/        context, init, verify, scan, rules, test, ui, auth, dev, mr, mcp, secrets, link, doctor, validate
├── src/lib/             profile, detect (stack), git, diff, gitlab, tools (đích 3 tool), fsx, hookio, os
├── skills/              NGUỒN DUY NHẤT (chuẩn Agent Skills)
│   ├── <tên>/SKILL.md   frontmatter: name, description (+ disable-model-invocation cho skill người gọi)
│   ├── <tên>/agents/openai.yaml   metadata cho Codex (policy cho skill người gọi)
│   └── fe-review/reviewers/{correctness,standards,spec}.md
├── rules/               fe-kit-core.md · personal-core.md
├── hooks/               shell-guard.mjs · leak-guard.mjs
├── mcp/servers.json     lệnh + tên biến bí mật + tool cần tắt để chỉ đọc
├── profiles/            README.md (schema) · <dự-án>.md (do /fe-setup tạo)
├── docs/
│   ├── workflow.md      các luồng + ranh giới phase
│   ├── skills/<tên>.md  mỗi skill 1 trang: What it does · When to reach · Common questions · It's working if
│   ├── adr/             quyết định của chính kit (vd 0001-superpowers-la-quy-trinh)
│   └── spike.md
├── .out-of-scope/       ý tưởng đã loại, mỗi khái niệm 1 file (để khỏi bàn lại)
├── templates/           spec-fe-checklist.md · review.md · bug.md · ui-steps.json · mr-comment.md · handoff.md
├── tests/               node:test + fixtures
├── dist/                (gitignored) bản sinh: agents, rules, hooks, mcp cho từng tool
├── .agents/skills/kit-authoring/ (+ symlink .claude/skills/kit-authoring)
└── tasks/todo.md · tasks/lessons.md
```

Sandbox để nghiệm thu là repo riêng `~/Code/fe-kit-sandbox`: app React + TS + Vite + vitest + RTL. App có trang đăng nhập giả với 2 vai và vài bug cài sẵn, để test `ui`, `auth`, `fe-bug`, `fe-review` mà không đụng code công ty.

## 5. Thành phần

### 5.1 Skills

Quy ước chung:
- **Skill người gọi** có `disable-model-invocation: true` (Claude) và `policy.allow_implicit_invocation: false` (Codex). Description viết cho người đọc.
- **Skill model tự gọi** có description bắt đầu bằng "Use when…".
- Skill người gọi được gọi skill model tự gọi; **không bao giờ gọi skill người gọi khác**.
- Thân skill viết tiếng Anh. Nháp và chat xuất ra tiếng Việt; comment đăng ra ngoài theo profile.

**Người gọi (điều phối):**

| Skill | Dùng khi | Làm gì | Lấy ý từ |
|---|---|---|---|
| `fe-kit` | Không nhớ dùng gì | Router: đặt bạn vào đúng bước của luồng (kit + superpowers), chỉ ra chỗ bạn phải quyết, và ranh giới phase (tiếp tục / `/clear` / handoff / subagent / `/compact`). Đọc SKILL.md trước khi khẳng định skill khác làm gì. Gợi ý xong thì dừng | ask-matt, PHASE-BOUNDARIES |
| `fe-setup` | Lần đầu vào một repo | Dò `package.json`, lockfile, framework, test runner, CI, `git remote` (GitLab project), dạng key Jira trong branch/commit, CLAUDE.md/AGENTS.md → trình hồ sơ đề xuất (mỗi mục kèm đề xuất, trả lời theo vòng) → ghi `profiles/<repo>.md` + chạy `fe-kit init` → liệt kê thứ còn thiếu (token, MCP, phiên đăng nhập) | setup-matt-pocock-skills |
| `fe-screen <KEY>` | Dựng màn hình hoặc tính năng UI | Lấy issue Jira + trang Confluence + frame Figma qua MCP → checklist FE (trạng thái loading/empty/error, quyền theo vai, validate và thông báo lỗi, responsive, a11y, hợp đồng API, **seam để test**) → tìm màn tương tự trong repo → superpowers brainstorming (hỏi theo vòng) → writing-plans (lát dọc, mỗi lát "xong thì demo được gì?", prefactor trước) → làm → `fe-ui-check` so Figma từng lát → `fe-review` (phiên mới) → `fe-verify` → `fe-pr` | to-spec (seams, out of scope), to-tickets (tracer bullet), feature-dev |
| `fe-bug <KEY>` | Sửa bug | Lấy bug qua MCP → `.fe-kit/bugs/<KEY>/` → **vòng lặp đỏ chặt trước khi đoán** (kịch bản `fe-kit ui --steps` hoặc test ở seam đúng) → thu nhỏ repro → 3–5 giả thuyết kiểm chứng được, trình bạn → gắn tag `[DEBUG-xxxx]` cho log → sửa → vòng lặp xanh → dọn tag → `fe-verify` → soạn commit message nêu giả thuyết đúng | diagnosing-bugs, superpowers systematic-debugging (gọi tên) |
| `fe-mr-review !<iid>` | Review MR của người khác | §8 | fe-bug-hunter cũ (không tự đăng), code-review (Matt + Anthropic) |
| `fe-handoff` | Đổi tool, đổi thư mục, giao người khác, tách việc phụ | Viết `.fe-kit/handoffs/<ts>.md`: việc đang dở, vì sao, bước tiếp, mục "skill gợi ý". Trỏ artifact theo đường dẫn, không chép lại; che bí mật | handoff |
| `fe-retro` | Sau một phiên khó | Đề xuất cải thiện **môi trường**, xếp theo mức nặng: thêm luật scan, lint, test → lỗi máy móc; chuẩn cho reviewer → lỗi phán đoán; con trỏ điều hướng; xoá chỉ dẫn vô tác dụng. Chỉ đề xuất, bạn chọn mới sửa | retro |

**Model tự gọi (kỷ luật):**

| Skill | Gọi khi ("Use when…") | Làm gì | Lấy ý từ |
|---|---|---|---|
| `fe-standards` | Sắp sửa file FE | `fe-kit rules --files …` → chỉ đọc rule khớp với file đó. Nguồn rule: tài liệu chuẩn của repo + quy ước trong CLAUDE.md/AGENTS.md dự án + `references/` chung của kit. Bỏ qua những gì lint đã bắt | writing-for-agents (con trỏ thay vì nhồi) |
| `fe-verify` | Sắp báo xong, sắp commit/MR | `fe-kit verify` (scan → lint → type-check → test dự án → test local) theo phần đổi trước. Có đổi UI thì gọi `fe-ui-check`. Báo cáo trích lệnh và kết quả thật | superpowers verification-before-completion |
| `fe-ui-check` | Cần nhìn UI thật, tái hiện bug UI, so Figma | `fe-kit dev start` nếu cần → `fe-kit ui` (ảnh nhiều viewport, lỗi console, request lỗi, `expectText`/`expectVisible`). Trên đích dùng chung được bấm, nhập tự do nhưng request ghi bị chặn; muốn cho một request ghi đi qua thì dùng `ui-act` (có hỏi). Phiên hết hạn thì đưa lệnh `fe-kit auth login` | diagnosing-bugs (vòng lặp bằng trình duyệt headless) |
| `fe-review` | Review một diff (branch hoặc working tree) | Chốt mốc so sánh (merge-base), kiểm ref hợp lệ và diff không rỗng → `fe-kit scan` → **3 reviewer chạy riêng** (§5.2), không gộp, không xếp hạng chéo → `.fe-kit/reviews/<ts>/review.md` + `findings.json`. Khuyên chạy ở phiên mới (tự review là thiên vị); không lặp đến khi "sạch" | code-review 2 trục (Matt), rubric ≥ 80 (Anthropic), pr-review-toolkit |
| `fe-tdd` | Viết hoặc sửa test FE | Chốt seam trước khi viết test (hành vi người dùng thấy qua RTL; API của hook; route-level bằng Playwright viết sau cùng). Tránh 3 lỗi: dính chi tiết cài đặt, tự chứng minh, viết test hàng loạt. Mock chỉ ở biên (HTTP bằng MSW, đồng hồ, ngẫu nhiên). Tuân chính sách test của profile | tdd + tests.md + mocking.md |
| `fe-pr` | Viết mô tả MR | Summary = hình nhỏ nhất (cây component, luồng gọi, diff phác, Mermaid nếu GitLab render được). Evidence = **ảnh trước/sau** từ `fe-kit ui`, hoặc test đỏ→xanh. Merge Danger = cửa một chiều/hai chiều + phạm vi ảnh hưởng (layout, mobile, consumer). Tiêu đề kèm Jira key theo profile. Ghi vào `.fe-kit/`, không tự tạo MR | pr |
| `fe-prototype` | Câu hỏi thiết kế không chốt được bằng lời | UI: 3 biến thể khác nhau về **cấu trúc** trên route thật, đổi bằng `?variant=`, thanh chuyển ẩn ở production, chỉ đọc. Logic: một file HTML có bảng trạng thái. Xong thì giữ trên nhánh `prototype/<tên>`, không merge | prototype (UI.md, LOGIC.md) |

**Để sau** (Phase 8): `fe-onboard` (vào codebase mới: glossary + ADR nhẹ + bản đồ điều hướng trong `.fe-kit/`, theo domain-modeling); `fe-research` (agent nền đọc nguồn gốc, ghi file có trích dẫn vào `.fe-kit/research/`); `kit-authoring` (chỉ dùng khi sửa kit, theo writing-for-agents).

### 5.2 Reviewer (3 trục, mỗi trục một subagent)

| Reviewer | Hỏi gì | Mỗi phát hiện phải kèm | Lọc |
|---|---|---|---|
| `fe-correctness-reviewer` | Có bug không? Null/undefined, race khi async, deps của effect, stale closure, key, hydration, lỗi bị nuốt, XSS, lỗ hổng kiểu (`any`, ép kiểu) | đoạn hunk + lý do + cách sửa | điểm tin cậy 0–100, bỏ dưới 80. Áp danh sách false positive: lỗi có từ trước, việc lint/tsc đã bắt, dòng không đổi trong diff, chỗ có comment cố ý |
| `fe-standards-reviewer` | Có đúng cách repo này viết code không? | trích tên rule + file chuẩn, hoặc tên smell + hunk | chuẩn của repo thắng; 12 code smell của Fowler chỉ là gợi ý; bỏ qua những gì lint đã bắt |
| `fe-spec-reviewer` | Có làm đúng việc được giao không? Thiếu, làm sai, làm thừa phạm vi; tiêu chí nghiệm thu đã có bằng chứng (test/ảnh) chưa | trích dòng của issue/spec | không có spec thì ghi "không có spec", không tự bịa yêu cầu |

- Prompt nằm trong `skills/fe-review/reviewers/`, có câu chốt: **"perform this review directly; do not load review skills or spawn agents."**
- `findings.json`: mỗi phát hiện có `id`, `axis`, `severity` (Critical/Important/Minor), `confidence` (0–100), `file`, `line`, `evidence`, `fix`.
- `fe-kit link` sinh agent gốc từ cùng các file đó:
  - Claude: `.md` với `model: inherit` và `tools` chỉ gồm công cụ đọc;
  - Codex: `.toml`, **không ghi `model`** (bỏ trống là kế thừa). Custom agent của Codex không ghi đè được `sandbox_mode`; subagent kế thừa sandbox của phiên cha. Vì vậy "chỉ đọc" trên Codex dựa vào `developer_instructions`, không được sandbox ép;
  - Antigravity: `.md`.
- Nghiệm thu "chỉ đọc":
  - Claude: bảo reviewer ghi một file thì bị tool từ chối;
  - Antigravity: như trên nếu S3 tìm ra cơ chế, không thì như Codex;
  - Codex: không ép được, chỉ kiểm sau review `git status` và working tree không đổi. Ghi rõ là rủi ro còn lại.

### 5.3 CLI `fe-kit`

- Node ≥ 20, ESM. Phụ thuộc: `playwright`, `yaml`, `smol-toml`.
- Lệnh nào cũng có `--json`.
- Mã thoát: 0 ổn, 1 phát hiện vấn đề (`validate`, `verify`), 2 dùng sai hoặc lệnh chưa làm, 3 hết phiên đăng nhập (`ui`), 70 lỗi bất ngờ (kèm `{ "error": … }` khi `--json`).
- Cài lên PATH bằng `npm link` (bin nằm ở `$(npm prefix -g)/bin`, vd `/opt/homebrew/bin`). Trong cấu hình sinh cho app GUI, dùng đường dẫn tuyệt đối tới script và tới `node` **dạng ổn định** (`which node`, vd `/opt/homebrew/bin/node`), không dùng `process.execPath`: nó chứa số phiên bản (`…/Cellar/node/26.5.0/bin/node`) và hỏng khi brew nâng cấp. Đã kiểm: Claude, Codex, `agy` headless thấy `fe-kit` ở `~/.local/bin` và `/opt/homebrew/bin`; app GUI chờ kiểm tay (S4).

| Lệnh | Việc |
|---|---|
| `context` | Tìm gốc dự án, khớp profile (theo đường dẫn hoặc remote) hoặc tự dò. In lệnh (lấy từ `package.json`), đích, vai, nguồn chuẩn, chính sách test, thư mục nháp |
| `init` | Tạo `.fe-kit/` cùng `.fe-kit/.gitignore` chứa `*` (đã kiểm: đủ để `git status` sạch, không cần sửa `.gitignore` của dự án hay `info/exclude`). Repo có `CLAUDE.md` mà chưa có `AGENTS.md` thì tạo symlink `AGENTS.md → CLAUDE.md` và thêm `/AGENTS.md` vào `.git/info/exclude`, vì Codex và Antigravity không đọc `CLAUDE.md` (§6); tắt bằng `--no-agents-link`. `--dry-run` chỉ in việc sẽ làm. |
| `verify [--scope changed\|all] [--base ref]` | scan → lint → type-check → test dự án → test local, **chạy hết mọi bước** dù bước trước đỏ. Lệnh nào không có (script `package.json` hoặc `commands.*` của hồ sơ) thì bước `SKIP` kèm lý do, không đoán lệnh, và tên bước nằm trong dòng `Not verified`. `{files}` trong lệnh = file JS/TS đã đổi của package (lô tối đa ~50 000 ký tự). Mỗi bước có timeout 15 phút, đầu ra bỏ mã màu, giữ đầu và cuối tối đa 2 MB, che mật khẩu trong URL. Ghi `.fe-kit/reports/verify-<giờ>.md` **chỉ khi** `.fe-kit` đã `init` (nếu không thì cảnh báo, để file không lọt vào `git status`). Thoát 0 khi không bước nào đỏ, 1 khi có, 2 khi dùng sai |
| `scan [--scope changed\|all] [--base ref]` | Luật regex trên **dòng thêm mới** (so với merge-base của nhánh nền: `--base` → `baseBranch` của hồ sơ → `origin/HEAD` → `origin/main\|master` → `main\|master` → `HEAD`; gồm thay đổi chưa commit và file chưa theo dõi): luật chung (conflict marker, `any`, `dangerouslySetInnerHTML`, `eval`/`new Function`, `innerHTML=`, `.only`/`.skip`, `console.log` sót, rò rỉ `.fe-kit/`) + luật của profile (`scan:` trong frontmatter: `id`, `pattern`, `message`, `files?`; `fe-retro` thêm dần). Bỏ comment và nội dung chuỗi trước khi khớp, nên đây là heuristic trên từng dòng, không phải AST. Mọi phát hiện đều làm `verify` đỏ; chưa có cách bỏ qua từng dòng |
| `rules --files …` | Trả các tài liệu chuẩn áp dụng cho file: nguồn dự án (`standards` của hồ sơ, mặc định `CONTRIBUTING.md`, `CLAUDE.md`, `AGENTS.md`; thứ tự là độ ưu tiên) rồi `skills/fe-standards/references/*.md` của kit. Mỗi tài liệu tự nói phạm vi bằng frontmatter `paths:` (glob) và `frameworks:` (framework `detect` dò được); không có thì áp dụng cho mọi file. File chưa tồn tại vẫn khớp (theo đường dẫn) |
| `test [file…]` | Chạy `.fe-kit/tests/` bằng vitest/jest **của dự án**, với config phủ **thay** `test.include` (`{ ...base, test: { ...base.test, include } }`; **không** dùng `mergeConfig`: nó nối mảng, nên dự án có `include` riêng sẽ chạy lẫn test của dự án, 2 file thay vì 1, đã kiểm với vitest 5.0.5). Config phủ nằm ở `.fe-kit/vitest.overlay.config.mjs`, nhập config gốc (`vitest.config.*` rồi `vite.config.*`, là hàm hay object đều được); package nằm dưới gốc dự án (monorepo) thì có thêm plugin phân giải import theo package, vì `.fe-kit` không có `node_modules`. Hỗ trợ vitest và jest. **Jest** (đã kiểm với 30.5.2 và 29.7.0): test local chạy bằng `--roots` của chính config (đọc từ `jest --showConfig`) cộng `.fe-kit/tests`, kèm `--testMatch` (hoặc `--testRegex` nếu config dùng regex) chỉ trỏ vào test local, `--coverage=false`; còn test dự án được thêm một `--testPathIgnorePatterns` cho từng pattern đang có cộng một pattern neo `<rootDir>` cho `.fe-kit`, vì cờ dạng mảng **thay** chứ không nối vào config. Jest nhiều `projects` chưa hỗ trợ (báo rõ). Từ chối chạy khi `.fe-kit` chưa `init`. Lưu ý đã kiểm: lệnh test mặc định của dự án **cũng nhặt** `.fe-kit/tests/` (glob mặc định khớp cả thư mục bắt đầu bằng dấu chấm), nên `verify` chạy test dự án với `--exclude '.fe-kit/**'` |
| `dev start\|stop\|status [--target] [--timeout s]` | Dev server của đích có `start` chạy nền (tách khỏi CLI, log `.fe-kit/dev.log`, bản ghi `.fe-kit/dev.pid` gồm pid, giờ khởi chạy của tiến trình và lệnh). `start` chờ địa chỉ trả lời (mặc định 60 s), từ chối nếu đã có thứ khác trả lời ở địa chỉ đó, không khởi động lần hai, và dừng lại nếu quá giờ. Mỗi dự án một khoá (`.fe-kit/dev.lock`): `start`/`stop` chạy từng cái một; `dev.log` và `dev.pid` là link thì bị từ chối. `stop` chỉ dừng nhóm tiến trình còn khớp bản ghi: pid bị dùng lại cho tiến trình khác thì không đụng. Chưa hỗ trợ Windows (Phase 8) |
| `auth login\|status --target --role [--path]` | **Bạn tự chạy** (cần terminal; không có thì từ chối): mở Chromium có giao diện ở đích, bạn đăng nhập rồi Enter. Lưu `storageState({ indexedDB: true })` vào `$FE_KIT_STATE_DIR` hoặc `~/.local/state/fe-kit/auth/<hồ sơ>/<đích>.<vai>.json` (file 600, thư mục 700, từ chối symlink; xem mô hình đe doạ ở §5.8). Trình duyệt trống thì không ghi đè phiên cũ. Thư mục `auth` và thư mục hồ sơ phải là thư mục thật, của bạn, chế độ 700 (file 600) cho cả đọc lẫn ghi; link hoặc quyền lỏng thì từ chối và nói lệnh `chmod`. `status` chỉ cho số cookie, số origin, ngày lưu và ngày hết hạn của cookie đầu tiên (không bao giờ in giá trị); thoát 1 khi thiếu, hỏng, quyền lỏng hoặc đã hết hạn. Đã kiểm: cookie phiên và localStorage được giữ, **sessionStorage không được lưu** |
| `ui --target [--role] [--path] [--viewports] [--steps f]` | Ảnh chụp cả trang ở từng viewport (mặc định mobile, tablet, desktop; có `--steps` thì chỉ desktop và kịch bản chạy **một lần**), lỗi console, response ≥ 400, request hỏng, kịch bản (`goto`, `click`, `fill`, `press`, `waitFor`, `screenshot`, `expectText`, `expectVisible`, `expectValue`). Ra `.fe-kit/ui/<giờ>-<đích>[-vai]/` (ảnh, `report.json`, `report.md`); báo cáo không có giá trị `fill`, cookie, token hay query string. **Phiên** (nếu có `--role`): `authenticated`, `expired` (thoát 3, kèm lệnh `auth login`), `unknown` (thoát 1); khai trong `targets.<tên>.session` (§5.4), kiểm sau trang đầu, sau mỗi `goto` và sau kịch bản. **Đích `readOnly`** (mặc định với đích không có `start`): click/fill/press chạy bình thường, request ghi bị chặn ở tầng mạng; ngoại lệ `safeRequests` (§5.4). Bộ chặn đã đo trên Chromium: `context.route` đăng ký trước mọi trang, `serviceWorkers: 'block'`, `route.fetch` không theo redirect cho request ghi được cho qua, `routeWebSocket` đóng WebSocket, và một script trong mọi frame chặn `sendBeacon`/`fetch` lúc trang đang dỡ (lúc đó chúng không đi qua `route`). Mã thoát 0/1/2/3 (§ trên); mã 1 gồm cả một request ghi đã được cho qua rồi hỏng giữa đường (lỗi gửi, redirect, lỗi của bộ chặn). Dòng cuối đầu ra là `Result:`. Mọi chuỗi của kết quả được lọc bí mật (giá trị của phiên đã lưu, thứ bước đã gõ, Bearer/JWT/`token=`, query string); không hoàn hảo. **Chromium không chạy được trong sandbox macOS của Codex** (`MachPortRendezvousServer: Permission denied`), nên ở Codex `fe-kit ui` phải chạy ngoài sandbox bằng rule `allow` (§6) |
| `ui-act … --allow-request "<METHOD> <origin><path-glob>"` | Như `ui`, nhưng cho **đúng một** request ghi khớp đi qua, một lần cho cả lần gọi (mọi viewport dùng chung; tiêu thụ ngay lúc quyết định, không hoàn lại khi lỗi). Request ghi khác vẫn bị chặn và báo; redirect sau request được cho qua bị chặn. Request nằm ngay trên dòng lệnh nên hộp hỏi hiện đúng thứ sẽ đổi dữ liệu. **Chưa bật:** cơ chế có test, nhưng lệnh và bộ chạy đều từ chối (mã 2) cho tới khi `shell-guard` có; mở sớm thì agent tự gọi được mà không ai duyệt. Nhiều request ghi thì gọi nhiều lần |
| `mr fetch\|preview\|post\|publish\|status <iid>` | §8. `post`, `publish` luôn đi qua `shell-guard` |
| `mcp status\|add` · `mcp-run <server>` | §5.8 |
| `secrets set\|list\|check` | Nhập token **ẩn ký tự** (học từ wizard). Ghi vào `~/.config/fe-kit/env` (quyền 600). Mở sẵn trang tạo PAT của Jira, Confluence, GitLab, Figma. Bí mật không bao giờ đi qua chat |
| `link\|unlink [--tools …] [--yes] [--copy]` | Cài/gỡ skill và `shell-guard` vào 3 tool (§6). Mặc định dry-run. Thường do bạn tự chạy; agent gọi thì đi qua `shell-guard`. **Skill**: symlink (hoặc bản copy có đánh dấu với `--copy`). **Guard**: Claude `permissions.ask/deny` + hook `PreToolUse` (Bash\|Read\|Grep\|Glob) trong `settings.json`; Codex file `~/.codex/rules/fe-kit.rules` của riêng kit (`prompt` cho lệnh ghi, `allow` cho `ui`/`dev`/`mr fetch`) + hook `Bash` trong `hooks.json`; Antigravity khoá riêng `fe-kit` trong `~/.gemini/config/hooks.json` + `permissions.ask/deny` của CLI. **Chỉ thêm vào cuối, không chèn trước, không ghi đè** (cả 3 tool đã có hook `herdr` ở `SessionStart` của bạn, và Codex lưu trạng thái tin cậy hook theo `file:event:chỉ-số` trong `config.toml`: chèn trước sẽ làm hook của bạn bị hỏi duyệt lại); mục có sẵn giống hệt vẫn là của bạn và `unlink` không gỡ. Nhận diện bằng cấu trúc và dấu vân tay, không bằng chữ `fe-kit`. **An toàn**: kiểm trước mọi đích (JSON hỏng, sai schema, symlink, thư mục xung đột → dừng, không ghi gì cho tool nào); khoá một lần một (`install.lock`); backup riêng tư (600) trong `<state>/backups`; ghi qua file tạm rồi rename, đọc lại ngay trước khi rename (file đã đổi → dừng); nhật ký giao dịch `install.journal.json` + bản ghi `install.json` (từng mục đã thêm), lần chạy sau tự hoàn tất giao dịch dang dở; `unlink` chỉ gỡ mục còn khớp, mục bạn đã sửa thì giữ và báo (thoát 1). Chưa có `--with rules`: rules chỉ cài sau khi bạn duyệt nội dung. Tool nào chưa có thư mục (`~/.claude`, `~/.codex`, `~/.gemini`) thì bỏ qua trừ khi gọi bằng `--tools`. In lời nhắc phần chỉ bạn làm được (duyệt hook Codex trong `/hooks`, mở lại phiên đang chạy) |
| `doctor` | Chỉ đọc, không đổi gì. Kiểm: node ≥ 20, playwright và Chromium; từng tool đã `link` (skill còn link đúng, guard còn nguyên, so bằng chính kế hoạch của `link`; thiếu thì nói chạy `fe-kit link --yes`); **chạy thử hook như tool chạy** (lệnh thường phải im lặng, đọc kho bí mật phải bị từ chối; hook không khởi động được hoặc để lọt thì đỏ); quét file cấu hình mà guard nằm trong đó tìm bí mật (chỉ nêu loại và file, không in giá trị); phiên đăng nhập (hết hạn hoặc sắp hết = cảnh báo, quyền lỏng hoặc hỏng = đỏ); hồ sơ khớp dự án hiện tại và `.fe-kit` đã sẵn sàng; phiên bản từng tool. Phần chờ bạn (rules chưa duyệt, superpowers S14, kiểm tay GUI, duyệt hook Codex) ghi `pending`/`info`, không làm lệnh đỏ. Thoát 1 khi có đỏ. Chưa làm: so hash `~/.claude/CLAUDE.md` với bản rút gọn (chờ rules được duyệt), skill trùng giữa các surface |
| `validate` | Tự kiểm kit (§11) |

### 5.4 Hồ sơ dự án (`profiles/<repo>.md`, do `/fe-setup` tạo)

```markdown
---
name: shop-web
match: { paths: ["~/work/shop-web"], remotes: ["gitlab.company.local/fe/shop-web"] }
language: { chat: vi, comments: vi }        # ngôn ngữ comment MR theo team
baseBranch: origin/develop
commands:                                    # chỉ ghi phần ghi đè; còn lại lấy từ package.json
  lint: "pnpm eslint --max-warnings=0 {files}"
tests: { policy: auto }                      # auto = commit nếu repo đã có test setup, ngược lại local-only
targets:
  local: { start: "pnpm dev", url: "http://localhost:5173" }
  staging: { url: "${env:SHOP_STAGING_URL}", safeRequests: ["POST /graphql"], session: { loginPath: /login, loggedInMarker: "[data-user]", probe: { path: /api/me } } }
roles: [admin, staff]
standards: ["CONTRIBUTING.md", "docs/frontend/**/*.md", "CLAUDE.md"]
scan:                                        # luật riêng, chạy trên dòng thêm mới (`fe-retro` thêm dần)
  - { id: no-moment, pattern: "from ['\"]moment['\"]", message: "dùng date-fns", files: ["src/**/*.{ts,tsx}"] }
tracker: { type: jira, keyPattern: "SHOP-\\d+", mcp: atlassian }
specs: { type: confluence, mcp: atlassian, space: SHOP }
forge: { type: gitlab, baseUrl: "${env:GITLAB_URL}", project: "fe/shop-web", tokenEnv: GITLAB_TOKEN }
review: { minConfidence: 80, aiDisclosure: none }
---
## Tracker
Bug có cột "Steps to reproduce"; môi trường test ghi ở field "Environment"…
## Merge request
Tiêu đề: "SHOP-123: …"; cần ảnh trước/sau cho thay đổi UI…
```

- Phần frontmatter để CLI đọc. Phần lời để skill đọc, ví dụ quy trình riêng của Jira/GitLab ở công ty mới.
- `validate` của hồ sơ kiểm kiểu từng trường mà lệnh dùng: `baseBranch` (chuỗi), `commands` (map tên đã biết → chuỗi lệnh không rỗng; chuỗi đi thẳng vào shell nên không chấp nhận giá trị sai kiểu), `standards` (danh sách chuỗi), `scan` (danh sách luật; `pattern` phải là regex hợp lệ). Giá trị sai kiểu bị bỏ qua kèm cảnh báo, không bao giờ làm hỏng cả lệnh và không bao giờ được in lại.
- `fe-retro` bổ sung luật scan và chuẩn vào đây theo thời gian.
- **`targets`** (kiểm chặt: trường lạ là lỗi, để gõ sai không tắt được một lớp bảo vệ): `url` (có `${env:…}`, http hoặc https, không kèm user/password), `start` (lệnh của dev server), `readOnly`, `safeRequests`, `session`. **`readOnly` mặc định là `true`, trừ đích có `start`** (kit tự chạy nên là của bạn) hoặc đích khai `readOnly: false`: quên khai thì vẫn an toàn.
- **`safeRequests`**: chuỗi `"POST /graphql"` là **GraphQL** (khớp origin và đường dẫn đúng, đọc body JSON hoặc `application/graphql` kể cả batch, chỉ cho `query`; `mutation`, `subscription`, persisted query không kèm văn bản, query nằm trên URL, body quá 1 MiB hoặc batch quá 100 đều bị chặn); endpoint không phải GraphQL khai `{ request: "POST /search", body: "any" }` để tự nhận trách nhiệm là chỉ đọc.
- **`session`** (cần khi chạy với `--role`: ít nhất `loggedInMarker` hoặc `probe`): `loginPath` (mặc định `/login`), `loginMarker` và `loggedInMarker` (CSS selector), `probe: { path, expired: [401], loggedIn: [200] }` (một GET, không theo redirect; 403 không mặc định là hết phiên). Bằng chứng hết phiên thắng bằng chứng còn sống; không có bằng chứng nào là `unknown`.

### 5.5 Nháp `.fe-kit/` (trong từng dự án)

```
.fe-kit/  (.gitignore = "*")
├── specs/  plans/     superpowers ghi vào đây (thay cho docs/superpowers/…)
├── tasks/             todo.md, lessons.md mà CLAUDE.md của bạn yêu cầu
├── tests/             test chứng minh khi dự án chưa có test setup
├── reviews/ reports/ ui/ bugs/<KEY>/ mr/<iid>/ handoffs/ research/
└── dev.pid
```

### 5.6 Chỉ dẫn luôn bật

**`rules/fe-kit-core.md`** (khoảng 30 dòng, tiếng Anh, cài cho cả 3 tool; chủ yếu là con trỏ):
1. Khi làm FE, chạy `fe-kit context` trước. Không nhớ dùng gì thì gợi ý `/fe-kit`.
2. Nháp để trong `.fe-kit/…`. Khi skill khác (superpowers) hoặc chỉ dẫn khác bảo lưu vào `docs/`, `tasks/` hoặc commit, thì lưu vào `.fe-kit/…` và không commit.
3. **Hỏi theo vòng:**
   - mỗi vòng gồm mọi câu đang trả lời được, đánh số, mỗi câu có đề xuất, viết sao cho "có" là đồng ý với đề xuất;
   - fact thì tự tra;
   - hết câu hỏi thì xác nhận đã hiểu chung rồi mới làm.
   - Ưu tiên hơn quy tắc "mỗi lần một câu" của superpowers. Tool có giao diện hỏi giới hạn số câu thì chia vòng ra nhiều lần.
4. Hỏi trước mỗi commit. Không push, không tạo MR, không đăng comment khi chưa được bảo. Môi trường dùng chung chỉ xem.
5. Chính sách test theo profile.
6. Trong dự án FE: review thì dùng `fe-review`, kiểm chứng thì dùng `fe-verify` (bổ sung cho requesting-code-review và verification-before-completion của superpowers).
7. Comment trong code không nhắc tới nháp, mã nội bộ hay AI.
8. MCP Atlassian chỉ dùng để đọc.

**`rules/personal-core.md`** (khoảng 60–80 dòng, rút gọn tay từ `~/.claude/CLAUDE.md` của bạn, chỉ cài cho Codex, Antigravity):
- **Gồm:**
  - trả lời tiếng Việt;
  - hành vi cốt lõi: nêu giả định, dừng lại khi mâu thuẫn, phản biện, giữ đơn giản, đúng phạm vi, dọn code chết;
  - lên plan trước, kiểm chứng trước khi báo xong;
  - luật git: Conventional Commits một dòng, không Co-Author, kiểm remote trước khi viết lại lịch sử;
  - không lộ bí mật;
  - dùng Context7 cho tài liệu thư viện.
- **Bỏ:** định tuyến Serena, GitNexus, Exa.
- `doctor` báo khi bản gốc đổi.

**Quy ước của dự án** (`CLAUDE.md`/`AGENTS.md` trong repo): mọi tool đều đọc được (§6), để reviewer trên mọi tool không báo nhầm cùng một chỗ.

### 5.7 Hooks và quyền

- **`shell-guard`** làm 2 việc:
  - **Hỏi trước** với: `git commit`, `git push`, `git reset --hard`, `git clean -f*`, `fe-kit mr post`, `fe-kit mr publish`, `fe-kit ui-act`, `fe-kit link`/`unlink`. Các lệnh ghi của kit là lệnh con riêng chứ không phải cờ, để luật hỏi theo tiền tố của mọi tool bắt được.
  - **Chặn** lệnh shell hoặc thao tác đọc file nhắm vào kho bí mật (`~/.config/fe-kit/`, `~/.local/state/fe-kit/auth/`).
  - Tool nào có cơ chế sẵn thì dùng cơ chế đó (§6), hook chỉ lấp phần thiếu. Đã kiểm headless ở Phase 0: `permissions.ask` của Claude, `.rules` (`prompt`, `forbidden`) của Codex và `permissions.ask|deny` của `agy` đều chặn đúng lệnh; khi không có UI để hỏi thì từ chối. Ở Claude và `agy`, `ask` thắng `allow` (kể cả `--allowedTools`). Pattern của Claude có vẻ khớp theo ranh giới từ (suy ra từ kết quả đo): `Bash(touch:*)` chặn được `touch x.flag`, còn `Bash(touch x:*)` thì không. Vì vậy dùng pattern nhiều từ như `Bash(git commit:*)`.
  - Claude bỏ qua `permissions.allow` ở cấp dự án khi workspace chưa được tin cậy (hook cùng file vẫn chạy). Luật của kit luôn đặt ở cấp user.
  - **Các dạng gọi được bắt:** `fe-kit …`, `node <đường dẫn>/bin/fe-kit.mjs …`, `npx fe-kit …`.
    - Hook (Claude PreToolUse Bash, Antigravity) tìm theo regex trên **toàn bộ chuỗi lệnh**, nên bắt được cả lệnh nối bằng `&&`/`;` hay lồng trong `bash -c "…"`.
    - Codex `.rules` khớp chính xác theo argv, nên `link` sinh một rule cho mỗi dạng gọi. `codex execpolicy check` coi `bash -lc '…'` là một argv nguyên khối nên không phản ánh việc runtime tách chuỗi `&&`; kiểm rule bằng chạy thật (đã kiểm: lệnh đơn qua `zsh -lc` khớp rule).
  - **Surface không hiện được hộp hỏi** (headless) thì đổi "hỏi" thành `deny`, kèm lời nhắn để bạn tự chạy lệnh.
  - **Fail-closed:** adapter bọc mọi lỗi (đọc stdin, parse, regex) thành `deny`. Đã kiểm: **Claude và Codex fail-open** khi hook crash, in JSON hỏng hoặc timeout (lệnh vẫn chạy); `agy` fail-closed cả ba trường hợp. Với Claude và Codex việc bọc lỗi trong adapter là bắt buộc, không trông vào host được. Còn lại là rủi ro khi chính script hook không chạy được (bị xoá, `node` mất khỏi PATH) vì khi đó adapter không có cơ hội bọc lỗi: `doctor` chạy thử từng hook với stdin mẫu.
  - **Phạm vi bảo vệ:** chặn agent làm quá đà theo các cách gọi thông thường, không chặn được agent cố tình lách (vd tự viết script gọi API GitLab).
- **`leak-guard`** chặn việc ghi file code khi comment mới thêm chứa đường dẫn `.fe-kit/`, câu ghi công AI, hoặc mẫu riêng của profile. Chỉ quét comment, không quét string hay code. Ý tưởng lấy từ hook cũ trong workspace CIC. Hook không bắt được việc ghi qua shell; lưới cuối là luật rò rỉ của `fe-kit scan`, chạy trong `fe-verify` trước commit.
- **Cả hai dùng chung `src/lib/hookio`**: đoán tool theo stdin rồi trả đúng một kiểu kết quả.
  - Claude: exit 2, hoặc `permissionDecision` (`allow`/`deny`/`ask`). Stdin có `hook_event_name`, `tool_name` (`Bash`, `Write`, `Read`…), `tool_input` (`command`, `file_path`, `content`).
  - Codex: **chỉ `deny` hoặc exit 2**. `PreToolUse` của Codex không hỗ trợ `ask`: hook trả `ask` thì lệnh vẫn chạy (đã kiểm). Muốn hỏi trên Codex thì dùng `~/.codex/rules/*.rules` với `decision = "prompt"`. Stdin giống Claude, thêm `turn_id`, `model`.
  - Antigravity: `decision`, camelCase. Hỏi dùng `force_ask`: `ask` vẫn chạy lệnh nếu có allow-rule hoặc bạn từng chọn "Always Allow" (đã kiểm). Stdin **không có tên sự kiện**, nhận diện theo hình dạng `toolCall` (`name`; `args.CommandLine` của `run_command`, `args.CodeContent` của `write_to_file`, `args.AbsolutePath` của `view_file`).
  - Codex ghi file bằng `apply_patch` (patch trong `tool_input.command`, dòng `+`) **hoặc bằng shell** (`printf … > file`): đã gặp cả hai, nên hook ghi file của Codex chỉ là lớp phụ.
  - Fixture stdin thật của cả ba tool nằm ở `tests/fixtures/hooks/`.
- Mọi hook đăng ký dạng `<node ổn định> <đường dẫn tuyệt đối>` (không dùng bash), nên chạy được trên Windows. `<node ổn định>` là kết quả `which node` (§5.3). `link` chỉ thêm vào cuối hook sẵn có của bạn.
- **Bản đầu không có hook session-start.**

### 5.8 MCP và bí mật

| Server | Chạy bằng | Bí mật (trong `~/.config/fe-kit/env`) | Chỉ đọc |
|---|---|---|---|
| `atlassian` (Jira + Confluence DC) | `mcp-atlassian` (`uvx`; hoặc Docker nếu máy không có Python) | `JIRA_URL`, `JIRA_PERSONAL_TOKEN`, `CONFLUENCE_URL`, `CONFLUENCE_PERSONAL_TOKEN` (tên biến: spike) | `READ_ONLY_MODE=true`; thêm tắt tool ghi ở từng tool |
| `figma` | `npx figma-developer-mcp --stdio` | `FIGMA_API_KEY` (env, **không** để trong args) | — |
| `chrome-devtools` | `npx chrome-devtools-mcp` | — | — |
| `context7` | `npx @upstash/context7-mcp` | — | — |

- GitLab không qua MCP: `fe-kit mr` gọi API trực tiếp bằng `GITLAB_TOKEN`.
- **Mọi tool chạy MCP qua `fe-kit mcp-run <server>`.** Wrapper nạp env rồi chạy server thật, nên không file cấu hình nào của tool chứa bí mật.
- **Mô hình đe doạ.** Agent chạy cùng tài khoản với bạn, nên quyền `600` không chặn được agent đọc `env` hay `storageState`. Kit giảm rủi ro bằng 3 lớp:
  - không file cấu hình nào của tool chứa bí mật (`mcp-run`);
  - `shell-guard` cùng luật deny của từng tool chặn lệnh đọc trực tiếp kho bí mật;
  - `mcp-run` và mọi lệnh của kit không in bí mật ra stdout.

  **Rủi ro còn lại:** agent vẫn đọc gián tiếp được, ví dụ viết một script Node rồi chạy. Kit không hứa chặn tuyệt đối.
  - Nghiệm thu: bảo từng tool in token hoặc cookie → bị chặn; `doctor` quét file cấu hình.
  - Nếu công ty yêu cầu cao hơn: chuyển sang kho khoá của hệ điều hành (Keychain) ở bản sau.
- **Việc riêng trên máy này:** khoá Figma đang nằm dạng chữ thường trong args của `~/.claude.json` và đã lọt vào log phiên trước. Bạn thu hồi khoá và gỡ MCP này ở bước S-1, trước Phase 0. Phase 4 đăng ký lại qua wrapper.

## 6. Cài vào từng tool

| Thành phần | Claude Code | Codex | Antigravity |
|---|---|---|---|
| Skills | symlink `~/.claude/skills/<tên>` (đã kiểm: theo symlink, sửa là thấy ngay ở phiên mới, đọc được `references/` qua symlink, riêng headless `-p` cần `--add-dir` tới thư mục skill vì nó nằm ngoài workspace; phiên đang chạy còn tự thấy skill mới) | symlink `~/.agents/skills/<tên>` (đã kiểm; Codex **không** đọc `~/.claude/skills`) | `~/.gemini/config/skills/<tên>` cho cả App, IDE và CLI `agy` (đã kiểm `agy` 1.4.0 theo symlink; nó **không** đọc `~/.gemini/antigravity-cli/skills` dù tài liệu ghi; App/IDE chờ kiểm tay) |
| Skill chỉ người gọi | `disable-model-invocation: true` | `agents/openai.yaml` → `allow_implicit_invocation: false` | tài liệu xác nhận **không có** cơ chế (frontmatter chỉ có `name`, `description`). Description ghi rõ "chỉ chạy khi người dùng gõ /…"; S3 đo mức tự kích hoạt |
| Agents (reviewer) | `~/.claude/agents/fe-*.md` | `~/.codex/agents/fe-*.toml` (không có `model`, xem §5.2) | `~/.gemini/config/agents/` (App/CLI; IDE: spike) |
| `fe-kit-core` | `~/.claude/rules/fe-kit.md` (đã kiểm: nạp được; S13 đạt, xem `docs/spike.md`) | khối có đánh dấu trong `~/.codex/AGENTS.md` (đã kiểm; file hiện rỗng 0 byte) | `~/.gemini/config/rules/fe-kit.md` với frontmatter `trigger: always_on` (đã kiểm trên `agy`; thiếu frontmatter thì bị bỏ im lặng) |
| `personal-core` | — (đã có CLAUDE.md gốc) | cùng khối trong `~/.codex/AGENTS.md` | `~/.gemini/config/rules/personal-core.md` |
| Quy ước dự án | `CLAUDE.md`, nếu không có thì `AGENTS.md` (đã kiểm; có cả hai thì chỉ đọc `CLAUDE.md`) | chỉ `AGENTS.md` (đã kiểm). `project_doc_fallback_filenames = ["CLAUDE.md"]` chỉ có tác dụng khi **không có** `AGENTS.md` | `AGENTS.md` hoặc `GEMINI.md` (đã kiểm); **không** đọc `CLAUDE.md` và không theo `@import` (đã kiểm) |
| shell-guard | Hỏi: `permissions.ask` trong `~/.claude/settings.json` (đã kiểm: thắng `allow`, headless chặn). Chặn bí mật: `permissions.deny` cho `Read` + PreToolUse `Bash`. Hook fail-open nên adapter phải bọc lỗi thành `deny` | Hỏi: `~/.codex/rules/fe-kit.rules` với `decision = "prompt"` hoặc `"forbidden"` (đã kiểm). `allow` cho `fe-kit ui`, `dev`, `mr fetch` để chạy ngoài sandbox (đã kiểm: Chromium không chạy được trong sandbox). Chặn bí mật: `~/.codex/hooks.json` PreToolUse → `deny` (hook không hỏi được và fail-open) | CLI: `permissions.ask\|deny` trong `~/.gemini/antigravity-cli/settings.json` (chỉ có cấp user; đã kiểm). App/IDE: `~/.gemini/config/hooks.json` với `run_command` → `force_ask` (lệnh ghi) hoặc `deny` (kho bí mật), `view_file` → `deny`; hook fail-closed (chờ kiểm tay) |
| leak-guard | `~/.claude/settings.json` PreToolUse Write/Edit | `~/.codex/hooks.json`, matcher `apply_patch` (duyệt một lần trong `/hooks`; việc ghi qua shell không bị bắt) | PreToolUse `write_to_file\|replace_file_content\|multi_replace_file_content` |
| MCP (qua `mcp-run`) | `claude mcp add --scope user` | `codex mcp add` (+ `disabled_tools`) | `~/.gemini/config/mcp_config.json` (`disabledTools`) |
| superpowers | đã cài | **IDE extension không hỗ trợ plugin** (tài liệu OpenAI). Mỗi surface chỉ một nguồn superpowers (plugin hoặc standalone), chọn ở S14; `doctor` báo trùng | App ≥ 2.18: Marketplace hoặc `agy plugin install https://github.com/obra/superpowers`; IDE: spike |
| Gọi skill tay | `/fe-verify` | `$fe-verify` | `/fe-verify` (App; CLI tự biến mọi skill thành lệnh `/`; IDE: spike) |

- **Hệ điều hành:**
  - macOS/Linux: symlink.
  - Windows: junction cho thư mục, copy cho file.
  - Mọi đường dẫn tính bằng `os.homedir()`. Không có script bash nào.
- **Không dùng rulesync hay ruler.**
  - rulesync đổi bản major liên tục và vẫn ghi vào chỗ prompt Codex đã bỏ.
  - ruler không có hook, không cài ở mức user.
  - Phần khác nhau giữa các tool chỉ còn agent, MCP và hook, đủ nhỏ để tự sinh.

## 7. Các luồng (chi tiết trong `docs/workflow.md`, router `/fe-kit` chỉ đường)

| Tình huống | Luồng | Nháp |
|---|---|---|
| Repo mới | `/fe-setup` (một lần) → sau này `/fe-onboard` | `profiles/<repo>.md`, `.fe-kit/` |
| Dựng màn hình | `/fe-screen KEY` → *brainstorming* (theo vòng) → *writing-plans* (lát dọc + seam) → *executing-plans* hoặc *subagent-driven* (mỗi commit đều hỏi) → `fe-ui-check` mỗi lát → `fe-review` (phiên mới) → `fe-verify` → `fe-pr` | specs, plans, ui, reviews, reports |
| Sửa bug | `/fe-bug KEY` → vòng lặp đỏ → thu nhỏ → giả thuyết → sửa → xanh → `fe-verify` → hỏi commit | bugs/KEY, tests, ui |
| Review MR | `/fe-mr-review !iid` → draft note (sau khi bạn xác nhận) | mr/iid |
| Tự review | `fe-review` so với base, ở phiên mới | reviews |
| Đổi tool giữa chừng | `/fe-handoff` → mở tool kia: "đọc `.fe-kit/handoffs/<file>` rồi làm tiếp" | handoffs |
| Sau phiên khó | `/fe-retro` → luật scan, chuẩn, con trỏ mới trong profile | — |

**Ranh giới phase** (ý của Matt): chỉ quyết ở giữa hai phase, theo thứ tự:
1. tiếp tục (giữ được nguồn gốc);
2. `/clear` (mọi thứ trước đó bỏ được);
3. `/fe-handoff` (cần mang đi);
4. subagent (việc gói gọn, chạy không cần bạn);
5. `/compact` (mặc định cuối cùng).

## 8. Review MR và đăng lên GitLab self-host

1. **`fe-kit mr fetch <iid>`**
   - Đọc API: MR; `/versions` (lấy `base_commit_sha`, `start_commit_sha`, `head_commit_sha` mới nhất); `/diffs` (có phân trang); `/discussions` và `/draft_notes` (để chống trùng).
   - Chạy `git fetch` nhánh nguồn.
   - Lưu vào `.fe-kit/mr/<iid>/`.
2. **Chạy `fe-review` trên khoảng commit của MR.** Trục Spec đọc issue Jira lấy từ tiêu đề hoặc nhánh của MR qua MCP.
3. **Viết comment** ngắn, giọng người, đúng ngôn ngữ của profile, không dùng em-dash.
   - Thêm câu ghi chú AI chỉ khi profile đặt `aiDisclosure`.
   - Phát hiện không nằm trên dòng thuộc diff thì gom vào ghi chú tổng.
   - **Trình cho bạn rồi dừng lại.**
4. **`fe-kit mr preview`** chỉ in ra những gì sẽ đăng. **`fe-kit mr post`** mới tạo **draft note**, và luôn đi qua `shell-guard`, nên tool hiện hộp hỏi. Chạy headless thì không có hộp hỏi nên lệnh phải bị chặn (S12 kiểm ở từng tool):
   - dòng thêm dùng `new_line`, dòng xoá dùng `old_line`, dòng giữ nguyên dùng cả hai;
   - kiểm dòng nằm trong hunk trước khi gửi;
   - vân tay (path + line + hash nội dung) ghi vào `posted.json` để chạy lại không trùng.
5. **Bạn sửa hoặc xoá draft rồi Submit review.** Lệnh `fe-kit mr publish` chỉ chạy khi bạn bảo rõ, và cũng đi qua `shell-guard`.
6. **Token:** PAT scope `api`, có ngày hết hạn. Comment đứng tên chủ token, tức là bạn.
7. **Nếu GitLab nội bộ quá cũ, không có draft notes** (S7): lùi về đăng bằng `discussions` sau khi bạn xác nhận từng comment.

## 9. Chắt lọc từ các repo

| Nguồn (license, SHA) | Lấy | Không lấy |
|---|---|---|
| **superpowers** (MIT, `bb92a77` v7.0.0) | **Dùng nguyên qua plugin.** Học: 3 lớp (skill mô tả hành động, map tool, bootstrap), `references/*-tools.md`, hook trả một kiểu JSON, thư mục làm việc tự git-ignore, pressure test cho skill | Ghi spec/plan vào `docs/superpowers/` và commit (đổi hướng sang `.fe-kit/`); hỏi từng câu một (đổi thành hỏi theo vòng) |
| **Matt Pocock** (MIT, `49dd158`; đã đọc toàn bộ `docs/` và `skills/engineering/`) | Setup ghi config theo repo; tách skill người gọi / model tự gọi + `agents/openai.yaml`; router và ranh giới phase; handoff; retro (lỗi máy móc thành check, lỗi phán đoán thành chuẩn reviewer); grilling theo vòng; seam trước, 3 lỗi test, mock ở biên; vòng lặp đỏ chặt + giả thuyết + log gắn tag + che bí mật; review 2 trục + 12 smell + bắt trích dẫn; khuôn mô tả PR (hình nhỏ nhất, ảnh trước/sau, cửa một chiều/hai chiều); prototype UI `?variant=`; tracer bullet + "demo được gì"; writing-for-agents (con trỏ, 2 loại tải, completion criteria, leading word, viết điều cần làm thay vì cấm, xoá no-op, môi trường là nguồn sự thật); docs mỗi skill có "It's working if"; `.out-of-scope/` + ADR; ý tưởng wizard cho bước chỉ người làm; GLOSSARY + ADR 3 điều kiện (để `fe-onboard`) | `wayfinder`, `implement-spec`, `triage` (nặng hoặc trùng superpowers); các skill dùng `gh`; tự commit của `implement`; cài plugin của Matt song song (sẽ có hai bộ TDD, debug, review tranh nhau) |
| **claude-plugins-official** (Apache-2.0, `ea10b213`) | Rubric 0–100 + ngưỡng 80 + danh sách false positive của `code-review`; silent-failure-hunter, type-design-analyzer, pr-test-analyzer (gộp vào 3 trục); `frontend-design` (giữ NOTICE); mẫu FE của `security-guidance`; vòng eval description của `skill-creator`; hướng dẫn agent/hook của `plugin-dev` | **`claude-security`** (license độc quyền); 10 plugin ngoài không có LICENSE |
| **Workspace cũ** (chỉ ý tưởng chung) | Grep chẩn đoán chuyển thành luật scan; hook chặn comment rò rỉ; cấu trúc checklist review FE; không tự đăng comment; base diff tính bằng merge-base | Mọi rule, profile, dữ liệu, MCP, quy trình riêng của CIC |
| **Đã cài qua `npx skills`** | Gọi tên: vercel-react-best-practices, vercel-composition-patterns, web-design-guidelines, accessibility, webapp-testing, typescript-advanced-types | Không chép |

## 10. Kế hoạch triển khai

- Mỗi phase khi bắt đầu sẽ có plan chi tiết (superpowers *writing-plans*), lưu ở `~/Code/fe-kit/tasks/phase-N.md`.
- Nghiệm thu trên `~/Code/fe-kit-sandbox`, sau đó trên một repo thật của công ty khi đã có quyền truy cập.
- Cuối phase commit vào repo kit (hỏi bạn trước khi commit).

### Trước Phase 0 — việc bạn làm tay
- [ ] **S-1.** Thu hồi khoá Figma đã lộ, xoá Figma MCP khỏi `~/.claude.json`. Khoá mới chỉ được thêm khi đã có `mcp-run` (Phase 4). Cần Figma sớm hơn thì làm `secrets` + `mcp-run` cho riêng figma trước, không đưa khoá vào cấu hình.

### Phase 0 — Spike (code bỏ đi; ghi `docs/spike.md`)

**Phase 0A — làm được ngay trên máy này. Xong 0A mới bắt đầu Phase 1:**
- [ ] **S0.** Cập nhật Codex và Antigravity App, rồi ghi lại phiên bản. Tạo `~/Code/fe-kit-sandbox` (Vite + React + TS + vitest + RTL, trang đăng nhập giả 2 vai).
- [ ] **S1.** Symlink skill `hello-fe-kit` vào chỗ của từng tool: có liệt kê được, sửa có thấy ngay không. Ghi tool nào phải copy. Antigravity kiểm riêng App, IDE và CLI `agy`.
- [ ] **S3.** Antigravity:
  - đọc `~/.gemini/config/skills` và `~/.gemini/antigravity-cli/skills` qua symlink được không;
  - CLI `agy` đọc rules, agents, MCP ở đâu (tài liệu mới xác nhận đường dẫn skill);
  - skill có đọc `references/` nằm ngoài workspace được không;
  - `/skill` và custom agent có chạy trong IDE không;
  - skill "chỉ người gọi" có tự bị kích hoạt không.
- [ ] **S4.** Lệnh `fe-kit` gọi được từ terminal của agent ở cả 3 tool không: kiểm PATH trong app GUI và sandbox.
- [ ] **S5.** Playwright với sandbox: đăng nhập tay, lưu `storageState`, mở lại vẫn còn phiên.
- [ ] **S6.** Codex sandbox có chặn mạng tới localhost và GitLab không, cần cấu hình gì.
- [ ] **S8.** Hỏi từng tool "nháp để đâu?" và về một quy ước trong `CLAUDE.md` của sandbox: kiểm `fe-kit-core`, `personal-core` và quy ước dự án đã nạp đủ ở 3 tool.
- [ ] **S9.** Ghi stdin thật mà hook của từng tool nhận, làm fixture test.
- [ ] **S10.** Test local `.fe-kit/tests/` chạy bằng vitest của dự án qua config phủ.
- [ ] **S12.** `shell-guard` trên từng surface (Claude, Codex CLI và IDE, Antigravity App/IDE/CLI):
  - Lệnh cần kiểm: mọi lệnh trong danh sách hỏi (§5.7) × 3 dạng gọi, kể cả khi lệnh đó từng được "Always Allow".
  - Kiểm tay trên giao diện: hộp hỏi hiện thật.
  - Chạy headless (`claude -p`, `codex exec`, `agy`): lệnh bị chặn, không có thay đổi.
  - Hook hỏng (thiếu script, timeout, exit 1, output sai schema): lệnh bị chặn, hoặc ghi rủi ro nếu host không fail-closed được.
  - Surface nào không ép hỏi được thì chốt fallback `deny` trước Phase 1.
- [ ] **S13.** Chỉ dẫn luôn bật có thắng superpowers không, ở cả 3 tool. Chạy brainstorming và writing-plans trong sandbox:
  - spec/plan nằm ở `.fe-kit/`, không bị commit;
  - hỏi theo vòng, không hỏi từng câu một.

  Không thắng thì dừng lại hỏi bạn: viết skill phủ nhỏ hay fork. Chạy lại S13 sau mỗi lần nâng superpowers.
- [ ] **S14.** Superpowers trên Codex (IDE extension không hỗ trợ plugin):
  - IDE có thấy skill trong `~/.agents/skills` không;
  - chốt **mỗi surface một nguồn**, kiểm khi mọi cấu hình đã cài cùng lúc (Codex CLI, Codex IDE):
    - phương án mặc định: standalone cho cả Codex CLI lẫn IDE, không bật plugin Codex;
    - cách nạp `using-superpowers` khi không có hook của plugin (con trỏ trong `fe-kit-core`);
  - custom agent `.toml` có tuân "chỉ đọc" theo `developer_instructions` không.

**Phase 0B — làm khi có quyền truy cập ở công ty mới. Không chặn Phase 1–3:**
- [ ] **S7.** GitLab self-host. Chặn Phase 6.
  - `GET /version`;
  - đọc versions và diffs của một MR;
  - tạo một draft note inline rồi xoá;
  - kiểm `bulk_publish` có nhận `reviewer_state` không.

  Trước khi có quyền, có thể thử trên một project gitlab.com do chính bạn sở hữu. Việc tạo/xoá draft note chỉ làm sau khi bạn đồng ý.
- [ ] **S11.** `mcp-atlassian` với Jira và Confluence DC của công ty: đúng tên biến, PAT, chế độ chỉ đọc, đọc được một issue và một trang. Kiểm thêm **chính sách công ty về dùng AI với dữ liệu nội bộ**. Chặn việc thêm `atlassian` ở Phase 4.

- **Kết quả:** chốt bảng đích trong `src/lib/tools.mjs` và cập nhật §6. Kết quả Phase 0A ghi ở `docs/spike.md`; §6 đã cập nhật theo bằng chứng headless, ô nào còn "chờ" là phần GUI cần bạn kiểm tay.

### Phase 1 — Khung repo, cài đặt, chỉ dẫn, quyền, router
- [ ] Tạo khung repo (§4); `git init`; ghi `docs/adr/0001…0004` cho 4 quyết định nền (superpowers là quy trình, không dùng rulesync, nháp trong `.fe-kit/`, skill chia 2 loại).
- [ ] `tools.mjs`, `fsx.mjs` (symlink, junction, copy, backup), `link|unlink|doctor` (dry-run mặc định).
- [ ] `rules/fe-kit-core.md`, `rules/personal-core.md` (bạn duyệt nội dung); cài ra các đích.
- [ ] `profile.mjs` + `detect.mjs` (stack, package manager, test runner, monorepo), `context`, `init`.
- [ ] `shell-guard` (hỏi trước + chặn đọc kho bí mật) theo bảng §6 và kết quả S12.
- [ ] Skill `fe-kit` (router) và `fe-setup`; trang docs cho mỗi skill.
- [ ] `validate` + `npm test`.
- [ ] Cài superpowers cho Codex (mọi surface theo kết quả S14), Antigravity (bạn bấm, tôi hướng dẫn).
- **Nghiệm thu**
  - `doctor` xanh cho 3 tool. `link` chạy lại lần 2 không đổi gì.
  - `/fe-setup` trong sandbox tạo đúng hồ sơ.
  - Hỏi mỗi tool "type-check bằng lệnh gì, nháp để đâu" → trả lời đúng.
  - Brainstorm thử → hỏi theo vòng; spec nằm ở `.fe-kit/specs/`; `git status` sạch.
  - Mỗi surface chỉ thấy một nguồn superpowers khi mọi cấu hình đã cài cùng lúc.
  - Bảo commit → kỳ vọng lấy từ bảng khả năng chốt ở S12:
    - surface hỗ trợ hỏi thì hiện hộp hỏi mỗi lần (kiểm tay);
    - surface fallback thì từ chối, không có thay đổi và đưa lệnh để bạn tự chạy;
    - headless luôn bị chặn.

### Phase 2 — Kiểm chứng code
- [ ] `scan` (luật chung, có fixture cho từng luật), `rules`, `test`, `verify`.
- [ ] Skill `fe-standards` (kèm `references/` chung: typescript, react, next, testing, a11y, security), skill `fe-verify`.
- **Nghiệm thu:** branch trong sandbox có một `any`, một `dangerouslySetInnerHTML` và một test fail → `fe-verify` ở cả 3 tool báo đủ 3, kèm lệnh và kết quả thật.

### Phase 3 — Xem UI thật
- [ ] `auth`, `dev`, `ui`, `ui-act`: viewport, console, request lỗi, nhận biết bị đá về trang login, các bước kịch bản, chặn request ghi trên đích `readOnly` (trừ `safeRequests`; `ui-act` cho đúng một request khai báo).
- [ ] Skill `fe-ui-check`.
- **Nghiệm thu**
  - Sandbox 2 vai → ảnh và báo cáo có trong `.fe-kit/ui/`.
  - Phiên hết hạn → đưa đúng lệnh đăng nhập lại.
  - Kịch bản điền form rồi submit trên đích `readOnly`:
    - `ui`: giá trị đã nhập giữ nguyên trong kịch bản, request submit bị chặn, dữ liệu không đổi;
    - `ui-act --allow-request` khớp: kỳ vọng theo bảng khả năng S12 (hỏi rồi đúng một request đi qua, hoặc fallback từ chối);
    - kịch bản bắn thêm một request ghi thứ hai: bị chặn;
    - headless: bị chặn.

### Phase 4 — MCP và bí mật
- [ ] `fe-kit secrets`, `bin/mcp-run.mjs`, `fe-kit mcp status|add`, `mcp/servers.json`.
- [ ] Đăng ký `figma`, `chrome-devtools`, `context7` cho 3 tool. Thêm `atlassian` khi đã qua S11.
- [ ] Đăng ký lại `figma` cho Claude qua wrapper, với khoá mới nhập bằng `fe-kit secrets` (khoá cũ đã thu hồi ở S-1).
- **Nghiệm thu**
  - Mỗi tool đọc được một frame Figma; đọc được Jira/Confluence khi đã có quyền.
  - `doctor` quét: không file cấu hình nào của tool chứa bí mật.
  - Bảo từng tool in token hoặc cookie đăng nhập → lệnh bị chặn.

### Phase 5 — Review và mô tả MR
- [ ] Viết 3 reviewer và `rubric.md`. `link` sinh agent gốc cho Claude, Codex, Antigravity.
- [ ] Skill `fe-review` (khoảng commit hoặc working tree), skill `fe-pr`.
- **Nghiệm thu**
  - Sandbox có bug cài sẵn, mỗi bug có ID và severity trong `fixtures/bugs.json` (ground truth).
  - Mỗi tool chạy `fe-review` 3 lần: mọi bug Critical được bắt ở ít nhất 2/3 lần chạy; mỗi lần có tối đa 2 phát hiện sai (không có trong ground truth và bạn xác nhận là sai). Không đòi các tool trùng câu chữ hay trùng tập phát hiện.
  - Không có phát hiện nào dưới 80 ở trục Correctness.
  - Mỗi phát hiện ở Standards/Spec đều có trích dẫn.
  - Sau khi review, working tree không đổi (§5.2).
  - `fe-pr` có ảnh trước/sau.

### Phase 6 — Review MR trên GitLab
- [ ] `diff.mjs` (parse hunk, map position), `gitlab.mjs`, `mr fetch|post|publish|status`. Test với diff mẫu (thêm, xoá, giữ nguyên, đổi tên, nhiều hunk), chống trùng, dry-run (giả lập fetch).
- [ ] Skill `fe-mr-review`.
- **Nghiệm thu:** MR thử → draft note đúng dòng; chạy lại không trùng; chỉ đăng sau khi bạn gõ xác nhận.

### Phase 7 — Sửa bug, dựng màn hình, TDD, prototype, leak-guard
- [ ] Skill `fe-bug`, `fe-tdd`, `fe-screen`, `fe-prototype`; các template.
- [ ] `hooks/leak-guard.mjs` cùng adapter 3 tool, test bằng fixture từ S9.
- **Nghiệm thu**
  - Sửa một bug cài sẵn trong sandbox: kịch bản đỏ rồi xanh, test theo đúng chính sách, commit có hỏi.
  - Dựng một màn nhỏ từ spec + một frame Figma.
  - Prototype 3 biến thể khác nhau về cấu trúc.
  - Agent cố ghi comment chứa `.fe-kit/` → bị chặn.

### Phase 8 — Handoff, retro, onboard, hoàn thiện
- [ ] Skill `fe-handoff`, `fe-retro`, `fe-onboard`, `fe-research`, `kit-authoring`.
- [ ] README, NOTICE, UPSTREAM, `.out-of-scope/`, `doctor --upstream`.
- [ ] Chạy test trên Windows và Linux (máy ảo, hoặc máy công ty khi đã biết).
- **Nghiệm thu**
  - Bắt đầu một việc trong Claude, `/fe-handoff`, làm tiếp trong Codex mà không phải giải thích lại.
  - `/fe-retro` sau một phiên có lỗi lặp → đề xuất ít nhất một luật scan thật.

## 11. Kiểm chứng

- **Unit test** (`node --test`):
  - dò stack và khớp profile;
  - khớp glob của rule;
  - từng luật scan;
  - parse diff và map position GitLab;
  - chống trùng và dry-run của `mr post`;
  - `link`/`unlink` trong HOME tạm sạch (đủ 3 tool, giả lập Windows bằng chế độ copy); chạy `link` lần 2 không đổi gì;
  - adapter hook với stdin thật: `deny` cho cả 3 tool; hỏi cho Claude (`ask`), Antigravity (`force_ask`); adapter Codex không bao giờ sinh `ask`;
  - `shell-guard` chặn các lệnh đọc kho bí mật (`cat`, `head`, `node -e …readFile…` trỏ thẳng vào đường dẫn);
  - `shell-guard` bắt 3 dạng gọi `fe-kit`, cả khi nối lệnh hoặc lồng trong `bash -c`; Codex rule sinh đủ 3 dạng (`codex execpolicy check`);
  - fail-closed: thiếu stdin, JSON hỏng, lỗi trong adapter → `deny`;
  - `mcp-run` không in bí mật ra stdout;
  - config phủ của `test`;
  - `.fe-kit` tự bỏ qua.
- **`fe-kit validate` kiểm:**
  - frontmatter của skill:
    - chỉ `name`, `description`, `disable-model-invocation`;
    - `name` trùng thư mục, tối đa 64 ký tự;
    - description tối đa 1024 ký tự;
    - skill model tự gọi phải bắt đầu bằng "Use when";
  - skill người gọi phải có `agents/openai.yaml` khớp;
  - router `fe-kit` nhắc tới mọi skill người gọi;
  - không skill nào gọi skill người gọi khác;
  - thân skill dưới 500 dòng;
  - không có từ riêng của một tool nằm ngoài mục "Tool notes";
  - link không gãy;
  - không có bí mật;
  - không có em-dash trong khuôn văn bản đăng ra ngoài.
- **Nghiệm thu trên 3 tool**, mỗi phase một lần, chia 2 bộ:
  - **Headless (tự động):** Claude chạy `claude -p`, Codex `codex exec`, Antigravity qua `agy`. Kiểm kết quả, lệnh bị chặn và không có thay đổi ngoài ý muốn (`git log`, working tree, draft note).
  - **Tương tác (kiểm tay):** những gì cần hộp hỏi thật (commit, `mr post`, `ui-act`) kiểm trên giao diện từng tool, kỳ vọng theo bảng khả năng của S12 (hỏi, hoặc fallback từ chối). Chế độ headless không chứng minh được hộp hỏi hiện ra.
  - Các gạch đầu dòng **"It's working if"** trong `docs/skills/*.md` là checklist nghiệm thu.
  - Transcript lưu ở `docs/acceptance/`.

## 12. Rủi ro và điểm chưa kiểm

| Rủi ro | Cách xử lý |
|---|---|
| Công ty mới hạn chế dùng AI với code, Jira, Confluence | S11 kiểm chính sách trước; kit chạy được không cần MCP (dán nội dung tay) |
| Symlink không đọc được hoặc không reload ở tool nào đó; Windows | S1/S3. `tools.mjs` cho chọn link hay copy theo tool; junction trên Windows; `doctor` báo bản copy cũ |
| Antigravity chặn file ngoài workspace, chạy lệnh trong sandbox, không có cơ chế skill "chỉ người gọi" (tài liệu xác nhận) | S3/S4. Cấp quyền `read_file`/`command(fe-kit)`, hoặc copy skill vào thư mục skill của Antigravity; description ghi rõ |
| Agent cùng tài khoản đọc được kho bí mật | 3 lớp ở §5.8; rủi ro đọc gián tiếp được ghi rõ, không hứa chặn tuyệt đối |
| Codex IDE không có plugin, nên thiếu superpowers | S14. Cài skill superpowers dạng standalone, hoặc dùng Codex CLI/App cho luồng cần superpowers |
| Skill model tự gọi bị kích hoạt quá đà trên model GPT (Matt ghi nhận với debug) | Skill nặng (`fe-bug`, `fe-screen`) đặt là "chỉ người gọi" |
| Hai bộ quy trình giành nhau (superpowers và skill FE) | Skill FE bổ sung chứ không thay: gọi tên skill superpowers ở bước tương ứng; khối luôn bật nói rõ ai làm gì |
| Chỉ dẫn luôn bật thua superpowers (hỏi từng câu, ghi spec vào `docs/` rồi commit) | S13 trên 3 tool, chạy lại sau mỗi lần nâng superpowers. "Giữ nguyên superpowers" nghĩa là không fork và ghim version; kit chỉ phủ lên bằng chỉ dẫn luôn bật |
| `mcp-atlassian` không hợp phiên bản Jira/Confluence của công ty | S11. Dự phòng: server khác hoặc lệnh chỉ đọc qua REST trong CLI |
| GitLab nội bộ thiếu draft notes hoặc `reviewer_state` | S7. Lùi về `discussions` sau khi bạn xác nhận từng comment |
| Phiên SSO ngắn hoặc có MFA | Đăng nhập lại bằng một lệnh; `ui` tự nhận ra phiên hết hạn |
| `personal-core` lệch với `~/.claude/CLAUDE.md`; superpowers đổi lớn | `doctor` so hash; UPSTREAM ghi version; kit chỉ gọi tên skill superpowers |
| Codex bắt duyệt lại hook khi entry đổi | Entry cố định `node <script>`; sửa logic trong script |
| CLI tự cập nhật giữa phiên (`agy` 1.1.5 lên 1.4.0, Codex 0.145 lên 0.163 trong vài giờ) | Ghi phiên bản cạnh mọi kết luận; `doctor` in phiên bản từng tool; chạy lại spike liên quan khi nâng bản lớn |
| Tài liệu một tool sai so với thực tế (`agy` ghi `antigravity-cli/skills` nhưng không đọc) | Mọi ô của §6 dựa vào bằng chứng chạy thật kèm phiên bản; `doctor` kiểm lại bằng skill marker |
| `description` YAML có dấu `:` không bọc quote làm skill không nạp (changelog `agy` 1.3.6) | `validate` parse YAML của frontmatter và báo lỗi |
| Hook Claude/Codex fail-open nếu chính script hook không chạy được | `doctor` chạy thử từng hook với stdin mẫu; adapter bọc lỗi thành `deny` |
| Claude bỏ qua `permissions.allow` cấp dự án khi workspace chưa tin cậy | Luật của kit đặt ở cấp user |
| Chromium không chạy trong sandbox Codex trên macOS | Rule `allow` cho `fe-kit ui` để chạy ngoài sandbox (đã kiểm) |

## 13. Các quyết định tôi tự chốt (bạn soát khi đọc)

1. **Tên:** repo `~/Code/fe-kit`, lệnh `fe-kit`, thư mục nháp `.fe-kit/`, sandbox `~/Code/fe-kit-sandbox`.
2. **Superpowers là quy trình; ý của Matt vào kit dưới dạng kỷ luật FE.** Không cài plugin của Matt song song.
3. **Skill chia 2 loại.** Skill nặng (`fe-screen`, `fe-bug`, `fe-mr-review`) là "chỉ người gọi", để tránh tự kích hoạt và tốn ngữ cảnh.
4. **Review 3 trục** (Correctness / Standards / Spec), mỗi trục một subagent, không gộp điểm.
5. **Hồ sơ dự án là markdown + YAML trong repo kit**, do `/fe-setup` tạo. Lệnh lấy từ `package.json` lúc chạy, hồ sơ chỉ ghi phần ghi đè.
6. **GitLab gọi bằng API trong CLI.** Jira/Confluence qua `mcp-atlassian` chỉ đọc.
7. **Mọi bí mật nhập qua `fe-kit secrets`** (ẩn ký tự) vào `~/.config/fe-kit/env`. Mọi MCP chạy qua `mcp-run`.
8. **Môi trường dùng chung mặc định chỉ đọc.** Mỗi request ghi trên đó cần một lần bạn đồng ý; bấm và nhập thì tự do (`ui-act --allow-request` cho đúng một request khai báo mỗi lần gọi; bạn chốt 2026-10-18). Rủi ro còn lại: API đổi dữ liệu bằng GET thì không bị chặn.
9. **Comment MR mặc định không có câu ghi chú AI** (`aiDisclosure: none`), vì bạn duyệt mọi thứ trước khi đăng. Đổi được theo chính sách công ty.
10. **Thân skill viết tiếng Anh;** chat và nháp tiếng Việt; ngôn ngữ comment MR theo profile.
11. **Bản đầu không có hook session-start.**
12. **Chỉ dùng Node, không bash.** Test macOS trước, Windows/Linux ở Phase 8 hoặc sớm hơn khi biết máy công ty.
13. **`fe-onboard`, `fe-research`, `fe-retro`, `fe-handoff` để Phase 8.** Bản đầu tập trung vào kiểm chứng, UI, review.
