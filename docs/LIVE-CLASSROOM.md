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

Class owners can edit the name and description and upload a class logo. Mentor class creation also accepts an optional logo. School and class logos are resized in the browser (original PNG, JPEG, or WebP up to 10 MB) and stored as a compressed image of at most 100 KB. Active teachers and platform admins can submit a school registration; mentors require an explicit registration grant, and students cannot register. A new school remains pending until an admin or a designated school-application reviewer approves it. The submitter becomes owner for that approved school only; this does not grant a platform-wide role. Only an admin can designate or revoke an active teacher or mentor as reviewer in Duyệt trường. Reviewers can list and decide applications but cannot grant permissions or use other admin functions, and neither admins nor reviewers can review their own registration. Existing school owners can invite existing teachers or create a teacher login and invite it; teachers must still accept the invitation. Send initial passwords through a secure channel.


The staff School Desktop is an OS-style full-page workspace with a Start menu, taskbar, draggable/snap-to-side windows, movable desktop shortcuts, pinned taskbar shortcuts, and folders of shortcuts (not file storage). Local personalization stays on the browser by default; the account-sync controls explicitly save/restore wallpaper, shortcut order, pinned items, folders and window positions to the user account. Unsaved contents of open app windows are not saved. School staff and invitations remain owner-only. Approved schools can use subject groups, school calendar and personal lesson plans: a teacher sends an immutable snapshot to their group, and the assigned leader or an authorized reviewer can approve or return it with a comment. A reviewer cannot review their own submission. Submitted plans and groups cannot be deleted, to preserve history. The school owner can delegate separate group-management, calendar-management or all-school review permissions to active staff; unassigned staff do not see the management tools and server authorization also enforces permissions. Delegated group managers cannot appoint themselves group leader. Removing a member clears their delegated permissions. Teachers, mentors and administrators use the desktop by default, while students retain the regular site. Desktop apps render in separate in-page windows with their own navigation history and back button, without iframes; notifications and teacher class management have dedicated desktop views. Other existing tools reuse their actual page components inside windows rather than being fully redesigned. Staff practice exams, results, calls and lesson players run inside desktop windows. Minimizing a call keeps it connected; closing the window asks for confirmation and sends a best-effort leave. Lesson progress is saved when completed, not when the window is closed. Students retain the regular full-screen exam, call and lesson interfaces. Browser/tab integrity monitoring does not detect switching between desktop windows; closing or minimizing an active exam does not pause its timer. Use the exam’s Save & exit control before closing, especially when connectivity is unreliable. The admin desktop exposes one Writing marking queue and hides Billing; existing billing data and backend remain intact. Role restrictions remain enforced by the API. Mentor classes do not yet have the teacher-class assignment/file system. **Digital signing is not implemented**: it needs a real signing provider and a verified integration; a review approval is not a digital signature. Students can open a classroom workspace with chat, shared files and their active assignments. When a teacher or mentor starts a class call, they choose whether to act personally or represent an approved school. The school logo is applied automatically for the school identity. Both identities refer to the same class room rather than creating a separate school-wide meeting; identity cannot be changed while people are present.

D1 migrations `0053`–`0057` add school groups/calendar, account desktop preferences, lesson workflow history, delegated school permissions and designated school-application reviewers. Runtime bootstrap contains the corresponding tables, but check the target database's migration history and schema before rollout; do not assume local preview data or migrations are production state.

The School Desktop opens as a full-page workspace. Staff can choose a built-in background or upload a compressed image, stored in the browser and scoped to their account; account synchronization is optional. Within an approved school, active staff can create, edit, search and delete their own lesson-plan drafts. Drafts are private to their author and unavailable after membership is removed.

### Thống kê trường và banner học viên

Sau migration `0058_school_reporting_banner.sql`, đại diện trường đã duyệt có thể liên kết thủ công lớp đang hoạt động của nhân sự đang hoạt động với tối đa một trường; không tự gán lớp cũ. Banner chỉ xuất hiện trên dashboard học viên đang hoạt động trong lớp liên kết, khi trường và banner còn hoạt động. Khi nhân sự chủ lớp rời trường, lớp không còn được tính cho trường hoặc hiển thị banner cho học viên. Đại diện có thể chỉnh nội dung, màu, ảnh raster nén và bật/tắt banner. Không dùng URL ảnh ngoài.

Admin và cán bộ duyệt do admin chỉ định xem được tổng hợp mọi trường, không có bài làm hoặc hồ sơ cá nhân học viên. Số liệu lớp và học viên chỉ bao gồm lớp đã liên kết; thống kê bài tập tính bài đang hoạt động hoặc đã đóng. Tỷ lệ hoàn thành tính số học viên hiện tại đã nộp/hết giờ trên số học viên hiện tại của từng bài; band trung bình lấy kết quả đã chấm gần nhất của mỗi học viên cho mỗi bài. Giáo viên và đồng giáo viên xem báo cáo theo lớp đang hoạt động mình phụ trách, không theo toàn trường. Trường hợp chưa có mẫu số hiển thị dấu gạch thay vì phần trăm.

Một lớp vẫn chỉ thuộc một trường. Nếu cùng một đại diện quản lý cả hai trường đã duyệt và giáo viên chủ lớp vẫn hoạt động tại trường đích, đại diện có thể chuyển trực tiếp lớp sang trường đích trong cửa sổ Banner học viên. Sau khi xác nhận, lớp không còn tính vào thống kê hoặc nhận banner qua trường cũ; server kiểm tra quyền cả hai trường và kiểm tra liên kết cũ chưa thay đổi. Nếu hai trường có đại diện khác nhau, đại diện trường cũ cần gỡ liên kết trước. Banner có thể tạo, cập nhật, tắt hoặc xóa; xóa sẽ ngừng hiển thị cho học viên.

### Tệp giáo án và điểm danh thủ công

Tạo và lưu giáo án trước, chọn giáo án rồi chọn **Tệp đính kèm** để tải lên, tải xuống hoặc gỡ file (tối đa 5 file đang dùng, mỗi file 500 KiB). Bản nháp và file chỉ tác giả còn là nhân sự trường được duyệt mới xem được. Khi gửi duyệt, danh sách file được chụp lại cùng bản gửi; gỡ file khỏi bản nháp không xóa file của bản đã gửi. Tác giả, đại diện trường, tổ trưởng phụ trách hoặc người có quyền duyệt toàn trường được tải các file của bản gửi. File tải về dưới dạng attachment, không nhúng trực tiếp. Migration 0059 lưu file trong D1, không dùng object storage; không coi đây là kho tài liệu dung lượng lớn.

Trong lớp của giáo viên có tab **Điểm danh** theo ngày: có mặt, vắng, đi muộn hoặc chưa đánh dấu. Chủ lớp, đồng giáo viên đang hoạt động và admin có quyền truy cập lớp theo chính sách hiện có; lớp lưu trữ chỉ xem lịch sử. Ghi nhận này độc lập với số liệu tham gia cuộc gọi và lưu dấu mốc theo ngày, không tự xác nhận học viên có mặt dựa trên cuộc gọi. Học viên đã rời lớp không thể sửa điểm danh, nhưng trạng thái đã ghi vẫn còn trong lịch sử. Mỗi lần lưu tối đa 500 học viên; danh sách ngày gần nhất hiển thị tối đa 180 ngày. Migration 0060 bổ sung bảng dữ liệu.

Tab **Bảng điểm** hiển thị trạng thái/điểm của lần nộp hoặc hết giờ gần nhất cho từng học viên đang hoạt động trên mỗi bài đang mở/đã đóng; tối đa 200 học viên và 100 bài gần nhất. Gợi ý cần hỗ trợ chỉ là tín hiệu khi vắng ít nhất hai ngày trong 30 ngày qua hoặc có ít nhất hai bài đã quá hạn mà chưa nộp, tính trên những bài được hiển thị và học viên hiện tại. Giáo viên cần xác minh trước khi đưa ra kết luận; đây không phải đánh giá tự động về năng lực.

### Teacher-private notes and seating

Private student notes are keyed to the author and class, and require class access. Other teachers and administrators do not see another author's notes through the application. Only current students are listed; removing a student or revoking class access hides existing notes until access is restored. Notes remain stored unless the author clears them, or the class, author or student is deleted. Archived classes are read-only. Do not store unnecessary sensitive information.

Seating is a shared ordered grid for active students (maximum 200). Teachers with class access can rearrange it; saved changes are last-write-wins. Archived classes are read-only. Students removed from the class are hidden, and stale positions are discarded on the next save.

### Class board

The class board allows an authorized teacher to post, pin and delete announcements, and open or close single-choice polls. Students in the class explicitly acknowledge announcements; the teacher sees only an aggregate count of currently active students, not a list of readers. Poll results are aggregate, but the service stores a student's choice by account so they can change it while the poll is open; this is not anonymous voting. Departed students are excluded from current counts and cannot use the board. Archived classes are read-only. Each list shows the most recent 100 entries.

Personal reusable Writing feedback templates are stored per teacher/admin account (maximum 50); they are inserted into draft feedback only when selected and do not themselves publish marks.

The personal question bank stores text questions, topic, skill and optional reference answer, visible only to the author through the teacher API. It is limited to 500 items and is not yet a test builder or directly assignable to students.
