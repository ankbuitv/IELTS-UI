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

## Đợt 3 — AI & nội dung

| # | Tính năng | Ghi chú |
|---|---|---|
| 41 | **Quick-mark rubric** | Tag nhận xét có sẵn + AI điền nháp, lưu vào `writing_scores.feedback` |
| 42 | **Weekly action plan** | Tổng hợp lỗi từ `ai_judgements` + review, 3 việc/tuần, hiện trên dashboard |
| 34 | **AI tutor** | Chat dùng Ollama sẵn có, RAG nhẹ từ lesson + đáp án |
| 40 | **Vocab auto-extract + SRS** | Bảng `vocab_reviews`, lịch SM-2; nối trang Vocabulary |
| 39 | **TTS nhiều giọng** | `speech_cache` + provider TTS; chọn UK/AU/US |
| 38 | **Word-level transcript** | Lưu timestamp từng từ khi import; "listen from here" chính xác |
| 37 | **OCR import đề** | Nối pipeline `import-service` + vision model đã có |
| 36 | **AI generate đề** | Sinh passage/câu hỏi theo band, bắt buộc admin duyệt |
| 35 | **AI speaking partner** | Hội thoại theo lượt, chấm bằng judge pipeline hiện tại |

## Đợt 4 — Luyện thi nâng cao

| # | Tính năng | Ghi chú |
|---|---|---|
| 2 | **Inline sentence diff** | Dựa trên corrections của judge + diff theo câu |
| 5 | **Band predictor** | Hồi quy đơn giản trên lịch sử band, mô phỏng ngày thi |
| 9 | **Time analytics** | Đã có `attempt_events`/thời gian từng câu — chỉ cần tổng hợp |
| 10 | **Dictation & shadowing** | Audio lesson + transcript; chấm theo từ |
| 11 | **Mock có giám sát** | `integrity` đã có; thêm auto-submit + cảnh báo 5 phút |
| 6 | **Question-type drills** | Gắn tag dạng bài cho ngân hàng câu hỏi + blueprint |
| 4 | **Fluency metrics** | WPM/filler từ transcript speaking đã lưu |
| 3 | **Pronunciation coach** | ⚠️ Cần model audio (forced alignment). V1: chấm theo transcript + IPA/trọng âm từ điển, shadowing với TTS; phoneme-level để sau khi chọn provider |

## Đợt 5 — Thanh toán & xã hội

| # | Tính năng | Ghi chú |
|---|---|---|
| 31 | **Subscription/payment** | Stripe + VNPay/MoMo, gói Pro; cần tài khoản merchant của bạn |
| 44 | **Leaderboard theo lớp + mùa giải** | Có `learn_leaderboard`; thêm scope lớp và season |
| 43 | **Study buddy/group** | Dựa trên `friendships` + presence sẵn có |
| 46 | **Season pass** | Mở rộng shop/quest hiện tại |
| 50 | **Virtual study room** | Presence + pomodoro; tái dùng room state |

---

## Ước lượng

| Đợt | Nội dung | Thời lượng code |
|---|---|---|
| 1 | Nền tảng tài khoản | ✅ xong |
| 2 | Lớp học trực tiếp | ~1.5–2 tuần |
| 3 | AI & nội dung | ~2–2.5 tuần |
| 4 | Luyện thi nâng cao | ~2 tuần |
| 5 | Thanh toán & xã hội | ~1.5–2 tuần |

> **Đợt 2 là đợt tiếp theo.** Muốn đổi thứ tự (ví dụ nhảy sang đợt 3 vì AI
> tutor đang hot), chỉ cần nói — kiến trúc không bị phụ thuộc.
