# 50 tính năng nên thêm — Feature backlog

Đánh giá dựa trên những gì repo **đã có** (mentor + call/classroom, review-as-exam,
2 giám khảo AI + adjudication, learn path/shop/quests, vocabulary, plan có
`target_band` + ngày thi, leaderboard, search). Các mục dưới đây là **chưa có**
hoặc mới ở dạng sơ khai.

**Thang ước lượng**

| Nhãn | Nghĩa |
|---|---|
| ⚡ S | ≤ 1 ngày |
| 🔨 M | 2–5 ngày |
| 🏗 L | 1–2 tuần |
| ⭐ | Mức tác động: ⭐⭐ tốt · ⭐⭐⭐ rất đáng làm |

---

## A. Luyện thi & chấm điểm (1–12)

| # | Tính năng | Mô tả | Effort |
|---|---|---|---|
| 1 | **Error Bank** | Tự gom lỗi từ mọi bài Writing/Speaking đã chấm thành "sổ lỗi" + bài tập sửa đúng lỗi đó, ôn theo lịch quên | 🔨 |
| 2 | **Inline sentence diff** | Trong review Writing: highlight từng câu có vấn đề ngay trên bài, tooltip giải thích + câu viết lại | 🏗 |
| 3 | **Pronunciation coach** | Chấm theo âm vị/IPA: âm cuối, trọng âm, cặp /θ/–/ð/, so với mẫu | 🏗 |
| 4 | **Fluency metrics** | Speaking: WPM, tỉ lệ filler (um/ah), pause ratio, timeline fluency so với band mục tiêu | 🔨 |
| 5 | **Band predictor** | Dự báo band từ trend 4 kỹ năng; mô phỏng "nếu học X tuần thì nên đặt ngày thi nào" | 🔨 |
| 6 | **Question-type drills** | Luyện riêng từng dạng bài (T/F/NG, matching headings…) + blueprint đề lắp từ ngân hàng câu hỏi theo ma trận độ khó | 🏗 |
| 7 | **Adaptive practice + SRS** | Chọn câu tiếp theo theo lỗi hay gặp; flashcard từ vựng lặp lại ngắt quãng | 🏗 |
| 8 | **Compare attempts** | So 2 lần làm cùng đề: điểm, lỗi, tốc độ, câu nào tiến bộ/lùi | 🔨 |
| 9 | **Time analytics** | Câu nào ngốn thời gian nhất, phân bổ thời gian thực tế vs lý tưởng | 🔨 |
| 10 | **Dictation & shadowing** | Nghe–chép và nhại theo audio lesson, chấm độ chính xác từng từ | 🔨 |
| 11 | **Mock có giám sát** | Auto-submit, cảnh báo 5 phút, phát hiện đổi tab/rời trang (anti-cheat nhẹ) | 🔨 |
| 12 | **Detector bài giống nhau** | Teacher thấy bài nộp trùng nhau hoặc "giọng AI" trước khi chấm | 🔨 |

## B. Mentor, lớp học & giảng dạy (13–24)

| # | Tính năng | Mô tả | Effort |
|---|---|---|---|
| 13 | **Assignment trong lớp** | Giao writing/speaking cho lớp, deadline, chấm hàng loạt, trả feedback 1 lần cho cả lớp | 🏗 |
| 14 | **Gradebook** | Bảng điểm học viên × bài, export CSV, radar band theo 4 kỹ năng | 🔨 |
| 15 | **Attendance** | Điểm danh buổi live + báo cáo chuyên cần theo tuần | ⚡ |
| 16 | **Recording buổi học** | Lưu recording call + transcript + bookmark, xem lại trong lớp | 🏗 |
| 17 | **Breakout rooms** | Chia nhóm nhỏ trong call để luyện speaking theo cặp | 🏗 |
| 18 | **Whiteboard trong call** | Vẽ/đánh dấu + kéo ảnh (chữa Writing Task 1 chart ngay trên màn hình) | 🏗 |
| 19 | **Live quiz / poll** | Câu hỏi nhanh trong lớp kiểu Kahoot, hiện bảng điểm tức thì | 🔨 |
| 20 | **Availability & auto-booking** | Mentor khai lịch rảnh; học viên đặt slot tự động (timezone, buffer, lặp lại) | 🏗 |
| 21 | **Weekly digest** | Email/in-app tổng kết tuần cho học viên, mentor, phụ huynh | 🔨 |
| 22 | **Class library** | Kho tài liệu/đề/video của lớp, gán vào lộ trình, tái dùng giữa các lớp | 🔨 |
| 23 | **Mentor matching** | Gợi ý mentor theo mục tiêu band, lịch rảnh, phong cách + buổi thử | 🔨 |
| 24 | **Earnings & invoice** | Mentor xem thu nhập theo buổi, xuất hoá đơn, trạng thái payout | 🔨 |

## C. Tài khoản, vận hành & thanh toán (25–33)

| # | Tính năng | Mô tả | Effort |
|---|---|---|---|
| 25 | **Email notifications** | Kết quả chấm xong, deadline, mentor xác nhận/huỷ buổi học (Resend hoặc SES) | 🔨 |
| 26 | **Magic link + reset password** | Đăng nhập bằng link email, quên mật khẩu tự phục vụ | 🔨 |
| 27 | **2FA TOTP** | Authenticator app bên cạnh OTP email hiện có | 🔨 |
| 28 | **Notification center** | Chuông in-app, badge, đánh dấu đã đọc, gom theo loại | 🔨 |
| 29 | **PWA + web push** | Cài như app, push nhắc lịch học/deadline (chưa có manifest/SW) | 🔨 |
| 30 | **i18n VI/EN** | Toàn bộ UI + nội dung song ngữ | 🏗 |
| 31 | **Subscription & payment** | Gói Pro, mua khoá học: Stripe + VNPay/MoMo | 🏗 |
| 32 | **Referral & coupon** | Mã giảm giá, giới thiệu bạn, credit học phí | 🔨 |
| 33 | **Audit log admin** | Ghi lại ai sửa gì (đề, user, điểm) + hoàn tác | 🔨 |

## D. AI & nội dung (34–42)

| # | Tính năng | Mô tả | Effort |
|---|---|---|---|
| 34 | **AI tutor 24/7** | Chat giải thích câu sai, luyện theo band; RAG nhẹ từ lesson + đáp án (dùng Ollama sẵn có) | 🏗 |
| 35 | **AI speaking partner** | Hội thoại theo lượt theo chủ đề, feedback từng lượt, tổng kết cuối | 🏗 |
| 36 | **AI generate đề** | Sinh passage + câu hỏi theo band, admin duyệt trước khi publish | 🏗 |
| 37 | **OCR import đề** | Upload PDF/ảnh → tự tách sections/câu hỏi, review trước khi lưu | 🏗 |
| 38 | **Word-level transcript** | Timestamp từng từ cho listening: "listen from here" chính xác + tra từ tại chỗ | 🏗 |
| 39 | **TTS nhiều giọng** | Sinh audio UK/AU/US từ transcript, cache sẵn (`speech_cache` đã có) | 🔨 |
| 40 | **Vocab auto-extract** | Từ khó trong Reading/Listening tự vào deck SRS cá nhân | 🔨 |
| 41 | **Quick-mark rubric** | Mentor chấm bằng tag nhận xét có sẵn, AI điền trước bản nháp feedback | 🔨 |
| 42 | **Weekly action plan** | Tự tóm tắt "3 việc cần làm tuần này" từ các bài đã chấm | ⚡ |

## E. Xã hội & giữ chân (43–50)

| # | Tính năng | Mô tả | Effort |
|---|---|---|---|
| 43 | **Study buddy / group** | Ghép cặp theo band + mục tiêu, thử thách luyện đề cùng nhau | 🔨 |
| 44 | **Leaderboard theo lớp** | Bảng xếp hạng lớp/trường/khu vực + mùa giải | 🔨 |
| 45 | **Certificate PDF** | Chứng nhận khi đạt band mục tiêu + share card | ⚡ |
| 46 | **Season pass** | Streak insurance, quest mở rộng, phần thưởng theo mùa | 🔨 |
| 47 | **Peer review writing** | Học viên chấm chéo theo rubric, mentor duyệt kết quả | 🔨 |
| 48 | **Review mentor** | Đánh giá + testimonial sau buổi học, hiện trên profile công khai | ⚡ |
| 49 | **Smart plan rebalance** | Plan tự điều chỉnh khi trượt lịch + đếm ngược ngày thi, nhắc mốc | 🔨 |
| 50 | **Virtual study room** | Phòng học chung pomodoro + presence, thấy ai đang học | 🔨 |

---

## Thứ tự nên làm (top 10)

| # | Tính năng | Vì sao trước |
|---|---|---|
| 1 | 13 — Assignment lớp | Giá trị mentor cao nhất; biến lớp học thành nơi giao–chấm–trả bài thật |
| 2 | 14 — Gradebook | Đi kèm #13, mentor cần nhìn tiến bộ cả lớp trong 1 bảng |
| 3 | 25 — Email notifications | Vòng giữ chân: chấm xong → email → quay lại; cũng là nền cho #26 |
| 4 | 1 — Error Bank | Biến mỗi bài chấm thành bài học; dùng lại dữ liệu judge đã có |
| 5 | 34 — AI tutor | Ollama + lesson đã sẵn, chi phí thấp, khác biệt rõ |
| 6 | 26 — Magic link | Bỏ ma sát đăng nhập/ quên mật khẩu |
| 7 | 37 — OCR import | Tiết kiệm hàng giờ nhập đề mỗi tuần |
| 8 | 28 — Notification center | Cần trước khi bật #29 push |
| 9 | 2 — Inline sentence diff | Nâng chất review Writing lên mức "gia sư thật" |
| 10 | 29 — PWA + push | Học viên Việt Nam dùng điện thoại là chính |

### 3 sprint gợi ý

- **Sprint 1 — Mentor loop:** 13 → 14 → 41 → 25 → 28 → 26
- **Sprint 2 — Practice loop:** 1 → 2 → 8 → 9 → 42 → 34
- **Sprint 3 — Growth:** 31 → 32 → 43 → 44 → 45 → 29

> Tận dụng hạ tầng sẵn có: `speech_cache` (#39), `asset_blobs`/R2 (#37, #18),
> judge pipeline + `ai_judgements` (#1, #2, #41), WebRTC room (#16–19),
> `learn_plans.target_band` (#5, #49), presence + friendships (#43, #50).
