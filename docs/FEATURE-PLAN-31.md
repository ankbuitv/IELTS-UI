# Kế hoạch 31 tính năng đã chọn

Danh sách bạn chọn: **3, 2, 5, 4, 6, 9, 10, 11, 26, 27, 28, 31, 21, 19, 17, 18,
24, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 50**.

31 tính năng này không thể làm hết trong một lần mà vẫn giữ chất lượng, nên mình
chia thành **5 đợt** theo phụ thuộc kỹ thuật. Thứ tự trong mỗi đợt vẫn theo ưu
tiên bạn đưa ra, chỉ kéo vài mục lên trước vì chúng là nền cho mục khác
(ví dụ email phải có trước digest và magic link).

Mỗi đợt kết thúc bằng: lint 0 lỗi · typecheck sạch · test xanh · build ✓ ·
smoke API · commit + push lên nhánh này.

---

## Đợt 1 — Nền tảng tài khoản & thông báo ✅ `4b2582c`

| # | Tính năng | Trạng thái |
|---|---|---|
| 28 | **Notification centre** — chuông + `/notifications`, badge, mark read, broadcast admin | ✅ |
| 26 | **Magic link + reset password** — email outbox (Resend), link dùng 1 lần, OTP thật sự được gửi | ✅ |
| 27 | **2FA TOTP** — đã có sẵn; bổ sung **backup codes** (8 mã, hiện 1 lần, dùng thay mã OTP) | ✅ |
| 45 | **Certificate PDF** — `/certificate/:attemptId`, in A4 ngang, nút từ màn review | ✅ |

Kèm theo: `docs/EMAIL-SETUP.md`, tab **Admin → Announcements** (soạn thông báo +
nhật ký email).

---

## Đợt 2 — Lớp học trực tiếp (mentor) ✅

| # | Tính năng | Trạng thái |
|---|---|---|
| 21 | **Weekly digest** | ✅ cron thứ Hai 08:00 VN + email + notification, chống trùng theo tuần, chạy tay qua `/api/admin/digest/run` |
| 19 | **Live quiz/poll** | ✅ bảng `class_polls`/`class_poll_answers`, đồng bộ 3 giây, đáp án đúng chỉ lộ khi đóng câu |
| 17 | **Breakout rooms** | ✅ `room_key` tách presence/chat/signalling/board, chia phòng tự động, hẹn giờ, tự quay về |
| 18 | **Whiteboard trong call** | ✅ canvas toạ độ chuẩn hoá, 5 màu/3 nét, undo, revision chống ghi đè |
| 24 | **Earnings & invoice** | ✅ `/mentor/earnings`, lọc thời gian, CSV, invoice A4 in được |

Kèm theo: sửa **câu báo thiếu oan** (đếm theo question id + liệt kê câu trống),
**booking hiện đúng chờ xác nhận**, mở rộng CHECK của `mentor_signals` (reaction
và mute/kick trước đây bị SQLite từ chối), chat tách theo phòng. Chi tiết:
`docs/LIVE-CLASSROOM.md`. Migration `0033`, `0034`.

## Đợt 2.5 — Sửa UI phòng call + trang review ✅

| Việc | Kết quả |
|---|---|
| Tile người khác hiện ngay khi vào phòng | presence mang `camOn`/`micOn`; tile + tên + avatar + "Camera off" không đợi WebRTC |
| Video remote đen dù camera sáng | gắn lại `srcObject` + `play()` khi track đầu tiên tới (lỗi chính) |
| Self view / filmstrip | to stage khi ở một mình, thu nhỏ góc phải dưới khi có người; avatar thay ô đen |
| Gợi ý "Waiting…" đè toolbar | stage `min-height:0` + `overflow:hidden`, gợi ý nằm trong stage |
| Điện thoại | tiêu đề 2 dòng, không tile đen, không ô trống, toolbar cuộn ngang |
| Đồng hồ 1391:00 | đếm từ lúc **bạn** vào phòng, `MM:SS` (qua 1 giờ `H:MM:SS`) |
| Chat GIF/link | render ảnh `.gif/.png/.jpg/.webp` inline, link bấm được |
| Grid tiêu chí review | đúng **2 box/dòng**, box cao bằng nhau, nhãn không bị bóp |
| Nhãn lạ dưới band | bỏ caption trùng "Consensus", chỉ còn "Band" + tab |

Migration `0035` (cam_on/mic_on). Chi tiết: `docs/CALL-ROOM.md`.

## Đợt 3 — AI & nội dung ✅

| # | Tính năng | Trạng thái |
|---|---|---|
| 41 | **Quick-mark rubric** | ✅ 10 nhận xét một chạm + nút **Lấy bản nháp** (đọc `ai_scores`, điền band/criteria/feedback, giáo viên sửa trước khi lưu). Endpoint `GET /api/{teacher,admin}/writing-submissions/:id/ai-draft` |
| 42 | **Weekly action plan** | ✅ bảng `weekly_action_plans`, 3 việc/tuần, tiêu chí yếu nhất từ điểm Writing/Speaking, từ đến hạn, ôn lỗi; checkbox lưu trạng thái; thẻ trên dashboard |
| 34 | **AI tutor** | ✅ `/tutor`, `tutor_conversations`/`tutor_messages`, system prompt chống bịa band, giới hạn 60 tin/giờ, giao diện 2 cột + mobile |
| 40 | **Vocab auto-extract + SRS** | ✅ đã có từ trước: `saveAiVocabulary` khi chấm, Leitner `box`/`due_at`, `/learn/review`, thẻ due trên Vocabulary |
| 39 | **TTS nhiều giọng** | ✅ accent **UK / AU / US** trong lesson: server gửi `instructions` theo accent và cache theo `voice:accent:hash`; giọng thiết bị được chọn theo language tag; lựa chọn lưu trên máy |
| 38 | **Word-level transcript** | ✅ `src/shared/transcript-timing.ts` chia từ theo anchor + độ dài audio; click từ → menu "Play from here"/tra từ; "Listen from here" nhảy đúng câu evidence (`findEvidenceStart`), 7 test |
| 37 | **OCR import đề** | ✅ tab **Scan or photo (OCR)**: tối đa 8 ảnh PNG/JPEG/WebP ≤8 MB, vision model đọc + cấu trúc, vào **Review**, audit `IMPORT_OCR` (`POST /api/admin/imports/ocr`) |
| 36 | **AI generate đề** | ✅ Reading 1–3 bài, 5–14 câu/bài, chọn band; prompt chống đạo văn; vào thẳng **Review** (`POST /api/admin/imports/generate`), audit `IMPORT_AI_GENERATED` |
| 35 | **AI speaking partner** | ✅ `/speaking/partner`: 9 chủ đề Part 1–3, hỏi từng câu, coaching sau mỗi câu trả lời, dictation bằng Web Speech API, tổng kết cuối; AI lỗi/không có provider → chấm theo luật (`RULES`) chứ không chặn |

## Đợt 4 — Luyện thi nâng cao ✅ `d8d03a3` · `be54701` · `f6cde90`

| # | Tính năng | Ghi chú |
|---|---|---|
| 2 | **Inline sentence diff** | Dựa trên corrections của judge + diff theo câu |
| 5 | **Band predictor** | Hồi quy đơn giản trên lịch sử band, mô phỏng ngày thi |
| 9 | **Time analytics** | Đã có `attempt_events`/thời gian từng câu — chỉ cần tổng hợp |
| 10 | **Dictation & shadowing** | `/lab/dictation`: nghe từng câu, gõ lại, diff theo từ (LCS), đổi accent UK/AU/US, shadowing |
| 11 | **Mock có giám sát** | `integrity` đã có; thêm auto-submit + cảnh báo 5 phút |
| 6 | **Question-type drills** | Gắn tag dạng bài cho ngân hàng câu hỏi + blueprint |
| 4 | **Fluency metrics** | WPM/filler từ transcript speaking đã lưu |
| 3 | **Pronunciation coach** | ✅ V1 `/lab/pronunciation`: IPA + trọng âm từ điển, shadowing chấm theo từ nghe được; phoneme-level để sau khi có model audio |

## Đợt 5 — Thanh toán & xã hội ✅

| # | Tính năng | Ghi chú |
|---|---|---|
| 31 | **Subscription/payment** | ✅ `/pricing`: Pro tháng/năm, Stripe Checkout (cần key), chuyển khoản + admin xác nhận (đường VNPay/MoMo khi chưa có merchant), demo local |
| 44 | **Leaderboard theo lớp + mùa giải** | ✅ tab **Class** (theo classroom) + cửa sổ **Season** 8 tuần |
| 43 | **Study buddy/group** | ✅ `/study-groups`: nhóm tối đa 12, bảng XP tuần, gợi ý bạn/classmate/cùng target band |
| 46 | **Season pass** | ✅ `/season`: 5 mốc XP, thưởng coin + item, claim idempotent |
| 50 | **Virtual study room** | ✅ `/study-room`: pomodoro chung do server giữ, heartbeat presence, phút focus theo ngày |

---

## Ước lượng

| Đợt | Nội dung | Thời lượng code |
|---|---|---|
| 1 | Nền tảng tài khoản | ✅ xong |
| 2 | Lớp học trực tiếp | ~1.5–2 tuần |
| 3 | AI & nội dung | ~2–2.5 tuần |
| 4 | Luyện thi nâng cao | ~2 tuần |
| 5 | Thanh toán & xã hội | ~1.5–2 tuần |

> **Cả 5 đợt đã xong.** 31/31 tính năng đã có code chạy được; phần cần tài khoản
> bên ngoài (Stripe/VNPay/MoMo) đã có đường thủ công để dùng ngay: tạo đơn chuyển
> khoản, admin xác nhận. Xem `docs/BILLING.md` để bật Stripe.

### Ghi chú sau đợt 4–5

- **#3 pronunciation** là V1: chấm theo transcript + IPA/trọng âm từ điển, không chấm phoneme.
- **#31** chỉ thu tiền thật khi có `STRIPE_SECRET_KEY`; nếu không, dùng BANK + admin duyệt.
- Giới hạn Pro đang áp dụng: 3 phiên AI speaking partner/ngày và 5 drills/ngày cho tài khoản free.
- **#2** diff theo câu dùng lại `corrections` của judge; **#5** dự phóng band có damping;
  **#9** thống kê thời gian theo section/câu từ snapshot attempt.

