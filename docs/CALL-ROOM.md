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

## Kiến trúc

WebRTC mesh (mỗi cặp peer một `RTCPeerConnection`), SDP/ICE đi qua D1
(`mentor_signals`), presence poll 1,5 giây. Perfect negotiation + rollback xử lý
glare; track đến muộn (camera bật sau, screen share) được thêm và renegotiate.
Phần UI mới chỉ thay lớp trình bày, không đổi giao thức.
