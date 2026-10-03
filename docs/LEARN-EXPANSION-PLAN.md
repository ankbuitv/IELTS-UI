# Learn expansion — plan (DRAFT, NOT STARTED)

> Status: **chưa implement**. Đây là bản ghi spec + hiện trạng để chốt yêu cầu trước khi code.
> Owner yêu cầu: chủ repo. Ngày ghi: 2026-10-03.

## Yêu cầu (nguyên văn ý của chủ repo)

1. **Phần Learn thêm nhiều bài** — mỗi band tầm **50–100 bài**, có thể **cho AI tự thêm vào**.
2. **Mode xây dựng lộ trình** dựa trên **trình độ từ bài test** của người học — AI tự tạo các bài
   **trên trình độ** hiện tại của họ.
3. Làm từ từ, hỏi thêm khi cần, **chỉ bắt đầu khi chủ repo cho phép**.

## Hiện trạng đã kiểm chứng trong repo (commit `b754555`)

| Thứ | Đang có | Nguồn |
|---|---|---|
| Số unit | 4 unit (`u1`–`u4`) | `src/shared/learn-content.ts` |
| Số bài | **16 bài** (4 bài/unit), **96 từ** trong `WORD_BANK` | `src/shared/learn-content.ts` (19.407 bytes) |
| Mỗi bài | 6 từ vựng | `LessonDef.words` |
| Bài tập | Sinh **client-side** từ 6 từ đó, seed tất định: `choose`, `fill`, `listen`, `type`, `order`, `match` (~9–12 câu/bài) | `src/shared/learn-engine.ts` |
| Tier trình độ | `LearnLevel = 4 \| 5 \| 6 \| 7` → "Foundations", "Everyday topics", "Task language", "Academic range" | `src/shared/learn.ts` |
| Band → tier | `levelForBand`: <4.5→4, <6→5, <7→6, còn lại→7 | `src/shared/learn.ts` |
| Mở khoá bài | **Tuyến tính theo `index`**: `unlockedThrough(furthestCompleted, level)` = `max(furthest+1, startIndexForLevel(level))` | `src/shared/learn-content.ts` |
| Level của user | `CHOSEN` (user tự chọn) → nếu không thì `ESTIMATED` = trung bình 6 `estimated_band` gần nhất từ `attempt_skill_sessions` (`levelHintForUser`) → nếu không thì `DEFAULT` 5 | `src/worker/services/learn-service.ts`, `ai-marking-service.ts:651` |
| Server lưu gì | Chỉ thứ cần tin: XP, streak, daily goal, stars theo `lesson_id` (`learn_lessons_done`), notebook + Leitner box. **Không lưu nội dung bài** | `migrations/0009_learn_and_vocabulary.sql` |
| AI đã có sẵn | `POST /api/learn/daily-words` (rate-limited, sinh từ mới theo band + topic trong ngày), dictionary lookup, provider cấu hình ở `platform_settings.ai_providers` | `src/worker/routes/learn.ts`, `src/worker/ai/*` |
| Test liên quan | `tests/unit/learn.test.ts` — có test cứng "four units of four lessons with six words each" → **sẽ phải sửa** khi mở rộng | `tests/unit/learn.test.ts:34` |

Ghi chú nhỏ thấy khi đọc: `setLearnLevel()` ghi giá trị level (4/5/6/7) vào cột `start_band`,
nên cột này đang phục vụ hai nghĩa ("level do user chọn" và "band ước lượng"). Không hỏng,
nhưng nếu làm phần roadmap thì nên tách bạch.

## Quyết định đã chốt (2026-10-03)

| # | Câu hỏi | Chốt |
|---|---|---|
| A | Nội dung nằm ở đâu | **A1 — tĩnh, commit vào repo.** AI sinh một lần → validate → commit thành data. |
| B | Cấu trúc band | **Chia 0.5 band, 4.0 → 8.0 (9 bậc)**, mỗi bậc 50–100 bài → tổng **450–900 bài**. |
| C | Loại nội dung | **Đa kỹ năng**: vocab, paraphrase, mini Reading/Listening, câu Writing, mẫu Speaking. |
| D | Lộ trình | **Đủ đầu vào** (band mục tiêu + ngày thi + theo từng skill) **nhưng người học bấm "Lập lại lộ trình"**, không tự đổi giữa chừng. |
| Q1 | "AI tạo bài trên trình độ" vs nội dung tĩnh | **Pool tĩnh + AI sinh BÀI CÁ NHÂN từ lỗi của user.** Pool theo band không đổi; thêm 1 bài cá nhân sinh từ đúng những từ/câu user vừa sai, lưu D1, chỉ user đó thấy. |
| Q2 | Audio mini-Listening | **Bỏ mini-Listening.** Không làm module nghe mới. |
| Q3 | Pipeline sinh nội dung | **Nút trong trang Admin** — gọi provider đã cấu hình, xem trước, rồi lưu. |
| Q4 | Cách ship | **Một lần duy nhất, một PR.** |

### Hệ quả của Q2 (bỏ mini-Listening)

Các loại bài học còn lại: **vocab, paraphrase, mini Reading, câu Writing, mẫu Speaking**.
Bài `listen` **cấp từ vựng** hiện có (`buildListen` trong `learn-engine.ts`, chạy bằng
`speak()` của `speech.ts`) **giữ nguyên** vì nó đã ship và đã có test — ta chỉ không thêm
*module nghe* mới. Nếu muốn bỏ luôn bài `listen` cấp từ thì nói.

### ⚠️ Xung đột thứ hai: Q3 (nút Admin) vs A (nội dung tĩnh commit vào repo)

Một nút trong trang Admin chạy lúc runtime thì **không commit file vào repo được**. Muốn giữ
đúng A1 thì màn Admin phải là **công cụ soạn bài có bước xuất file** (generate → xem trước →
sửa → tải JSON về → dev commit), còn không thì nội dung phải nằm D1 (tức là A2, trái với A).
Repo đã có tiền lệ cho kiểu "AI cấu trúc nội dung trong request, giữ text trong D1":
`src/worker/services/import-service.ts` + `src/client/pages/admin/AdminImports.tsx`.
→ **Chưa chốt, xem Q5 cuối file.**

## Hệ quả kỹ thuật đã kiểm chứng sau khi chốt

1. **⚠️ Mâu thuẫn cần giải quyết.** Yêu cầu ban đầu là *"AI tự tạo các bài trên trình độ của tôi"*,
   nhưng nội dung đã chốt là **tĩnh (A1)**. Nội dung tĩnh thì **không thể sinh bài riêng cho từng
   người lúc runtime** — lộ trình chỉ có thể **chọn** bài từ pool đã commit. Phải chốt hướng xử lý
   (xem câu hỏi mở Q1).
2. **Client hiện KHÔNG có code-splitting.** `grep` toàn bộ `src/client` chỉ ra đúng một `import(`
   và đó là **type-only** (`useExamSession.ts:69`); `App.tsx` không có `React.lazy` nào, và
   `vite.config.ts` đặt `chunkSizeWarningLimit: 1200`. Nghĩa là 450–900 bài đa kỹ năng nhét vào
   `src/shared` sẽ nằm **trọn trong một bundle**. Bắt buộc phải thêm dynamic import theo band
   (hạ tầng mới, chưa có gì để tái sử dụng).
3. **Audio cho mini-Listening.** `migrations/0003_url_assets.sql` nói rõ V1 **không có object
   storage**: media là `EXTERNAL_URL` hoặc `BUNDLED`. Trong khi đó `src/client/lib/speech.ts` đã có
   `speak()` dùng `speechSynthesis` giọng `en-GB` — bài `listen` hiện tại đang chạy bằng TTS.
   Vậy mini-Listening có thể làm TTS thuần, không cần file audio (xem Q2).
4. **Test cứng phải sửa**: `tests/unit/learn.test.ts:34` "has four units of four lessons with six
   words each".
5. `LearnLevel = 4 | 5 | 6 | 7` và `levelForBand()` là API công khai dùng ở cả client lẫn worker
   (`setLearnLevel` validate bằng `LEARN_LEVELS.includes`) → đổi sang 9 bậc là sửa cả
   `PUT /api/learn/level` (hiện đang `z.number().int()`, sẽ phải nhận 4.0–8.0 bước 0.5).

## Hai việc cần làm (phác thảo, chưa chốt)

### A. Nhiều bài hơn cho mỗi band

Câu hỏi lớn nhất: **nội dung nằm ở đâu?**

- **(A1) Tĩnh, commit vào repo** — AI sinh một lần → validate → commit thành data
  (`learn-content` tách ra nhiều file/JSON theo band). Offline, miễn phí khi serve, review được,
  không tốn AI call. Đúng tinh thần comment hiện tại: *"static so a lesson works offline and
  costs nothing to serve"*. Giá: bundle client phình lên (ước tính 900 bài × 6 từ ≈ 1 MB JSON
  thô → cần lazy-load theo band), và thêm bài mới phải deploy.
- **(A2) Runtime AI + lưu D1** — bảng `learn_lessons` mới, admin/AI sinh bài, phục vụ qua API.
  Linh hoạt, thêm bài không cần deploy. Giá: cần provider chạy, cần quota/rate-limit, cần màn
  admin duyệt nội dung, mất tính offline.
- **(A3) Hybrid** — seed tĩnh lớn (đã duyệt) + AI sinh thêm "bài kế tiếp" khi người học đi hết
  phần tĩnh, sinh xong lưu D1 và gắn cờ `AI_GENERATED` (admin duyệt sau).

### B. Lộ trình cá nhân theo trình độ test

- Đầu vào: `estimated_band` theo **từng skill** (Reading/Listening/Writing — schema
  `attempt_skill_sessions.skill` chỉ có 3 giá trị này), band mục tiêu, ngày thi dự kiến,
  số phút học mỗi ngày.
- Đầu ra: kế hoạch theo tuần/ngày, mỗi ngày một số bài Learn + (có thể) lịch làm mock test.
- "Bài trên trình độ": cần chốt khoảng cách (hiện `buildVocabMessages` đang pitch **+0.5 đến
  +1 band**).
- Tự lập lại kế hoạch sau mỗi bài test mới? Hay người học bấm "lập lại"?
- Lưu ở đâu: bảng mới `learn_plans` / `learn_plan_items` (cột `status`, `due_day`, `source`).
- Nếu chọn A2/A3 thì phần "AI tự tạo bài trên trình độ" gắn luôn vào pipeline sinh bài.

## Checklist khi bắt đầu (đã cập nhật theo quyết định A/B/C/D)

- [ ] Đổi `LearnLevel` thành thang 0.5 (4.0–8.0) + viết lại `levelForBand()`,
      `LEARN_LEVELS`, `LEARN_LEVEL_LABELS`; sửa `PUT /api/learn/level` nhận bước 0.5.
- [ ] Thiết kế `LessonDef` đa kỹ năng (vocab / paraphrase / mini Reading / mini Listening /
      Writing sentence / Speaking pattern) + mở rộng `Exercise` union trong `learn-engine.ts`.
- [ ] Tách nội dung khỏi `learn-content.ts` thành data theo band, **lazy-load bằng dynamic
      import** (hạ tầng mới — client hiện chưa có code-splitting nào).
- [ ] Pipeline sinh nội dung: prompt theo mẫu `coach-prompts.ts` (`TASK_KIND`, output JSON thuần),
      validate bằng zod, ghi ra file, có script để chạy lại.
- [ ] Bảng + migration cho lộ trình (`learn_plans` / `learn_plan_items`: band mục tiêu, ngày thi,
      phút/ngày, mục theo ngày, `status`, nguồn) — nội dung bài vẫn tĩnh, chỉ kế hoạch là động.
- [ ] API: catalogue bài theo band (phân trang), plan CRUD, endpoint "Lập lại lộ trình".
- [ ] UI: `LearnPage` đang render `UNITS.map(...)` 16 bài một cột → phải thành tab band +
      danh sách phân trang/cuộn ảo; thêm trang lộ trình.
- [ ] Mở rộng `LessonPlayer.tsx` (542 dòng) cho các loại bài tập mới.
- [ ] Sửa `tests/unit/learn.test.ts:34` (test cứng 4×4×6) + thêm test cho invariant nội dung và
      plan engine.
- [ ] Chạy `npm run typecheck`, `npm run lint`, `npm test`.

## Câu hỏi mở còn lại

- ~~**Q1** — "AI tự tạo bài trên trình độ" với nội dung tĩnh?~~ → **đã chốt**: pool tĩnh +
  bài cá nhân sinh từ lỗi của user, lưu D1.
- ~~**Q2** — Mini-Listening?~~ → **đã chốt**: bỏ.
- ~~**Q3** — Pipeline sinh nội dung?~~ → **đã chốt**: nút trong trang Admin.
- ~~**Q4** — Chia phase?~~ → **đã chốt**: một lần, một PR.
- **Q5 (CÒN MỞ, chặn kiến trúc)** — Nút Admin sinh bài thì nội dung nằm đâu: xuất file để commit
  (giữ đúng A1) hay lưu D1 và serve qua API (thành A2)?

## Ghi chú rủi ro cho Q4 (một PR duy nhất)

Scope đã chốt gồm: đổi thang band 4.0–8.0 (sửa `LearnLevel`, `levelForBand`,
`PUT /api/learn/level`), thêm code-splitting cho client (hiện chưa có), engine + `LessonPlayer`
đa kỹ năng mới (4 loại bài mới), 450–900 bài nội dung, màn Admin sinh bài, schema + API cho lộ
trình. Làm một lần thì diff rất lớn và khó review. Nếu sau này muốn tách, điểm cắt tự nhiên là
**"hạ tầng nội dung" → "lộ trình"**.

## ⚠️ QUYẾT ĐỊNH CUỐI: Q5 đã ĐẢO quyết định A

Bro chốt A = **"tĩnh, commit vào repo"**, nhưng Q5 lại chốt **"Admin lưu thẳng vào D1, serve qua
API"**. Hai cái này loại trừ nhau. **Quyết định sau thắng → kiến trúc cuối là A2 (nội dung nằm
D1, admin sinh bằng AI, serve qua API), không còn là nội dung tĩnh trong repo.**

Hệ quả kéo theo, đều đã kiểm chứng trong code:

| Thay đổi | Vì sao |
|---|---|
| Bỏ được yêu cầu code-splitting client | Nội dung không còn nằm trong bundle → hệ quả #2 ở trên **hết hiệu lực**. |
| `completeLesson()` phải đổi | `src/worker/services/learn-service.ts` đang gọi `lessonById(input.lessonId)` trên nội dung **tĩnh** để validate. Nội dung vào D1 thì phải tra DB. |
| `findBankWord(term)` phải đổi | Cùng file, đang tra `WORD_BANK` tĩnh để đẩy từ sai vào notebook. Từ giờ lấy từ payload bài học. |
| `buildLesson` **không phải sửa** | `learn-engine.ts` đã hỗ trợ `options.pool` thay cho `WORD_BANK` — chỉ cần truyền pool theo band vào. |
| Mất offline | Đây là điểm A1 mua được và A2 bỏ. Comment đầu `learn-content.ts` ("static so a lesson works offline and costs nothing to serve") sẽ phải viết lại. |
| Thêm việc phải lo | Bảng mới, migration, API + phân trang, màn Admin, và nội dung giờ là dữ liệu cần backup chứ không nằm trong git. |

## Con số cuối đã chốt (Q6)

- **9 bậc band** (4.0 → 8.0, bước 0.5) × **60 bài/bậc** = **540 bài**.
- **8 mục học/bài** → **~4.320 mục** tổng.
- 5 loại nội dung: vocab, paraphrase, mini Reading, câu Writing, mẫu Speaking.
- Không có module nghe mới (giữ nguyên bài `listen` cấp từ vựng đã ship).

## TRẠNG THÁI: ĐANG LÀM — 3 PHASE

Chủ repo đổi Q4: **chia 3 phase, làm từ từ.**

### Phase 1 — Nền móng: thang band 0.5 + nội dung vào D1 + catalogue API *(XONG)*

Không AI, không lộ trình. Sau phase này hệ thống chạy trên thang band mới, nội dung đọc từ DB,
engine giữ nguyên.

- [x] `LearnBand` 4.0 → 8.0 bước 0.5 thay cho `LearnLevel` 4/5/6/7 (`bandForEstimate`,
      `stretchBand`, `bandBelow`, `bandIndex`, `isLearnBand`).
- [x] Mở khoá theo band: `openPositionCount()` + `bandIsOpen()` (pure, có test).
- [x] Migration `0011_learn_lessons.sql` + `npm run schema:generate` (44 bảng, 60 index).
      Thêm cột `learn_profiles.band_source` để phân biệt band tự chọn vs band ước lượng.
- [x] `learn-catalogue-service.ts`: tự seed nội dung built-in khi bảng rỗng (`INSERT OR IGNORE`,
      idempotent), `getCatalogue`, `getLessonPlay`, `getLessonForCompletion`, `wordPool`.
- [x] API `GET /api/learn/catalogue?band=`, `GET /api/learn/lessons/:id`, `PUT /api/learn/band`.
- [x] `completeLesson` validate bài qua DB; từ sai chỉ nhận từ **chính bài đó** (chặn ghi text lạ
      vào notebook).
- [x] Nội dung built-in phủ đủ 9 bậc: 4 unit cũ gán lại band 4/5/6/7 + **5 unit mới** (4.5, 5.5,
      6.5, 7.5, 8.0) = **36 bài / 216 từ**.
- [x] Client fetch catalogue; `LearnPage` có band strip 9 nấc; `LessonPage` fetch bài rồi build.
- [x] Test: 285 → **293** (thêm 8).

**Việc phát sinh ngoài dự kiến (đều đã xử lý):**

1. **Engine vẫn kéo nội dung vào bundle.** Sau khi build, `grep` thấy `seminal`/`lecture` vẫn nằm
   trong `dist/client/assets/index-*.js`: `learn-engine.ts` import `WORD_BANK` làm pool mặc định.
   Đã bỏ fallback đó (`options.pool ?? []`) và engine không còn import `learn-content.ts`.
   → Bundle **793.59 kB → 763.00 kB** (gzip 229.58 → 216.86 kB).
2. **Review mất pool.** Vì engine hết bank tĩnh, `GET /api/learn/review` nay trả thêm `pool`
   (từ cùng band của người học) qua `getReviewPool()`, và `buildReviewLesson` nhận pool tham số.
3. **`dictionary-service.ts`** map band → CEFR bằng object khoá 4/5/6/7; đã thay bằng
   `CEFR_FOR_BAND: Record<LearnBand, string>` (giữ nguyên 4→B1, 5→B1, 6→B2, 7→C1).
4. **Nội dung tôi viết có lỗi thật và test bắt được**: từ `undergo` nhưng ví dụ viết
   "underwent" → bài fill-in sẽ bỏ qua từ đó. Đã sửa thành "Many districts undergo rapid change."

**Kiểm chứng đã chạy (không phải mô phỏng):**

| Lệnh | Kết quả |
|---|---|
| `npm run typecheck` | pass (worker + client + node) |
| `npx vitest run` | **293 passed / 23 files** (baseline 285) |
| `npm run lint` | 0 errors, 16 warnings — **đúng bằng baseline** |
| `npm run build:client` | pass, 763.00 kB |
| `npm run schema:generate` | 44 tables, 60 indexes |
| `wrangler d1 … SELECT band, COUNT(*)` | 9 band × 4 bài × 24 từ = 36 bài, origin `BUILT_IN` |
| Gọi API thật (đăng nhập `student@demo.test`) | catalogue 9 band OK; lesson 6 từ + pool 18; lesson lạ → 404; complete → XP 19, stars 3, `wordsSaved=1` (từ giả bị bỏ qua); `PUT /band 6.5` → 200, `6.3` → 400; review trả `pool=24` |

### Phase 2 — Đa kỹ năng + Admin sinh bài bằng AI *(chưa làm)*

- 4 loại bài mới: paraphrase, mini Reading, câu Writing, mẫu Speaking.
- Mở rộng `Exercise` union + `LessonPlayer` cho từng loại.
- Màn Admin: chọn band → AI sinh lô 60 bài → xem trước/sửa → lưu D1 (`origin = ADMIN_AI`).
- Bài cá nhân: AI sinh từ lỗi trong `learn_lessons_done` + notebook (`origin = PERSONAL_AI`).
- Nâng số bài mỗi bậc lên 60 (540 bài toàn hệ).

### Phase 3 — Lộ trình cá nhân *(chưa làm)*

- Bảng `learn_plans` / `learn_plan_items`.
- Đầu vào: band mục tiêu + ngày thi + `estimated_band` theo từng skill.
- Nút **"Lập lại lộ trình"** (không tự đổi giữa chừng).
- Trang lộ trình + gắn vào dashboard.

### Điểm cắt nếu cần tách nhỏ hơn

Phase 1 là hạ tầng thuần (không đổi trải nghiệm học ngoài việc chọn band).
Phase 2 và 3 độc lập nhau sau khi Phase 1 xong.

## Kiến trúc chốt lại

1. **Nội dung**: bảng `learn_lessons` trong D1 (id, band 0.5, unit, title, kind, payload JSON 8
   mục, `origin` = `ADMIN_AI` / `PERSONAL_AI`, `status`, `created_by`, `created_at`).
2. **Sinh nội dung**: màn Admin mới — chọn band → AI sinh theo lô → xem trước/sửa → lưu D1.
   Prompt theo mẫu `coach-prompts.ts`. Rate limit + validate zod trước khi ghi.
3. **Phân phối**: API catalogue theo band, phân trang; client fetch thay vì import tĩnh.
4. **Bài cá nhân**: sinh từ notebook + từ sai trong `learn_lessons_done`, `origin = PERSONAL_AI`,
   chỉ user đó thấy.
5. **Lộ trình**: bảng `learn_plans` / `learn_plan_items`; đầu vào = band mục tiêu + ngày thi +
   `estimated_band` theo từng skill; người học bấm **"Lập lại lộ trình"** (không tự đổi).
6. **Thang band**: `LearnLevel` thành 4.0–8.0 bước 0.5; sửa `levelForBand()`, `LEARN_LEVELS`,
   `LEARN_LEVEL_LABELS`, `PUT /api/learn/level` (hiện là `z.number().int()`).
7. **Ship**: một PR duy nhất.

## Điểm tái sử dụng có sẵn (đỡ phải viết mới)

- Provider AI đã cấu hình được: `loadProviders()` / `completeJson()` trong
  `src/worker/ai/providers.ts`, admin quản lý ở `AdminAiProviders.tsx`.
- Kiểu prompt + bắt buộc JSON thuần: mẫu `buildVocabMessages()` trong
  `src/worker/ai/coach-prompts.ts` (có `TASK_KIND`, "Output ONLY one JSON object").
- Rate limit theo user: `enforceRateLimit()` — `routes/learn.ts` đang dùng cho `daily-words`.
- Trình độ theo skill: `attempt_skill_sessions.estimated_band` + `levelHintForUser()`;
  `estimates-service.ts` đã tách band theo READING/LISTENING/WRITING.
- Notebook + Leitner box (`vocabulary_entries.box`, `due_at`) làm nguồn cho "bài cá nhân từ lỗi".
- Tiền lệ Admin sinh nội dung bằng AI: `import-service.ts` + `AdminImports.tsx`.
- Engine đã nhận pool tuỳ chọn: `buildLesson(..., { pool })` trong `learn-engine.ts`.

## TRẠNG THÁI: CHỜ LỆNH

Spec đã chốt đủ. **Chưa viết dòng code nào.** Chờ chủ repo nói "làm đi" mới bắt đầu.
