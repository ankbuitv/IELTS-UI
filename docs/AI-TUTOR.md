# AI Tutor, kế hoạch tuần và chấm nhanh

Ba tính năng của đợt 3 dùng chung một nguyên tắc: **không bịa điểm**. Bài thi được
chấm bởi judge pipeline; tutor chỉ giải thích, sửa câu và gợi ý bước tiếp theo.

## AI Tutor (`/tutor`)

- Mỗi học viên có nhiều cuộc trò chuyện (`tutor_conversations`), mỗi cuộc có
  `focusSkill` (Writing/Speaking/Reading/Listening/Vocabulary) và tin nhắn
  (`tutor_messages`).
- API (đều yêu cầu đăng nhập + CSRF cho thao tác ghi):

  | Method | Path | Việc |
  |---|---|---|
  | GET | `/api/student/tutor` | Danh sách cuộc trò chuyện + preview |
  | POST | `/api/student/tutor` | Tạo cuộc mới (`focusSkill`) |
  | GET | `/api/student/tutor/:id` | Toàn bộ tin nhắn |
  | POST | `/api/student/tutor/:id/messages` | Gửi câu hỏi, trả về thread đã có câu trả lời |
  | DELETE | `/api/student/tutor/:id` | Xoá cuộc trò chuyện |

- Giới hạn: 4.000 ký tự/tin, 60 tin/giờ/người dùng (`rate_limit_counters`).
- Prompt hệ thống: trả lời ngắn (dưới 180 từ), sửa câu kèm lý do, luôn kết thúc
  bằng **một** bước tiếp theo; viết tiếng Việt khi học viên viết tiếng Việt; không
  viết hộ cả bài, không nhận là IELTS/BC/IDP/Cambridge, không tự cho band.
- Ngữ cảnh gửi kèm: band trung bình 30 ngày qua và số từ đang đến hạn ôn.
- Khi chưa cấu hình AI provider, API trả `AI_UNAVAILABLE` với thông báo chỉ rõ
  cần bật provider ở Admin → Settings → AI providers. Tin nhắn của học viên vẫn
  được lưu.
- Nếu provider lỗi giữa chừng, UI giữ câu hỏi, hiện lỗi và tải lại thread.

> Cần một AI provider đã bật trong Admin → Settings → AI providers. Không cần
> biến môi trường mới.

## Kế hoạch tuần (`weekly_action_plans`)

- Một bản/người/tuần (thứ Hai, UTC). Bản được lưu nên checkbox không mất khi tải
  lại, và tuần đã qua không tự đổi dưới chân học viên.
- Nguồn dữ liệu: điểm theo tiêu chí của Writing/Speaking 60 ngày gần nhất, số từ
  đến hạn, số bài đã nộp. Không gọi model.
- Ba việc, theo thứ tự: tiêu chí yếu nhất → từ vựng đến hạn → ôn lỗi; thiếu dữ
  liệu thì dùng kế hoạch khởi động (chẩn đoán, nói 60 giây, một lesson).
- API: `GET /api/student/action-plan`, `POST /api/student/action-plan/refresh`,
  `PATCH /api/student/action-plan/tasks/:taskId` `{ done }`.
- Thẻ hiển thị ngay dưới hero của dashboard.

## Chấm nhanh Writing

- Trong form chấm của giáo viên/admin: 10 nút nhận xét một chạm (vị trí, overview,
  linking, articles, word count…) chèn vào feedback.
- **Lấy bản nháp**: đọc `ai_scores` mới nhất (hai judge) qua
  `GET /api/teacher|admin/writing-submissions/:id/ai-draft`, hiện band + điểm
  từng tiêu chí; bấm **Dùng bản nháp** để điền form. Giáo viên vẫn phải bấm lưu,
  và band giáo viên thay thế band AI như trước.
- Không có bản nháp (chưa chấm AI) thì nút báo rõ, không chặn việc chấm tay.
