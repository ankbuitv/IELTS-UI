# Phòng học trực tuyến (Jitsi-style)

Phòng call nằm ngoài app shell tại `/sessions/:sessionId/room` và dùng giao diện
tối kiểu Jitsi Meet: stage lớn, tile bo góc, thanh điều khiển giữa dưới, chat bên
trái, danh sách người tham gia bên phải.

## Màn hình chờ (prejoin)

- Xem trước camera, tên hiển thị, tên buổi học và giờ bắt đầu.
- Bật/tắt mic, camera, mở **Settings** để chọn đúng camera/microphone.
- Dòng trạng thái: **Your devices are working properly** (chấm xanh) hoặc mô tả
  đúng lỗi (chấm vàng).
- Nút **Join meeting**; vẫn vào được bằng chat nếu không có thiết bị.

## Trong phòng

| Nút | Chức năng |
|---|---|
| Mic / Camera | Bật tắt track thật (peers thấy ngay) |
| Share | Chia sẻ màn hình; tự quay lại camera khi dừng |
| Chat | Bảng Chat / Notes / People bên trái |
| Raise | Giơ tay, mọi người thấy chip ✋ |
| People | Danh sách + mentor mute/kick/ban |
| React | Emoji bay lên stage |
| More | Settings, Invite, copy link, full screen, End session (mentor) |
| Đỏ | Rời phòng |

Link mời: `https://<domain>/sessions/<sessionId>/room` — người mở phải đăng nhập
bằng tài khoản AI Eo và có quyền vào buổi đó.

## Camera báo "không khả dụng" dù camera vẫn tốt

Nguyên nhân cũ: code xin **camera + micro trong một lần**. Nếu micro bận (Zoom,
Meet, Teams…) hoặc bị chặn, cả request thất bại; lần thử lại chỉ xin audio nên
camera tốt cũng bị báo là không có.

Bây giờ:

1. Vẫn thử một prompt chung trước (trường hợp bình thường).
2. Nếu lỗi, **xin từng thiết bị riêng** và thử lại với constraint đơn giản hơn.
3. Camera chạy được thì vẫn vào phòng dù micro lỗi (và ngược lại).
4. Thông báo nêu đúng lỗi: bị chặn quyền, không tìm thấy thiết bị, thiết bị đang
   bận, hay trang không phải HTTPS.
5. Trong **Settings** có thể đổi camera/microphone giữa cuộc gọi; track được
   thay trên mọi kết nối mà không phải vào lại phòng.

Checklist khi vẫn lỗi:

- Biểu tượng camera/khoá trên thanh địa chỉ → **Allow** cho cả camera và micro.
- Đóng app khác đang dùng camera (Zoom/Meet/Teams/OBS).
- Mở trang bằng `https://` (hoặc `localhost`). Trang http thường không có
  `navigator.mediaDevices`.
- Nếu đang xem trong iframe preview: khung đó phải có
  `allow="camera; microphone; display-capture"` — mở app ở tab riêng là chắc
  chắn nhất.
- macOS: Settings → Privacy & Security → Camera/Microphone → bật cho trình duyệt.
- Windows: Settings → Privacy → Camera → cho phép app desktop truy cập.

## Tile, presence và giao diện điện thoại

- **Tile xuất hiện ngay khi người kia vào phòng**, không đợi WebRTC: presence
  (poll 1,5 giây) mang theo `camOn`/`micOn`, nên mọi người luôn thấy tên, avatar,
  nhãn "Camera off" và biểu tượng mic tắt kể cả khi track chưa tới.
- **Video thật** được gắn lại và `play()` mỗi khi track đầu tiên tới — đây là lỗi
  làm tile đen dù camera vẫn sáng.
- **Self view**: toàn stage khi ở một mình; thu thành tile nhỏ góc phải dưới khi
  có người khác (filmstrip). Nếu chưa có frame camera thật, hiển thị avatar thay
  vì ô đen.
- **Stage không bao giờ đè lên toolbar**: stage là flex item có `min-height: 0`
  và `overflow: hidden`; gợi ý "Waiting for…" nằm gọn trong stage.
- **Điện thoại**: header 2 dòng cho tiêu đề (line-clamp), ẩn nút copy/invite,
  grid 2 cột cho tới 6 người, toolbar cuộn ngang, self tile 104–122px.
- **Đồng hồ**: đếm từ lúc *bạn* vào phòng (giống Jitsi), không lấy
  `session.started_at` (buổi mở từ hôm trước sẽ ra 1391:00). Hiển thị `MM:SS`,
  qua 1 giờ thành `H:MM:SS`.
- **Chat** nhận diện link và ảnh/GIF đuôi `.gif/.png/.jpg/.webp` và render inline.

## Kiến trúc

WebRTC mesh (mỗi cặp peer một `RTCPeerConnection`), SDP/ICE đi qua D1
(`mentor_signals`), presence poll 1,5 giây. Perfect negotiation + rollback xử lý
glare; track đến muộn (camera bật sau, screen share) được thêm và renegotiate.
Phần UI mới chỉ thay lớp trình bày, không đổi giao thức.
