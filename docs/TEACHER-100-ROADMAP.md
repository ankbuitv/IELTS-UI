# Lộ trình 100 tính năng tiếp theo

Người dùng đã yêu cầu làm tất cả theo từng đợt. Danh sách dưới đây là **kế hoạch**, không phải tuyên bố đã hoàn thành. Kiểm thử, phân quyền, riêng tư, di chuyển dữ liệu và trải nghiệm trong cửa sổ desktop là điều kiện hoàn thành của từng mục. Không triển khai production hay chạy migration từ xa nếu chưa được cho phép.

Trạng thái: `[x]` đã có trong đợt mới; `[ ]` chưa hoàn thành. Các mục có chức năng cũ tương tự vẫn phải được kiểm tra và mở rộng theo yêu cầu mới.

## Lịch và công việc
- [x] 1. Lịch dạy lặp tuần/tháng, tạo chuỗi theo số buổi trong kỳ.
- [x] 2. Đổi lịch một buổi mà không đổi các buổi còn lại.
- [x] 3. Lịch dạy bù, lý do và thông báo trong ứng dụng.
- [ ] 4. Kiểm tra trùng lịch.
- [ ] 5. Lịch trống giáo viên.
- [ ] 6. Danh sách việc cần làm hôm nay.
- [ ] 7. Ưu tiên việc cần làm.
- [ ] 8. Ủy quyền xử lý tạm thời.
- [ ] 9. Đồng bộ lịch ngoài.
- [ ] 10. Tổng kết cuối ngày.

Đợt đầu lưu tối đa 24 buổi riêng lẻ trong vòng hai năm, theo múi giờ thiết bị lúc tạo; tháng thiếu ngày dùng ngày cuối tháng. Chuỗi không tự tạo buổi về sau và hiện chưa hỗ trợ sửa/xóa cả chuỗi. Thông báo tới tối đa 500 học viên đang hoạt động là best-effort; không đảm bảo giao nhận. Migration 0079 cần áp dụng trước khi dùng.

## Bài tập và lộ trình
- [ ] 11. Mẫu bài giao.
- [ ] 12. Nhân bản bài sang nhiều lớp.
- [ ] 13. Gia hạn riêng từng học viên.
- [ ] 14. Giới hạn số lần nộp lại.
- [ ] 15. Chia bài thành các mốc có hạn riêng.
- [ ] 16. Bài học tiên quyết.
- [ ] 17. Lộ trình cá nhân.
- [ ] 18. Gắn tài liệu hướng dẫn vào bài.
- [ ] 19. Nộp bài bằng tệp đính kèm.
- [ ] 20. Nhật ký thay đổi bài giao.

## Câu hỏi và đề thi
- [ ] 21. Ngân hàng câu trắc nghiệm.
- [ ] 22. Câu nghe kèm audio và mốc thời gian.
- [ ] 23. Câu đọc kèm đoạn văn, bảng hoặc hình.
- [ ] 24. Nhãn độ khó và chủ đề.
- [ ] 25. Tạo đề từ ngân hàng.
- [ ] 26. Trộn thứ tự câu hỏi.
- [ ] 27. Trộn đáp án khi phù hợp.
- [ ] 28. Xem trước đề như học viên.
- [ ] 29. Thống kê câu nhiều người làm sai.
- [ ] 30. Phiên bản đề bất biến cho bài đã giao.

## Học viên
- [ ] 31. Checklist mục tiêu tuần.
- [ ] 32. Danh sách bài cần sửa.
- [ ] 33. Đánh dấu nhận xét đã hiểu hoặc cần hỏi.
- [ ] 34. Hỏi về từng nhận xét.
- [ ] 35. Sổ từ vựng từ bài học.
- [ ] 36. Ôn từ theo lịch lặp.
- [ ] 37. Danh sách lỗi thường gặp.
- [ ] 38. Theo dõi thời gian tự học theo kỹ năng.
- [ ] 39. Ghim tài liệu lớp.
- [ ] 40. Nhật ký học tập cá nhân.

## Trao đổi lớp
- [ ] 41. Trả lời tin nhắn theo luồng.
- [ ] 42. Đề cập thành viên.
- [ ] 43. Tìm kiếm tin nhắn.
- [ ] 44. Đánh dấu tin chưa đọc.
- [ ] 45. Ghim tin nhắn.
- [ ] 46. Lên lịch thông báo.
- [ ] 47. Hạn xác nhận thông báo.
- [ ] 48. Chủ đề hỏi đáp theo bài.
- [ ] 49. Trạng thái câu hỏi.
- [ ] 50. Tắt tiếng lớp theo thời gian.

## Phòng học trực tuyến
- [ ] 51. Bảng viết chung.
- [ ] 52. Phòng thảo luận nhóm nhỏ.
- [ ] 53. Giáo viên ghé phòng nhỏ và thông báo chung.
- [ ] 54. Đếm giờ hoạt động nhóm.
- [ ] 55. Hàng đợi phát biểu.
- [ ] 56. Bảng câu hỏi trong buổi học.
- [ ] 57. Khảo sát nhanh trong cuộc gọi.
- [ ] 58. Giao diện riêng người trình bày/người xem.
- [ ] 59. Kiểm tra camera, mic, loa trước khi vào.
- [ ] 60. Tóm tắt buổi học.

## Trường và nhân sự
- [ ] 61. Tổ chuyên môn và người phụ trách.
- [ ] 62. Hồ sơ năng lực giáo viên.
- [ ] 63. Phân công lớp theo học kỳ.
- [ ] 64. Phê duyệt đổi giáo viên phụ trách.
- [ ] 65. Nhận diện giáo viên quá tải.
- [ ] 66. Lịch nghỉ và ngày lễ.
- [ ] 67. Mẫu thông báo cấp trường.
- [ ] 68. Nhật ký thao tác quản lý.
- [ ] 69. Lưu trữ học kỳ cũ.
- [ ] 70. Hộp việc cần duyệt cho ban giám hiệu.

## Báo cáo
- [ ] 71. So sánh tiến độ theo giai đoạn.
- [ ] 72. Biểu đồ chuyên cần tuần/tháng.
- [ ] 73. Tỷ lệ hoàn thành bài tập theo lớp.
- [ ] 74. Phân tích câu hỏi khó.
- [ ] 75. Kỹ năng ít được luyện.
- [ ] 76. Mục tiêu giáo viên đặt cho lớp.
- [ ] 77. Lịch sử can thiệp hỗ trợ.
- [ ] 78. Mẫu báo cáo tùy chỉnh.
- [ ] 79. So sánh lớp bằng dữ liệu tổng hợp.
- [ ] 80. Giải thích cách tính chỉ số.

## Desktop
- [ ] 81. Tìm ứng dụng từ Start.
- [ ] 82. Tìm nhanh lớp, học viên, bài trong phạm vi cho phép.
- [ ] 83. Ghim lớp thường dùng.
- [ ] 84. Bố cục cửa sổ lưu sẵn.
- [ ] 85. Mở lại các cửa sổ trước đó.
- [ ] 86. Kéo thả tệp vào cửa sổ tài liệu.
- [ ] 87. Phím tắt bàn phím.
- [ ] 88. Lọc trung tâm thông báo.
- [ ] 89. Chế độ tập trung.
- [ ] 90. Tương phản cao và cỡ chữ lớn.

## An toàn và tin cậy
- [ ] 91. Xác thực hai bước.
- [ ] 92. Thiết bị đăng nhập và đăng xuất từ xa.
- [ ] 93. Cảnh báo đăng nhập bất thường.
- [ ] 94. Lịch sử thay đổi quyền.
- [ ] 95. Phân loại tài liệu nhạy cảm.
- [ ] 96. Thời hạn lưu dữ liệu theo chính sách.
- [ ] 97. Sao lưu và khôi phục.
- [ ] 98. Cảnh báo mất kết nối và trạng thái lưu bài.
- [ ] 99. Bảng tình trạng hệ thống.
- [ ] 100. Kiểm tra người nhận trước khi chia sẻ.

## Giao diện desktop giáo viên

Đã bổ sung cửa sổ Hôm nay, lịch tuần có kéo thả/đổi giờ, bộ lọc hàng chờ Writing và Speaking, tab lớp gọn, tìm kiếm trong Start, lọc trung tâm thông báo, bố cục nhanh và chế độ tập trung. Bộ lọc hàng chờ chạy ở máy chủ, vẫn giới hạn 100 bài Writing / 50 Speaking mỗi lần tải; lớp trong thông báo được nhận diện từ đường dẫn hoặc tên trong nội dung. Mức “cần xử lý” chỉ là phân nhóm chấm bài/bài tập/lịch hẹn, không phải mức độ khẩn cấp do hệ thống xác định. Chế độ tập trung ẩn huy hiệu nhưng không xóa hoặc đánh dấu thông báo đã đọc. Lịch tuần cảnh báo trùng dựa trên các sự kiện của tuần đang tải, không phải khóa chống trùng trên máy chủ; việc đổi giờ chỉ áp dụng cho buổi dạy của giáo viên và thông báo cho lớp theo cơ chế best-effort. Trên thiết bị hẹp, nút đổi giờ thay thế thao tác kéo thả.
