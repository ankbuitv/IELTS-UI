# Lớp học trực tiếp — công cụ trong phòng call

Bốn công cụ mới nằm ngay trong phòng học (`/sessions/:id/room`), dùng chung
WebSocket-free stack hiện có: D1 + polling 1,5 giây cho presence và WebRTC
signalling. Không cần dịch vụ realtime mới.

## Quiz & poll (`#19`)

- Mentor bấm **Quiz** trên thanh công cụ → soạn câu hỏi, 2–4 đáp án, chọn đáp án
  đúng (hoặc chuyển sang *Poll* nếu không có đáp án đúng).
- Mọi người thấy câu hỏi trong 3 giây; chọn đáp án một lần, được đổi ý khi câu
  hỏi còn mở.
- Số phiếu và thanh tỉ lệ cập nhật trực tiếp. **Đáp án đúng chỉ lộ sau khi mentor
  bấm “Close question”** — trước đó API trả `correctIndex: null` cho học viên.
- Lịch sử 3 câu gần nhất vẫn xem lại được trong panel.

API: `GET/POST /api/mentor/sessions/:id/polls`,
`POST .../polls/:pollId/answer`, `POST .../polls/:pollId/close`.

## Breakout rooms (`#17`)

- Mentor mở **More → Breakout rooms**, chọn 2–4 phòng và 5–30 phút.
- Hệ thống chia đều những người đang ở phòng chính (trừ mentor), mỗi người nhận
  một phòng; học viên thấy banner **Join** trong 6 giây.
- Mỗi phòng là một cuộc gọi riêng: presence, chat, reactions và bảng trắng đều
  theo `room_key`, không lẫn với phòng chính. Signalling cũng lọc theo phòng nên
  SDP/ICE không bao giờ vượt phòng.
- Mentor vào được bất kỳ phòng nào; học viên chỉ vào phòng được phân.
- Hết giờ (hoặc mentor bấm **Close all**), mọi người tự quay về phòng chính.
- Vào phòng khác = tải lại trang với `?room=breakout-n` (đổi hẳn mesh WebRTC,
  tránh rò track giữa hai phòng).

API: `GET/POST /api/mentor/sessions/:id/breakouts`,
`POST .../breakouts/close`.

## Whiteboard (`#18`)

- Bảng trắng dùng chung, vẽ bằng chuột/cảm ứng, 5 màu, 3 nét.
- Toạ độ chuẩn hoá 0–1 nên mọi màn hình thấy cùng một hình.
- Mentor có **Clear**; học viên chỉ vẽ/undo. Bảng lưu 1 dòng/phòng, có
  `revision`; xung đột thì client nhận bản mới nhất thay vì ghi đè mù.
- Đồng bộ 3 giây/lần khi panel mở; nét đang vẽ không bị bản remote cắt ngang.

API: `GET/PUT /api/mentor/sessions/:id/whiteboard?room=` (body gồm `revision`,
`strokes`).

## Weekly digest (`#21`)

- Mỗi thứ Hai 08:00 giờ Việt Nam (01:00 UTC), cron `0 1 * * 1` tổng hợp tuần:
  số phần đã luyện, band trung bình + so với tuần trước, band từng kỹ năng, buổi
  học trực tiếp đã tham gia, streak, coin kiếm được, 3 buổi sắp tới.
- Gửi **email** (Resend nếu có `RESEND_API_KEY`, không thì nằm trong
  `email_outbox` trạng thái QUEUED) + **thông báo trong app**.
- Chống gửi trùng bằng bảng `user_digests (user_id, week_key)`; chạy lại cron
  hay chạy tay đều an toàn.
- Chạy tay để thử: `POST /api/admin/digest/run`
  (`{ "dryRun": true }`, `{ "userId": "usr_…" }`, `{ "weekOf": "2026-10-19T00:00:00.000Z" }`).
- Người không có hoạt động trong tuần bị bỏ qua (trừ khi chỉ định `userId`).

## Earnings & invoice (`#24`)

- `/mentor/earnings`: tổng coin đã kiếm, số buổi hoàn thành, giờ dạy, coin đang
  chờ; lọc 30 ngày / tháng / năm / tất cả.
- Bảng theo tháng + bảng từng buổi (học viên, chủ đề, phút, coin, trạng thái).
- **Export CSV** (UTF-8 BOM, mở đúng trong Excel) và **Invoice** in A4 trong cửa
  sổ mới (Save as PDF của trình duyệt).
- Số hoá đơn: `INV-YYYYMM-XXXXX`, lấy từ buổi học thật (thời lượng + coin đã
  trả), không phải số tự sinh rời rạc.

API: `GET /api/mentor/me/earnings?from=&to=`,
`GET /api/mentor/me/earnings/:sessionId/invoice`.

## Phòng ban / quyền

| Hành động | Mentor (host) | Học viên | Admin |
|---|---|---|---|
| Tạo/đóng poll | ✅ | xem + trả lời | ✅ |
| Mở/đóng breakout | ✅ | vào phòng được phân | ✅ |
| Xoá bảng trắng | ✅ | chỉ vẽ/undo | ✅ |
| Xem thu nhập | ✅ | — | ✅ (theo mentor id) |

`ADMIN` được coi là host trong phòng để hỗ trợ lớp đang diễn ra.

## Đã sửa kèm

- **Câu trả lời bị báo thiếu oan**: đếm theo `question.id` thay vì số câu (bài
  import có thể đánh số lại từng phần) và liệt kê đúng số câu còn trống, bấm
  là nhảy tới. DOM id cũng dùng question id nên không còn trùng `#q-1`.
- **Đặt lịch hiện “SCHEDULED” thay vì “REQUESTED”**: trạng thái chờ mentor xác
  nhận giờ nằm ở cột `confirmation`, UI đã hiển thị đúng “Awaiting mentor”.
- **Signal REACTION/MUTE_MIC/KICK bị SQLite từ chối**: CHECK cũ chỉ cho 4 loại
  SDP; migration 0033 mở rộng và thêm `room_key`.

Class owners can edit the name and description and upload a class logo. Mentor class creation also accepts an optional logo. School and class logos are resized in the browser (original PNG, JPEG, or WebP up to 10 MB) and stored as a compressed image of at most 100 KB. Only staff accounts explicitly granted the school-manager capability by a platform admin may register a school; approval is still required. The capability is separate from the existing account role and cannot be granted to students. In Admin → Trường học, grant it to an existing active teacher, mentor or admin (create a staff account first if needed). Revocation removes the ability to register new schools; existing owners retain control of their existing schools. Approved school owners can invite existing teachers or create a teacher login and invite it; teachers must still accept the invitation. Send initial passwords through a secure channel.


The staff School Desktop is an OS-style full-page workspace with a Start menu, taskbar, draggable/snap-to-side windows, movable desktop shortcuts, pinned taskbar shortcuts, and folders of shortcuts (not file storage). Local personalization stays on the browser by default; the account-sync controls explicitly save/restore wallpaper, shortcut order, pinned items, folders and window positions to the user account. Unsaved contents of open app windows are not saved. School staff and invitations remain owner-only. Approved schools can use subject groups, school calendar and personal lesson plans: a teacher sends an immutable snapshot to their group, and the assigned leader or an authorized reviewer can approve or return it with a comment. A reviewer cannot review their own submission. Submitted plans and groups cannot be deleted, to preserve history. The school owner can delegate separate group-management, calendar-management or all-school review permissions to active staff; unassigned staff do not see the management tools and server authorization also enforces permissions. Delegated group managers cannot appoint themselves group leader. Removing a member clears their delegated permissions. Teachers, mentors and administrators use the desktop by default, while students retain the regular site. Desktop apps render in separate in-page windows with their own navigation history and back button, without iframes; notifications and teacher class management have dedicated desktop views. Other existing tools reuse their actual page components inside windows rather than being fully redesigned. Calls, exam-taking and lesson playback remain full-screen. Role restrictions remain enforced by the API. Mentor classes do not yet have the teacher-class assignment/file system. **Digital signing is not implemented**: it needs a real signing provider and a verified integration; a review approval is not a digital signature. Students can open a classroom workspace with chat, shared files and their active assignments. When a teacher or mentor starts a class call, they choose whether to act personally or represent an approved school. The school logo is applied automatically for the school identity. Both identities refer to the same class room rather than creating a separate school-wide meeting; identity cannot be changed while people are present.

D1 migrations `0053`–`0056` add school groups/calendar, account desktop preferences, lesson workflow history and delegated permissions. Runtime bootstrap contains the corresponding tables, but check the target database's migration history and schema before rollout; do not assume local preview data or migrations are production state.

The School Desktop opens as a full-page workspace. Staff can pick a built-in background or upload a compressed image, stored only in that browser and scoped to the signed-in account; it is not synced between devices. Within an approved school, active staff can create, edit, search and delete their own lesson-plan drafts. Plans are private to their author and unavailable after membership is removed; there is no submission, review, recovery, or digital-signature workflow yet. Subject-group and digital-signature management remain unimplemented.
