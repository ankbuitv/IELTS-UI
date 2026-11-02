# Lộ trình 100 tính năng tiếp theo

Người dùng đã yêu cầu làm tất cả theo từng đợt. Danh sách dưới đây là **kế hoạch**, không phải tuyên bố đã hoàn thành. Kiểm thử, phân quyền, riêng tư, di chuyển dữ liệu và trải nghiệm trong cửa sổ desktop là điều kiện hoàn thành của từng mục. Không triển khai production hay chạy migration từ xa nếu chưa được cho phép.

Trạng thái: `[x]` đã có trong đợt mới; `[ ]` chưa hoàn thành. Các mục có chức năng cũ tương tự vẫn phải được kiểm tra và mở rộng theo yêu cầu mới.

## Lịch và công việc
- [x] 1. Lịch dạy lặp tuần/tháng, tạo chuỗi theo số buổi trong kỳ.
- [x] 2. Đổi lịch một buổi mà không đổi các buổi còn lại.
- [x] 3. Lịch dạy bù, lý do và thông báo trong ứng dụng.
- [x] 4. Kiểm tra trùng lịch cá nhân, buổi học, lịch trường, hỗ trợ và lịch dạy trước khi tạo/đổi giờ.
- [x] 5. Lịch trống giáo viên (khung giờ cá nhân hằng tuần).
- [x] 6. Danh sách việc cần làm hôm nay (việc cá nhân).
- [x] 7. Ưu tiên việc cần làm (cao / bình thường / thấp).
- [ ] 8. Ủy quyền xử lý tạm thời.
- [ ] 9. Đồng bộ lịch ngoài.
- [x] 10. Tổng kết cuối ngày (việc cá nhân và ghi chú riêng).

Đợt đầu lưu tối đa 24 buổi riêng lẻ trong vòng hai năm, theo múi giờ thiết bị lúc tạo; tháng thiếu ngày dùng ngày cuối tháng. Chuỗi không tự tạo buổi về sau và hiện chưa hỗ trợ sửa/xóa cả chuỗi. Thông báo tới tối đa 500 học viên đang hoạt động là best-effort; không đảm bảo giao nhận. Lịch trống là khung giờ lặp riêng tư, tối đa một khoảng mỗi ngày, theo múi giờ lưu trên thiết bị; không phải đặt chỗ hay cam kết còn trống. Có thể kiểm tra trùng cho tuần đang xem; kiểm tra là tham khảo, có thể bỏ sót. Khi đổi múi giờ cần xác nhận giữ nguyên con số giờ; thay đổi giờ mùa hè có thể khiến một giờ không tồn tại. Migration 0083 cần áp dụng trước khi dùng. Việc cá nhân có thể tạo, sửa, hoàn thành, khôi phục và xóa; ngày được so theo lịch địa phương trên thiết bị, việc quá hạn hoặc không đặt ngày xuất hiện ở hôm nay. Dữ liệu riêng theo tài khoản, tối đa 500 việc, không tự tạo từ bài giao hoặc lịch và chưa có nhắc hạn. Tổng kết có ghi chú riêng theo ngày và đếm việc cá nhân còn đánh dấu hoàn thành theo giờ thiết bị, không phải báo cáo bất biến: khôi phục hoặc xóa việc làm thay đổi số đếm. Ghi chú không tự lưu, có cảnh báo khi đổi ngày; không tổng hợp tự động việc hệ thống. Migration 0081–0082 cần áp dụng trước khi dùng. Migration 0079 cần áp dụng trước khi dùng. Kiểm tra trùng chỉ là cảnh báo cho tài khoản đang thao tác, không thay thế khóa lịch hoặc đảm bảo không có xung đột đồng thời; các truy vấn lịch có giới hạn 500 mục nên có thể bỏ sót khi lịch quá nhiều.

## Bài tập và lộ trình
- [x] 11. Mẫu bài giao cá nhân; không lưu ngày hoặc danh sách người nhận.
- [x] 12. Nhân bản bài sang nhiều lớp dưới dạng bản nháp.
- [ ] 13. Gia hạn riêng từng học viên.
- [x] 14. Giới hạn số lượt làm bài (1–20, bao gồm lần đầu).
- [ ] 15. Chia bài thành các mốc có hạn riêng.
- [ ] 16. Bài học tiên quyết.
- [ ] 17. Lộ trình cá nhân.
- [ ] 18. Gắn tài liệu hướng dẫn vào bài.
- [ ] 19. Nộp bài bằng tệp đính kèm.
- [ ] 20. Nhật ký thay đổi bài giao.

Giới hạn lượt áp dụng cho số lần bắt đầu bài, gồm lần đầu; lượt ABANDONED không tính, và lượt IN_PROGRESS được tiếp tục thay vì tạo mới. Kiểm tra giới hạn và quyền trong thao tác tạo nguyên tử để tránh tạo quá lượt khi yêu cầu đồng thời.

Mẫu cá nhân cần migration 0080; mẫu không lưu ngày/đối tượng và áp dụng lại sẽ xóa lựa chọn đó. Nhân bản tối đa 20 lớp đang hoạt động có quyền truy cập, tạo bản nháp cho **toàn bộ lớp**, không sao chép hạn, danh sách chọn, bài nộp hoặc nhận xét. Chủ lớp/quản trị viên phải xem hạn và chính sách kết quả rồi xác nhận phát hành; giáo viên đồng giảng không thể tự phát hành thay chủ lớp.

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
- [x] 31. Checklist mục tiêu tuần.
- [ ] 32. Danh sách bài cần sửa.
- [ ] 33. Đánh dấu nhận xét đã hiểu hoặc cần hỏi.
- [ ] 34. Hỏi về từng nhận xét.
- [x] 35. Sổ từ vựng từ bài học.
- [x] 36. Ôn từ theo lịch lặp.
- [x] 37. Danh sách lỗi thường gặp.
- [x] 38. Theo dõi thời gian tự học theo kỹ năng.
- [x] 39. Ghim tài liệu lớp.
- [x] 40. Nhật ký học tập cá nhân.

Sổ từ vựng riêng có thể lưu từ tra trong bài học, ghi nguồn Lesson và lọc “From lessons”; từ sai trong bài và từ chọn hằng ngày cũng được lưu theo cơ chế hiện có. Lưu lại từ đã tồn tại cập nhật nguồn/định nghĩa thay vì tạo bản sao; tra từ cần dữ liệu từ điển khả dụng. Nguồn Lesson là chung, không ghi tên/ID bài; từ lưu trước thay đổi không tự phân loại lại và bộ lọc còn bao gồm WORDBANK. Ôn từ lặp dùng hộp Leitner hiện có, có bài ôn và nút tự đánh giá ngay trên sổ khi đến hạn: nhớ chuyển lên hộp và hẹn 1/2/4/8/16 ngày; chưa nhớ lùi hộp và đến hạn ngay. Không phải thông báo nhắc; thao tác đồng thời từ nhiều thiết bị có thể ghi đè. Danh sách lỗi thường gặp là sổ riêng do học viên tự nhập, sửa, tìm, xóa và tự điều chỉnh số lần gặp; sắp xếp theo số lần, không tự phân tích bài làm; tối đa 500 mục. Migration 0093 cần áp dụng. Theo dõi thời gian tự học bằng các lần ghi thủ công riêng tư theo ngày/kỹ năng, mỗi lần 1–600 phút, có sửa/xóa và tổng theo tháng; không tự thu thập thời gian làm bài hay cuộc gọi. Tối đa 2000 lần ghi/tài khoản; migration 0092 cần áp dụng. Checklist mục tiêu tuần cá nhân của học viên có tạo, sửa, đánh dấu/khôi phục và xóa; tuần bắt đầu thứ Hai theo ngày thiết bị, tối đa 50 mục/tuần và 2000 mục/tài khoản; không tự sinh từ bài giao. Migration 0091 cần áp dụng. Nhật ký học tập cá nhân dành cho tài khoản học viên; tối đa 4000 ký tự/ngày, lưu thủ công, để trống và lưu là xóa; cảnh báo khi đổi ngày hoặc đóng/tải lại trang nếu chưa lưu, chưa chặn mọi chuyển trang trong ứng dụng. Migration 0090 cần áp dụng. Ghim tài liệu là dấu trang riêng theo tài khoản và lớp, chỉ trên tài liệu giáo viên đang chia sẻ; không cấp thêm quyền, không hiện cho người khác, và không hiển thị khi tài liệu ngừng chia sẻ. Danh sách hiện tối đa 200 tài liệu, ghim được ưu tiên ở đầu; migration 0089 cần áp dụng trước khi dùng.

## Trao đổi lớp
- [x] 41. Trả lời tin nhắn theo luồng.
- [x] 42. Đề cập thành viên trong tin nhắn và luồng.
- [x] 43. Tìm kiếm lịch sử tin nhắn và tên tệp trong lớp.
- [x] 44. Đánh dấu tin chưa đọc cá nhân.
- [x] 45. Ghim tin nhắn lớp.
- [ ] 46. Lên lịch thông báo.
- [ ] 47. Hạn xác nhận thông báo.
- [ ] 48. Chủ đề hỏi đáp theo bài.
- [ ] 49. Trạng thái câu hỏi.
- [x] 50. Tắt thông báo hội thoại lớp theo thời gian.

Tắt tiếng áp dụng cho thông báo được đề cập trong hội thoại của lớp trong 1 giờ, 8 giờ, 24 giờ hoặc 7 ngày; không xóa thông báo cũ, không tắt hạn bài/lịch hay nội dung lớp. Đến hạn tự hết; migration 0088 cần áp dụng trước khi dùng. Tin chưa đọc là đánh dấu thủ công riêng theo tài khoản, tối đa 100 tin/lớp; không tự phát hiện tin mới. Có thể mở luồng hoặc xóa dấu, kể cả trả lời; migration 0087 cần áp dụng trước khi dùng. Đề cập chọn tối đa 10 thành viên đang hoạt động từ danh sách (hiển thị tối đa 500); chỉ người được chọn nhận thông báo trong ứng dụng, lưu cùng tin trong một giao dịch. Văn bản @ gõ tay không tự gửi thông báo. Migration 0086 cần áp dụng trước khi dùng. Luồng gắn vào một tin gốc, hiển thị tối đa 100 trả lời mới nhất, không có lồng nhiều cấp; gửi trả lời từ giao diện hiện hỗ trợ văn bản. Tìm kiếm trả lời có thể mở lại luồng. Migration 0085 cần áp dụng trước khi dùng. Giáo viên chủ lớp, đồng giảng đang hoạt động và quản trị viên ghim hoặc bỏ ghim tối đa 20 tin/lớp; thành viên lớp xem được, học viên không thể sửa, lớp lưu trữ chỉ đọc. Migration 0084 cần áp dụng trước khi dùng. Tìm kiếm kiểm tra quyền thành viên ở máy chủ, tìm trong toàn bộ lịch sử, phân trang 30 kết quả theo thời gian và ID. Không tìm nội dung bên trong tệp; chữ có dấu hiện cần đúng chữ hoa/thường vì SQLite mặc định chỉ gấp chữ ASCII.

## Phòng học trực tuyến
- [x] 51. Bảng viết chung.
- [x] 52. Phòng thảo luận nhóm nhỏ.
- [x] 53. Giáo viên ghé phòng nhỏ và thông báo chung.
- [x] 54. Đếm giờ hoạt động nhóm.
- [x] 55. Hàng đợi phát biểu.
- [ ] 56. Bảng câu hỏi trong buổi học.
- [x] 57. Khảo sát nhanh trong cuộc gọi.
- [ ] 58. Giao diện riêng người trình bày/người xem.
- [x] 59. Kiểm tra camera, mic, loa trước khi vào.
- [ ] 60. Tóm tắt buổi học.

Chủ trì đang ở phòng chính chia 2–4 phòng cho tối đa 200 người có mặt, theo thứ tự tham gia; từng người tự chọn vào phòng đã phân, chủ trì có thể ghé phòng và gửi thông báo tới phòng chính cùng các nhóm đang mở. Thông báo xuất hiện trong cuộc gọi/chat khi có mạng, không đảm bảo đã đọc. Hẹn 5–60 phút, đồng hồ còn lại theo giờ thiết bị; hết hạn máy chủ từ chối phòng nhóm, ứng dụng trở về màn hình chờ phòng chính khi kết nối/thăm dò, người dùng phải vào lại và không thể ép ngắt kết nối ngang hàng khi mất mạng. Có thể đóng sớm; không tự động chuyển hay phân lại người đến muộn. Mỗi lần mở dùng khóa phòng riêng để không lộ bảng/chat phiên cũ. Bảng vẽ chung theo phòng, tối đa 600 nét/800 điểm mỗi nét; các thành viên đang trong phòng vẽ hoặc hoàn tác nét cuối (kể cả nét người khác), chỉ chủ trì xóa bảng. Khi hai người lưu cùng lúc, phiên bản cũ bị từ chối và thông báo cần vẽ lại; không tự ghép nét. Có thử lưu lại khi lỗi mạng và cảnh báo khi đóng bảng với thay đổi chưa lưu, không bảo đảm khôi phục sau đóng trang. Khảo sát/quiz trong cuộc gọi cho chủ trì mở một câu hỏi mỗi phòng, thành viên đang có mặt chọn một đáp án một lần, kết quả tổng hợp cập nhật theo lượt thăm dò; đóng câu hỏi để xem lại kết quả, đáp án quiz chỉ hiện với học viên sau khi đóng. Không có danh sách cá nhân trong giao diện; dữ liệu lựa chọn vẫn lưu ở máy chủ, không tuyên bố ẩn danh. Hàng đợi phát biểu hiện trong danh sách thành viên, xếp theo thời điểm máy chủ ghi nhận giơ tay và cập nhật theo lượt thăm dò; người tham gia tự giơ/hạ tay, ra phòng hoặc vào lại sẽ rời hàng đợi. Các lần cùng millisecond dùng ID để phân định, không có thao tác hạ tay hộ. Migration 0094 cần áp dụng. Màn hình chờ xem camera, bật/tắt hoặc đổi thiết bị; đo mức mic tại máy theo yêu cầu mà không ghi âm/phát lại, phát âm ngắn để tự xác nhận loa. Người dùng phải cấp quyền và tự xác nhận nghe được; âm dùng đầu ra mặc định của trình duyệt, không chứng minh kết nối tới người khác.

## Trường và nhân sự
- [x] 61. Tổ chuyên môn và người phụ trách.
- [ ] 62. Hồ sơ năng lực giáo viên.
- [ ] 63. Phân công lớp theo học kỳ.
- [ ] 64. Phê duyệt đổi giáo viên phụ trách.
- [ ] 65. Nhận diện giáo viên quá tải.
- [x] 66. Lịch nghỉ và ngày lễ.
- [ ] 67. Mẫu thông báo cấp trường.
- [ ] 68. Nhật ký thao tác quản lý.
- [ ] 69. Lưu trữ học kỳ cũ.
- [ ] 70. Hộp việc cần duyệt cho ban giám hiệu.

## Báo cáo
- [ ] 71. So sánh tiến độ theo giai đoạn.
- [x] 72. Biểu đồ chuyên cần tuần/tháng.
- [x] 73. Tỷ lệ hoàn thành bài tập theo lớp.
- [ ] 74. Phân tích câu hỏi khó.
- [ ] 75. Kỹ năng ít được luyện.
- [ ] 76. Mục tiêu giáo viên đặt cho lớp.
- [ ] 77. Lịch sử can thiệp hỗ trợ.
- [ ] 78. Mẫu báo cáo tùy chỉnh.
- [x] 79. So sánh lớp bằng dữ liệu tổng hợp.
- [x] 80. Giải thích cách tính chỉ số.

Giải thích trực tiếp trong hai báo cáo tổng hợp tiến độ giáo viên và tổng quan trường: nguồn, phạm vi, mẫu số, lượt nộp/hết giờ, band gần nhất và hạn chế; biểu đồ chuyên cần giải thích riêng. Biểu đồ chuyên cần nhóm tuần (từ thứ Hai) hoặc tháng trong khoảng tối đa 366 ngày; tính các điểm danh đã lưu, kể cả học viên đã rời lớp; (có mặt + muộn) / (có mặt + muộn + vắng), không tính chưa đánh dấu. Không suy luận tham gia cuộc gọi; kỳ ở hai đầu khoảng có thể chưa đủ. Người xem phải có quyền điểm danh lớp. So sánh lớp dùng duy nhất chỉ số tổng hợp hoàn thành trong lớp giáo viên phụ trách/đồng giảng, hiển thị mẫu số và sắp xếp theo tên hoặc tỷ lệ; không dùng làm đánh giá chất lượng vì quy mô và độ khó khác nhau. Hoàn thành theo lớp = số cặp học viên-bài đã nộp hoặc hết giờ / số cặp được giao; tính học viên hiện hoạt thuộc đối tượng, bài ACTIVE/CLOSED tại lớp đang hoạt động. Mỗi học viên tính một lần cho mỗi bài, không tính học viên đã rời lớp; các số có thể thay đổi khi danh sách thay đổi. Chỉ các lớp người dùng phụ trách/đồng giảng mới xuất hiện.

## Desktop
- [x] 81. Tìm ứng dụng từ Start.
- [x] 82. Tìm nhanh lớp, học viên, bài trong phạm vi cho phép.
- [x] 83. Ghim lớp thường dùng.
- [ ] 84. Bố cục cửa sổ lưu sẵn.
- [x] 85. Mở lại các cửa sổ trước đó.
- [x] 86. Kéo thả tệp vào cửa sổ tài liệu.
- [x] 87. Phím tắt bàn phím.
- [x] 88. Lọc trung tâm thông báo.
- [ ] 89. Chế độ tập trung.
- [x] 90. Tương phản cao và cỡ chữ lớn.

Tùy chọn mở lại cửa sổ phải được bật trong Start, chỉ lưu danh sách một số ứng dụng an toàn trên trình duyệt theo tài khoản; kiểm tra lại ứng dụng có quyền trước khi mở. Không khôi phục trạng thái, nội dung chưa lưu, vị trí cửa sổ, bài thi, cuộc gọi hay trang bất kỳ; không đồng bộ sang thiết bị khác. Kéo thả một tệp vào cửa sổ thư viện tài liệu cá nhân, kiểm tra phạm vi chia sẻ rồi chủ động lưu; tối đa 500 KB/tệp, không hỗ trợ thả nhiều tệp hoặc thư mục. Phím tắt Alt+Shift+S/N/M/W mở Start/thông báo, thu nhỏ/đóng cửa sổ trên cùng; không kích hoạt trong ô nhập hoặc hộp thoại, và xác nhận đóng bài/cuộc gọi vẫn có hiệu lực. Ghim tối đa 10 lớp thường dùng vào Start trong localStorage riêng theo tài khoản và thiết bị; chỉ hiển thị lớp còn trong danh sách được phép, có thể xóa ghim lớp không còn truy cập. Không đồng bộ giữa thiết bị. Start tìm ứng dụng theo vai trò và lớp từ danh sách đang có; tìm học viên/bài giao trên máy chủ chỉ trong các lớp đang hoạt động do tài khoản đó phụ trách hoặc đồng giảng, tối đa 10 kết quả mỗi loại. SQLite chỉ không phân biệt hoa/thường với ASCII. Trung tâm thông báo lọc loại, lớp, từ khóa, trạng thái đọc và nhóm ưu tiên trong tối đa 40 thông báo mới nhất đang tải, không phải toàn bộ lịch sử; liên kết hoặc tên lớp được dùng để ước lượng lớp.

## An toàn và tin cậy
- [x] 91. Xác thực hai bước.
- [x] 92. Thiết bị đăng nhập và đăng xuất từ xa.
- [ ] 93. Cảnh báo đăng nhập bất thường.
- [ ] 94. Lịch sử thay đổi quyền.
- [ ] 95. Phân loại tài liệu nhạy cảm.
- [ ] 96. Thời hạn lưu dữ liệu theo chính sách.
- [ ] 97. Sao lưu và khôi phục.
- [x] 98. Cảnh báo mất kết nối và trạng thái lưu bài.
- [x] 99. Bảng tình trạng hệ thống.
- [x] 100. Kiểm tra người nhận trước khi chia sẻ.

## Giao diện desktop giáo viên

Đã bổ sung cửa sổ Hôm nay, lịch tuần có kéo thả/đổi giờ, bộ lọc hàng chờ Writing và Speaking, tab lớp gọn, tìm kiếm trong Start, và lọc trung tâm thông báo. Bố cục nhanh và chế độ tập trung đã được gỡ theo yêu cầu. Bộ lọc hàng chờ chạy ở máy chủ, vẫn giới hạn 100 bài Writing / 50 Speaking mỗi lần tải; lớp trong thông báo được nhận diện từ đường dẫn hoặc tên trong nội dung. Mức “cần xử lý” chỉ là phân nhóm chấm bài/bài tập/lịch hẹn, không phải mức độ khẩn cấp do hệ thống xác định. Lịch tuần và biểu mẫu lịch kiểm tra trùng với lịch của tài khoản đang thao tác trên máy chủ; cảnh báo cho phép tiếp tục và không khóa chống trùng đồng thời; việc đổi giờ chỉ áp dụng cho buổi dạy của giáo viên và thông báo cho lớp theo cơ chế best-effort. Trên thiết bị hẹp, nút đổi giờ thay thế thao tác kéo thả.

Cảnh báo kết nối và lưu bài áp dụng trong giao diện làm bài thi: trạng thái lưu máy chủ, mất mạng, lỗi và nút thử lại; thử gửi lại khi có mạng. Bản nháp chưa gửi lưu cục bộ nếu trình duyệt cho phép; nếu lưu cục bộ bị chặn sẽ cảnh báo chỉ còn trong trang đang mở. Đồng hồ vẫn chạy và mất mạng có thể ảnh hưởng thời hạn; không cam kết nhận bài sau hạn. Không phải trạng thái lưu chung cho mọi ứng dụng.

Xác thực hai bước dùng ứng dụng TOTP và 8 mã dự phòng dùng một lần; cấu hình trong Profile → Security, có giới hạn thử, ngăn đặt lại khi đang bật và kiểm tra mã khi tắt. Đăng nhập mật khẩu/mã email/liên kết email yêu cầu bước thứ hai; SSO hiện bị chặn khi bật 2FA, cần dùng các cách kia. Khóa TOTP hiện lưu trên cơ sở dữ liệu của ứng dụng; chưa mã hóa riêng bằng KMS. Cơ chế tìm ticket chỉ xét 20 yêu cầu mới nhất trên toàn hệ thống nên tải đăng nhập lớn có thể làm yêu cầu hợp lệ hết hiệu lực sớm. Mã dự phòng hết hạn sau 365 ngày; bước bật và cấp mã chưa phải một giao dịch nguyên tử, vì vậy cần hỗ trợ khôi phục nếu xảy ra lỗi giữa hai bước.

Phiên đăng nhập: Profile → Security liệt kê tối đa 30 phiên hoạt động gần nhất theo tài khoản, có IP/tác nhân trình duyệt và lần hoạt động, đăng xuất từng phiên khác hoặc tất cả phiên khác sau xác nhận; phiên đang dùng được giữ lại. Nhãn thiết bị/IP chỉ phản ánh thông tin phiên và có thể không chính xác. Máy chủ chặn thu hồi phiên của tài khoản khác.

Bảng Service status cho quản trị viên tại Settings: thời điểm kiểm tra, Worker, khả năng đọc D1 và độ đầy đủ schema; trạng thái AI/email chỉ cho biết cấu hình, lưu tệp bằng D1 và hàng đợi import là lựa chọn backend chứ không kiểm tra khả dụng. Không phải giám sát liên tục, không kiểm thử gửi email/AI hay kết nối thực tế đến nhà cung cấp.

Tổ bộ môn: quản lý trường hoặc người được cấp MANAGE_GROUPS tạo, sửa, xóa tổ và phân tổ trưởng cùng các thành viên hoạt động; tổ trưởng phải thuộc tổ. Không tự cấp vị trí tổ trưởng cho người quản lý được ủy quyền; giáo án đã gửi duyệt chặn xóa tổ để giữ lịch sử. Tài khoản bị khóa không được bổ nhiệm, không nằm trong danh sách thành viên đang hoạt động. Danh sách giới hạn 200 tổ/200 nhân sự; đây không phải phân công theo học kỳ.

Lịch trường có loại sự kiện/ngày lễ/nghỉ trường, lọc và quản lý thủ công cho trường đã duyệt; nhân sự đang hoạt động xem, quản lý hoặc người được cấp quyền lịch sửa. Thời gian hiển thị theo thiết bị, tối đa 200 sự kiện mới theo thời điểm bắt đầu; không tự lấy ngày lễ, thay đổi lịch dạy, kiểm tra trùng hay gửi nhắc nhở. Migration 0095 cần áp dụng.

Tùy chọn tương phản cao và chữ lớn trong Cài đặt hình nền của desktop, lưu cục bộ theo tài khoản và có thể tắt lại. Kiểu áp dụng cho khung desktop và phần lớn nội dung trong cửa sổ; một số màn hình chuyên dụng/nội dung đặc biệt có thể cần dùng chức năng phóng to hoặc tương phản của hệ điều hành/trình duyệt. Chưa chứng nhận WCAG toàn bộ ứng dụng và không đồng bộ giữa thiết bị.

Kiểm tra người nhận trước khi chia sẻ **tài liệu trong thư viện cá nhân**: xem tên lớp, số học viên đang hoạt động và tối đa 100 tên, cùng cảnh báo giáo viên/đồng giảng/quản trị viên có quyền truy cập, thành viên có thể thay đổi và tệp đã tải không thu hồi được; xác nhận hoặc quay lại trước khi lưu. Máy chủ kiểm tra quyền chia sẻ và lớp hoạt động khi xem lẫn khi lưu. Đây không áp dụng cho mọi loại tin nhắn hoặc chia sẻ khác.
