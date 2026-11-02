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
- [x] 8. Ủy quyền xử lý tạm thời.
- [x] 9. Đồng bộ lịch ngoài.
- [x] 10. Tổng kết cuối ngày (việc cá nhân và ghi chú riêng).

Lịch dạy có liên kết đăng ký iCalendar chỉ đọc, tự cập nhật theo lần ứng dụng lịch ngoài tải lại; chỉ các buổi do chính tài khoản phụ trách ở lớp hoạt động, tối đa 500 buổi trong khoảng 90 ngày trước/366 ngày sau, không gồm lịch cá nhân, hạn bài hoặc ghi chú. Liên kết bí mật hiện một lần, tạo lại/thu hồi vô hiệu liên kết cũ nhưng không xóa bản đã tải; URL có thể nằm trong log hoặc bên lịch ngoài. Không nhập hoặc đồng bộ ngược. Migration 0106 cần áp dụng.

Ủy quyền tạm thời áp dụng cho quyền quản lý trường (tổ, lịch, duyệt giáo án toàn trường): đại diện trường cấp từng quyền cho nhân sự đang hoạt động tối đa 90 ngày hoặc thu hồi sớm; máy chủ kiểm tra hạn mỗi yêu cầu. Quyền thường trực độc lập không bị xóa khi quyền tạm hết hạn; danh sách chỉ hiện tối đa 500 quyền còn hiệu lực, desktop cần làm mới để cập nhật biểu tượng. Ngoài ra giáo viên có thể ủy quyền từng việc cá nhân cho một giáo viên cùng trường đang hoạt động tối đa 90 ngày; người nhận xem việc và đánh dấu hoàn thành/mở lại, có thể từ chối; chủ việc thu hồi hoặc thay người nhận. Quyền hết khi hết hạn hoặc một bên rời trường, không cấp quyền lớp hay bài làm, không có thông báo tự động; việc tự cập nhật khi chủ việc sửa và ảnh hưởng tổng kết riêng của chủ. Không ủy quyền các loại tác vụ khác. Migration 0104 và 0117 cần áp dụng.

Đợt đầu lưu tối đa 24 buổi riêng lẻ trong vòng hai năm, theo múi giờ thiết bị lúc tạo; tháng thiếu ngày dùng ngày cuối tháng. Chuỗi không tự tạo buổi về sau và hiện chưa hỗ trợ sửa/xóa cả chuỗi. Thông báo tới tối đa 500 học viên đang hoạt động là best-effort; không đảm bảo giao nhận. Lịch trống là khung giờ lặp riêng tư, tối đa một khoảng mỗi ngày, theo múi giờ lưu trên thiết bị; không phải đặt chỗ hay cam kết còn trống. Có thể kiểm tra trùng cho tuần đang xem; kiểm tra là tham khảo, có thể bỏ sót. Khi đổi múi giờ cần xác nhận giữ nguyên con số giờ; thay đổi giờ mùa hè có thể khiến một giờ không tồn tại. Migration 0083 cần áp dụng trước khi dùng. Việc cá nhân có thể tạo, sửa, hoàn thành, khôi phục và xóa; ngày được so theo lịch địa phương trên thiết bị, việc quá hạn hoặc không đặt ngày xuất hiện ở hôm nay. Dữ liệu riêng theo tài khoản, tối đa 500 việc, không tự tạo từ bài giao hoặc lịch và chưa có nhắc hạn. Tổng kết có ghi chú riêng theo ngày và đếm việc cá nhân còn đánh dấu hoàn thành theo giờ thiết bị, không phải báo cáo bất biến: khôi phục hoặc xóa việc làm thay đổi số đếm. Ghi chú không tự lưu, có cảnh báo khi đổi ngày; không tổng hợp tự động việc hệ thống. Migration 0081–0082 cần áp dụng trước khi dùng. Migration 0079 cần áp dụng trước khi dùng. Kiểm tra trùng chỉ là cảnh báo cho tài khoản đang thao tác, không thay thế khóa lịch hoặc đảm bảo không có xung đột đồng thời; các truy vấn lịch có giới hạn 500 mục nên có thể bỏ sót khi lịch quá nhiều.

## Bài tập và lộ trình
- [x] 11. Mẫu bài giao cá nhân; không lưu ngày hoặc danh sách người nhận.
- [x] 12. Nhân bản bài sang nhiều lớp dưới dạng bản nháp.
- [x] 13. Gia hạn riêng từng học viên.
- [x] 14. Giới hạn số lượt làm bài (1–20, bao gồm lần đầu).
- [x] 15. Chia bài thành các mốc có hạn riêng.
- [x] 16. Bài học tiên quyết.
- [x] 17. Lộ trình cá nhân.
- [x] 18. Gắn tài liệu hướng dẫn vào bài.
- [x] 19. Nộp bài bằng tệp đính kèm.
- [x] 20. Nhật ký thay đổi bài giao.

Mỗi bài giao có tối đa 10 mốc do giáo viên đặt tên và hạn riêng; học viên thuộc đối tượng tự đánh dấu/bỏ dấu hoàn thành, giáo viên xem tổng số và số đúng hạn theo thành viên hiện hoạt. Đây là tiến độ tự khai, không khóa lượt thi, không tự nộp hoặc thay đổi điểm/hạn bài; thay hạn tính lại số đúng hạn, xóa mốc xóa các dấu. Không sao chép mốc khi nhân bản bài, không có nhắc hạn. Migration 0116 cần áp dụng.

Trong Bài từ ngân hàng, học viên có thể nộp câu trả lời hoặc một tệp tối đa 500 KB cho mỗi phiên bản, theo hạn và quy định nộp lại của bài; tệp lưu cùng lần nộp trong giao dịch. Học viên chỉ tải tệp của mình, giáo viên có quyền chấm tải tệp của học viên hiện hoạt; bản cũ vẫn giữ khi nộp lại. Không tự quét virus hoặc chấm nội dung tệp; không dùng cho lượt thi IELTS chuẩn. Migration 0114 cần áp dụng.

Giáo viên có quyền tài liệu có thể đính kèm/xóa tối đa 5 tệp hướng dẫn mỗi bài, mỗi tệp có nội dung tối đa 500 KB; xem trong chi tiết bài. Học viên hiện hoạt thuộc đối tượng của bài ACTIVE/CLOSED tải từ bài tập của lớp hoặc danh sách bài đầy đủ. Bản nháp không hiển thị học viên; xóa tệp không thu hồi bản đã tải, không quét virus; bản sao bài không tự sao chép tệp. Migration 0110 cần áp dụng.

Nhật ký bài giao ghi tạo/nhân bản, cập nhật cài đặt, hạn chấm và lưu trữ cùng người thao tác, trước/sau trong cùng giao dịch; giáo viên được quyền lớp xem tối đa 100 sự kiện gần nhất. Không hồi tố dữ liệu cũ, không ghi danh sách đối tượng, bài làm hoặc thay đổi đề ở nơi khác. Nhật ký đi theo bài khi bài bị xóa vĩnh viễn; migration 0107 cần áp dụng.

Giới hạn lượt áp dụng cho số lần bắt đầu bài, gồm lần đầu; lượt ABANDONED không tính, và lượt IN_PROGRESS được tiếp tục thay vì tạo mới. Kiểm tra giới hạn và quyền trong thao tác tạo nguyên tử để tránh tạo quá lượt khi yêu cầu đồng thời.

Mẫu cá nhân cần migration 0080; mẫu không lưu ngày/đối tượng và áp dụng lại sẽ xóa lựa chọn đó. Nhân bản tối đa 20 lớp đang hoạt động có quyền truy cập, tạo bản nháp cho **toàn bộ lớp**, không sao chép hạn, danh sách chọn, bài nộp hoặc nhận xét. Chủ lớp/quản trị viên phải xem hạn và chính sách kết quả rồi xác nhận phát hành; giáo viên đồng giảng không thể tự phát hành thay chủ lớp.

## Câu hỏi và đề thi
- [x] 21. Ngân hàng câu trắc nghiệm.
- [x] 22. Câu nghe kèm audio và mốc thời gian.
- [x] 23. Câu đọc kèm đoạn văn, bảng hoặc hình.
- [x] 24. Nhãn độ khó và chủ đề.
- [x] 25. Tạo đề từ ngân hàng.
- [x] 26. Trộn thứ tự câu hỏi.
- [x] 27. Trộn đáp án khi phù hợp.
- [x] 28. Xem trước đề như học viên.
- [x] 29. Thống kê câu nhiều người làm sai.
- [x] 30. Phiên bản đề bất biến cho bài đã giao.

Trình sửa đề của admin có xem trước từng phiên bản bằng các thành phần câu hỏi, bài đọc, audio/hình và ô Writing của học viên; thử trả lời chỉ trong bộ nhớ, không tạo lượt thi hay chấm và payload không chứa đáp án. Chưa mô phỏng đồng hồ, chính sách chuyển phần, lưu tự động hoặc transcript, chưa có trong ngân hàng cá nhân của giáo viên.

Câu Reading trong ngân hàng có đoạn văn/bảng dưới dạng văn bản thuần và một hình PNG/JPEG/WebP; câu Listening có một tệp MP3/Ogg/WAV và mốc bắt đầu theo giây. Tệp tối đa 500 KB, tải vào câu hỏi sau khi lưu. Bài từ ngân hàng sao chụp nội dung và tệp khi giao; học viên mở tệp theo quyền bài, không thấy đáp án, có thể tua toàn bộ audio. Mốc chỉ là vị trí bắt đầu nếu nằm trong thời lượng và trình duyệt hỗ trợ, không cắt/khóa đoạn; định dạng/phát âm thanh phụ thuộc trình duyệt. Bảng không có trình chỉnh sửa ô hay tính năng nhập liệu; không áp dụng cho đề thi admin. Migration 0113 cần áp dụng.

Tạo bài từ tối đa 20 câu trong ngân hàng cá nhân cho cả lớp; bài hỗn hợp tự luận/trắc nghiệm, câu trắc nghiệm một đáp án được chấm tự động trên máy chủ khi nộp, hiển thị số đúng, số câu và số đã chọn cho học viên và giáo viên. Tệp và tự luận không chấm tự động. Khi tạo có thể trộn câu và trộn lựa chọn trắc nghiệm riêng cho mỗi học viên, thứ tự ổn định khi tải lại/nộp lại; không trộn nội dung tự luận hay thay đổi đề đã giao. Đây là bài lớp, không phải đề IELTS chuẩn, không có đồng hồ thi, band hay chính sách công bố đáp án; trộn không phải biện pháp bảo mật/chống gian lận. Migration 0115 cần áp dụng.

Ngân hàng cá nhân hỗ trợ câu tự luận và câu trắc nghiệm một đáp án với 2–6 lựa chọn, chủ đề, kỹ năng và độ khó; chỉ tác giả thấy đáp án. Khi giao dưới dạng Bài từ ngân hàng, câu, lựa chọn và đáp án được sao chụp; học viên chọn đáp án và được chấm trắc nghiệm tự động sau khi nộp; câu tự luận và tệp vẫn do giáo viên xem. Migration 0112 cần áp dụng.

Phân tích câu trong lớp hiển thị tối đa 50 câu theo số học viên hiện hoạt thuộc đối tượng đã từng làm sai, đếm mỗi người một lần dù sau đó làm đúng; đồng thời hiển thị tổng lượt sai/được chấm để tham khảo. Chỉ các bài ACTIVE/CLOSED, lần đã nộp/hết giờ và câu có kết quả đúng/sai, không gồm câu chưa chấm; không tổng hợp qua các lớp hay ngân hàng cá nhân.

Chủ đề dạng văn bản và mức độ khó do giáo viên tự đặt (chưa phân loại/dễ/trung bình/khó) được lưu riêng trong ngân hàng câu hỏi cá nhân, có tìm và lọc; không tự suy luận độ khó và không áp dụng cho ngân hàng đề của admin. Câu cũ mặc định chưa phân loại; migration 0099 cần áp dụng.

## Học viên
- [x] 31. Checklist mục tiêu tuần.
- [x] 32. Danh sách bài cần sửa.
- [x] 33. Đánh dấu nhận xét đã hiểu hoặc cần hỏi.
- [x] 34. Hỏi về từng nhận xét.
- [x] 35. Sổ từ vựng từ bài học.
- [x] 36. Ôn từ theo lịch lặp.
- [x] 37. Danh sách lỗi thường gặp.
- [x] 38. Theo dõi thời gian tự học theo kỹ năng.
- [x] 39. Ghim tài liệu lớp.
- [x] 40. Nhật ký học tập cá nhân.

Với từng nhận xét theo đoạn của bản Writing đã trả và được phép xem, học viên đánh dấu đã hiểu/cần hỏi/bỏ đánh dấu và trao đổi riêng với giáo viên có quyền chấm; mỗi nhận xét tối đa 30 tin, làm mới thủ công, không có thông báo hoặc sửa/xóa tin. Trạng thái không ảnh hưởng điểm. Chức năng này chưa áp dụng nhận xét bài tự luận lớp hoặc mọi loại phản hồi khác. Migration 0105 cần áp dụng.

Danh sách bài đã trả để sửa trên dashboard chỉ hiện phiên bản cuối đã trả và còn có thể nộp lại: bài tự luận lớp hoặc Writing được phép xem kết quả, trong lớp hoạt động. Tối đa 100 mỗi loại, Writing xét 200 bản trả gần nhất trước khi lọc chính sách. Nhấn mở bài; nộp lại không thay đổi điểm thi gốc. Không bao gồm mọi nhận xét hay các bài chưa cho phép nộp lại.

Sổ từ vựng riêng có thể lưu từ tra trong bài học, ghi nguồn Lesson và lọc “From lessons”; từ sai trong bài và từ chọn hằng ngày cũng được lưu theo cơ chế hiện có. Lưu lại từ đã tồn tại cập nhật nguồn/định nghĩa thay vì tạo bản sao; tra từ cần dữ liệu từ điển khả dụng. Nguồn Lesson là chung, không ghi tên/ID bài; từ lưu trước thay đổi không tự phân loại lại và bộ lọc còn bao gồm WORDBANK. Ôn từ lặp dùng hộp Leitner hiện có, có bài ôn và nút tự đánh giá ngay trên sổ khi đến hạn: nhớ chuyển lên hộp và hẹn 1/2/4/8/16 ngày; chưa nhớ lùi hộp và đến hạn ngay. Không phải thông báo nhắc; thao tác đồng thời từ nhiều thiết bị có thể ghi đè. Danh sách lỗi thường gặp là sổ riêng do học viên tự nhập, sửa, tìm, xóa và tự điều chỉnh số lần gặp; sắp xếp theo số lần, không tự phân tích bài làm; tối đa 500 mục. Migration 0093 cần áp dụng. Theo dõi thời gian tự học bằng các lần ghi thủ công riêng tư theo ngày/kỹ năng, mỗi lần 1–600 phút, có sửa/xóa và tổng theo tháng; không tự thu thập thời gian làm bài hay cuộc gọi. Tối đa 2000 lần ghi/tài khoản; migration 0092 cần áp dụng. Checklist mục tiêu tuần cá nhân của học viên có tạo, sửa, đánh dấu/khôi phục và xóa; tuần bắt đầu thứ Hai theo ngày thiết bị, tối đa 50 mục/tuần và 2000 mục/tài khoản; không tự sinh từ bài giao. Migration 0091 cần áp dụng. Nhật ký học tập cá nhân dành cho tài khoản học viên; tối đa 4000 ký tự/ngày, lưu thủ công, để trống và lưu là xóa; cảnh báo khi đổi ngày hoặc đóng/tải lại trang nếu chưa lưu, chưa chặn mọi chuyển trang trong ứng dụng. Migration 0090 cần áp dụng. Ghim tài liệu là dấu trang riêng theo tài khoản và lớp, chỉ trên tài liệu giáo viên đang chia sẻ; không cấp thêm quyền, không hiện cho người khác, và không hiển thị khi tài liệu ngừng chia sẻ. Danh sách hiện tối đa 200 tài liệu, ghim được ưu tiên ở đầu; migration 0089 cần áp dụng trước khi dùng.

## Trao đổi lớp
- [x] 41. Trả lời tin nhắn theo luồng.
- [x] 42. Đề cập thành viên trong tin nhắn và luồng.
- [x] 43. Tìm kiếm lịch sử tin nhắn và tên tệp trong lớp.
- [x] 44. Đánh dấu tin chưa đọc cá nhân.
- [x] 45. Ghim tin nhắn lớp.
- [x] 46. Lên lịch thông báo.
- [x] 47. Hạn xác nhận thông báo.
- [x] 48. Chủ đề hỏi đáp theo bài.
- [x] 49. Trạng thái câu hỏi.
- [x] 50. Tắt thông báo hội thoại lớp theo thời gian.

Hỏi đáp theo bài giao trong Bảng lớp: thành viên có quyền với bài ACTIVE/CLOSED đăng câu hỏi và trả lời công khai cho giáo viên và học viên thuộc đối tượng bài; không tự lấy bài làm riêng. Trạng thái chưa trả lời/có trả lời/đã giải quyết, người hỏi hoặc giáo viên đóng/mở lại. Tối đa 200 câu/lớp, 100 trả lời/câu; làm mới thủ công, không có thông báo tự động; người hỏi hoặc giáo viên có thể xóa câu hỏi cùng trả lời, không sửa nội dung. Đối tượng thay đổi làm quyền xem thay đổi; migration 0101 cần áp dụng.

Bảng lớp có thể hẹn giờ hiển thị thông báo và đặt hạn xác nhận đọc trong vòng một năm. Giáo viên thấy và có thể xóa trước giờ, học viên chỉ thấy sau giờ máy chủ khi tải/làm mới bảng; không tự đẩy thông báo hay nhắc. Học viên vẫn xác nhận được sau hạn; giáo viên thấy tổng đã xác nhận, số đúng hạn và số học viên hiện hoạt, không liệt kê cá nhân; số thay đổi theo thành viên lớp. Không sửa giờ sau khi tạo. Migration 0100 cần áp dụng.

Tắt tiếng áp dụng cho thông báo được đề cập trong hội thoại của lớp trong 1 giờ, 8 giờ, 24 giờ hoặc 7 ngày; không xóa thông báo cũ, không tắt hạn bài/lịch hay nội dung lớp. Đến hạn tự hết; migration 0088 cần áp dụng trước khi dùng. Tin chưa đọc là đánh dấu thủ công riêng theo tài khoản, tối đa 100 tin/lớp; không tự phát hiện tin mới. Có thể mở luồng hoặc xóa dấu, kể cả trả lời; migration 0087 cần áp dụng trước khi dùng. Đề cập chọn tối đa 10 thành viên đang hoạt động từ danh sách (hiển thị tối đa 500); chỉ người được chọn nhận thông báo trong ứng dụng, lưu cùng tin trong một giao dịch. Văn bản @ gõ tay không tự gửi thông báo. Migration 0086 cần áp dụng trước khi dùng. Luồng gắn vào một tin gốc, hiển thị tối đa 100 trả lời mới nhất, không có lồng nhiều cấp; gửi trả lời từ giao diện hiện hỗ trợ văn bản. Tìm kiếm trả lời có thể mở lại luồng. Migration 0085 cần áp dụng trước khi dùng. Giáo viên chủ lớp, đồng giảng đang hoạt động và quản trị viên ghim hoặc bỏ ghim tối đa 20 tin/lớp; thành viên lớp xem được, học viên không thể sửa, lớp lưu trữ chỉ đọc. Migration 0084 cần áp dụng trước khi dùng. Tìm kiếm kiểm tra quyền thành viên ở máy chủ, tìm trong toàn bộ lịch sử, phân trang 30 kết quả theo thời gian và ID. Không tìm nội dung bên trong tệp; chữ có dấu hiện cần đúng chữ hoa/thường vì SQLite mặc định chỉ gấp chữ ASCII.

## Phòng học trực tuyến
- [x] 51. Bảng viết chung.
- [x] 52. Phòng thảo luận nhóm nhỏ.
- [x] 53. Giáo viên ghé phòng nhỏ và thông báo chung.
- [x] 54. Đếm giờ hoạt động nhóm.
- [x] 55. Hàng đợi phát biểu.
- [x] 56. Bảng câu hỏi trong buổi học.
- [x] 57. Khảo sát nhanh trong cuộc gọi.
- [x] 58. Giao diện riêng người trình bày/người xem.
- [x] 59. Kiểm tra camera, mic, loa trước khi vào.
- [x] 60. Tóm tắt buổi học.

Chủ trì đang ở phòng chính chia 2–4 phòng cho tối đa 200 người có mặt, theo thứ tự tham gia; từng người tự chọn vào phòng đã phân, chủ trì có thể ghé phòng và gửi thông báo tới phòng chính cùng các nhóm đang mở. Thông báo xuất hiện trong cuộc gọi/chat khi có mạng, không đảm bảo đã đọc. Hẹn 5–60 phút, đồng hồ còn lại theo giờ thiết bị; hết hạn máy chủ từ chối phòng nhóm, ứng dụng trở về màn hình chờ phòng chính khi kết nối/thăm dò, người dùng phải vào lại và không thể ép ngắt kết nối ngang hàng khi mất mạng. Có thể đóng sớm; không tự động chuyển hay phân lại người đến muộn. Mỗi lần mở dùng khóa phòng riêng để không lộ bảng/chat phiên cũ. Bảng vẽ chung theo phòng, tối đa 600 nét/800 điểm mỗi nét; các thành viên đang trong phòng vẽ hoặc hoàn tác nét cuối (kể cả nét người khác), chỉ chủ trì xóa bảng. Khi hai người lưu cùng lúc, phiên bản cũ bị từ chối và thông báo cần vẽ lại; không tự ghép nét. Có thử lưu lại khi lỗi mạng và cảnh báo khi đóng bảng với thay đổi chưa lưu, không bảo đảm khôi phục sau đóng trang. Khảo sát/quiz trong cuộc gọi cho chủ trì mở một câu hỏi mỗi phòng, thành viên đang có mặt chọn một đáp án một lần, kết quả tổng hợp cập nhật theo lượt thăm dò; đóng câu hỏi để xem lại kết quả, đáp án quiz chỉ hiện với học viên sau khi đóng. Không có danh sách cá nhân trong giao diện; dữ liệu lựa chọn vẫn lưu ở máy chủ, không tuyên bố ẩn danh. Hàng đợi phát biểu hiện trong danh sách thành viên, xếp theo thời điểm máy chủ ghi nhận giơ tay và cập nhật theo lượt thăm dò; người tham gia tự giơ/hạ tay, ra phòng hoặc vào lại sẽ rời hàng đợi. Các lần cùng millisecond dùng ID để phân định, không có thao tác hạ tay hộ. Migration 0094 cần áp dụng. Màn hình chờ xem camera, bật/tắt hoặc đổi thiết bị; đo mức mic tại máy theo yêu cầu mà không ghi âm/phát lại, phát âm ngắn để tự xác nhận loa. Người dùng phải cấp quyền và tự xác nhận nghe được; âm dùng đầu ra mặc định của trình duyệt, không chứng minh kết nối tới người khác.

Khi chia sẻ, người trình bày thấy màn hình mình chia sẻ được ưu tiên trong bố cục tự động, camera nhỏ nếu đang bật và thanh dừng trình bày; người xem thấy tên người trình bày và có thể chọn lưới hoặc ưu tiên màn hình trên thiết bị của mình. Lựa chọn không thay đổi giao diện người khác. Chỉ người được phép có thể bắt đầu chia sẻ; thông báo phụ thuộc trạng thái phòng, không xác nhận chất lượng kết nối hay bảo đảm người khác đã xem.

Chủ phòng có thể viết nhiều bản tóm tắt thủ công, lưu nháp, chia sẻ/thu hồi, sửa và xóa; mở trong cuộc gọi hoặc màn hình trước khi vào. Bản đã chia sẻ dành cho mọi người hiện có quyền vào phòng, kể cả người vắng mặt, không phải tự tạo từ ghi âm, không có thông báo; tối đa 100 bản/phòng. Cần lưu trước khi chuyển tab/đóng cửa sổ. Migration 0109 cần áp dụng.

Bảng câu hỏi trong cửa sổ Quiz của cuộc gọi hiển thị theo phòng chính/phòng nhóm, làm mới khoảng 4 giây khi mở. Người đang hiện diện gửi tối đa 200 câu/phòng, chủ phòng đánh dấu đã trả lời/mở lại; người hỏi hoặc chủ phòng xóa. Câu hỏi hiển thị cho người trong phòng, không phải tin riêng, không có trả lời dạng văn bản hay thông báo sau buổi. Migration 0108 cần áp dụng.

## Trường và nhân sự
- [x] 61. Tổ chuyên môn và người phụ trách.
- [x] 62. Hồ sơ năng lực giáo viên.
- [x] 63. Phân công lớp theo học kỳ.
- [x] 64. Phê duyệt đổi giáo viên phụ trách.
- [x] 65. Nhận diện giáo viên quá tải.
- [x] 66. Lịch nghỉ và ngày lễ.
- [x] 67. Hộp việc cần duyệt hiển thị số lượng và tối đa 100 giáo án chờ duyệt cũ nhất theo trường và quyền của người xem, không tính giáo án tự gửi; mở cửa sổ Duyệt giáo án để xử lý, cần bấm làm mới sau khi duyệt. Danh sách duyệt ưu tiên các mục đang chờ; không bao gồm yêu cầu đăng ký trường hay loại phê duyệt khác.

Nhật ký quản lý trường trong desktop dành riêng cho đại diện trường, hiển thị 100 thao tác cấp trường mới nhất (mời/gỡ nhân sự, phân quyền, liên kết lớp, banner, tổ, lịch và mẫu) cùng tài khoản và mã đối tượng nếu có; không chứa bài làm riêng. Sự kiện tổ/lịch/mẫu chỉ bắt đầu ghi sau bản cập nhật; phần lớn ghi best-effort sau thao tác nên có thể thiếu khi ghi lỗi, không phải nhật ký bất biến hoặc đầy đủ mọi thao tác. Phân quyền ghi cùng giao dịch và có chi tiết riêng trong Lịch sử quyền.

Mẫu thông báo cấp trường.
- [x] 68. Nhật ký thao tác quản lý.
- [x] 69. Lưu trữ học kỳ cũ.
- [x] 70. Hộp việc cần duyệt cho ban giám hiệu.

## Báo cáo
- [x] 71. So sánh tiến độ theo giai đoạn.
- [x] 72. Biểu đồ chuyên cần tuần/tháng.
- [x] 73. Tỷ lệ hoàn thành bài tập theo lớp.
- [x] 74. Phân tích câu hỏi khó.
- [x] 75. Kỹ năng ít được luyện.
- [x] 76. Mục tiêu giáo viên đặt cho lớp.
- [x] 77. Lịch sử can thiệp hỗ trợ.
- [x] 78. Mẫu báo cáo tùy chỉnh.
- [x] 79. So sánh lớp bằng dữ liệu tổng hợp.
- [x] 80. Giải thích cách tính chỉ số.

Phân tích câu hỏi trong Tiến độ kỹ năng hiển thị tối đa 50 câu theo số học viên từng trả lời sai, đồng thời hiện số lượt sai, chỉ bài ACTIVE/CLOSED và học viên đang hoạt động thuộc đối tượng. Chỉ câu đã chấm đúng/sai trong lượt nộp/hết giờ; làm lại tính thêm lượt, câu chưa chấm không tính. Có mẫu số, không có nội dung đáp án hay bài làm riêng; lượng sai không đồng nghĩa độ khó.

Lịch sử hỗ trợ tại Ghi chú riêng lưu ngày, việc và kết quả do giáo viên tự ghi; chỉ tác giả còn quyền vào lớp được xem/sửa/xóa, không chia sẻ học viên hoặc quản lý trường. Tối đa 100 mục mỗi học viên/lớp/tác giả; lớp lưu trữ chỉ đọc, học viên rời lớp không hiện. Không tự lấy từ lịch đặt hỗ trợ. Migration 0098 cần áp dụng.

So sánh giai đoạn trong Mục tiêu lớp dùng hai khoảng ngày tạo bài (tối đa 366 ngày/khoảng, UTC), hiển thị tỷ lệ hiện tại của các cặp học viên–bài theo đúng đối tượng và thành viên hiện hoạt. Tính bài đã nộp/hết giờ kể cả sau kỳ, không phải ảnh chụp lịch sử; bài hoặc thành viên thay đổi làm số thay đổi.

Phân bố kỹ năng tại Tiến độ kỹ năng của lớp đếm số lượt thi được nộp/hết giờ trong khoảng tối đa 366 ngày UTC, chỉ bài giao của lớp và học viên hiện hoạt thuộc đối tượng; mỗi lượt tối đa một lần/kỹ năng. Listening/Reading/Writing theo thời điểm nộp/hết giờ, Speaking đã nộp/chấm theo ngày tạo phiên. Nêu các kỹ năng cùng ít nhất, không đo thời gian luyện hoặc hoạt động cá nhân ngoài lớp; 0 có thể vì lớp chưa được giao bài kỹ năng đó.

Mục tiêu lớp cho phép chủ lớp hoặc admin tạo/sửa/xóa tối đa 50 mục tiêu tỷ lệ hoàn thành, đồng giảng xem; lớp lưu trữ chỉ đọc. So sánh với tỷ lệ học viên–bài đã nộp/hết giờ trên bài ACTIVE/CLOSED và thành viên hiện hoạt có trong đối tượng. Ngày mục tiêu chỉ để tham khảo, không tạo snapshot hay lọc theo thời gian, không tự thông báo hoặc chia sẻ học viên. Migration 0097 cần áp dụng.

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
- [x] 93. Cảnh báo đăng nhập bất thường.
- [x] 94. Lịch sử thay đổi quyền.
- [x] 95. Phân loại tài liệu nhạy cảm.
- [x] 96. Thời hạn lưu dữ liệu theo chính sách.
- [x] 97. Sao lưu và khôi phục.
- [x] 98. Cảnh báo mất kết nối và trạng thái lưu bài.
- [x] 99. Bảng tình trạng hệ thống.
- [x] 100. Kiểm tra người nhận trước khi chia sẻ.

Mẫu báo cáo cá nhân cho phép lưu/sửa/xóa tối đa 50 mẫu gồm tên, tiêu đề và khung nhận xét; áp dụng vào bản nháp của học viên sau khi xác nhận thay nội dung chưa lưu. Không lưu ngày hay số liệu, không tùy chỉnh các chỉ số thống kê hoặc bố cục; báo cáo vẫn cần lưu, duyệt và chia sẻ riêng. Giáo viên cần tự loại bỏ thông tin riêng trước khi lưu mẫu dùng lại. Migration 0111 cần áp dụng.

## Giao diện desktop giáo viên

Đã bổ sung cửa sổ Hôm nay, lịch tuần có kéo thả/đổi giờ, bộ lọc hàng chờ Writing và Speaking, tab lớp gọn, tìm kiếm trong Start, và lọc trung tâm thông báo. Bố cục nhanh và chế độ tập trung đã được gỡ theo yêu cầu. Bộ lọc hàng chờ chạy ở máy chủ, vẫn giới hạn 100 bài Writing / 50 Speaking mỗi lần tải; lớp trong thông báo được nhận diện từ đường dẫn hoặc tên trong nội dung. Mức “cần xử lý” chỉ là phân nhóm chấm bài/bài tập/lịch hẹn, không phải mức độ khẩn cấp do hệ thống xác định. Lịch tuần và biểu mẫu lịch kiểm tra trùng với lịch của tài khoản đang thao tác trên máy chủ; cảnh báo cho phép tiếp tục và không khóa chống trùng đồng thời; việc đổi giờ chỉ áp dụng cho buổi dạy của giáo viên và thông báo cho lớp theo cơ chế best-effort. Trên thiết bị hẹp, nút đổi giờ thay thế thao tác kéo thả.

Cảnh báo kết nối và lưu bài áp dụng trong giao diện làm bài thi: trạng thái lưu máy chủ, mất mạng, lỗi và nút thử lại; thử gửi lại khi có mạng. Bản nháp chưa gửi lưu cục bộ nếu trình duyệt cho phép; nếu lưu cục bộ bị chặn sẽ cảnh báo chỉ còn trong trang đang mở. Đồng hồ vẫn chạy và mất mạng có thể ảnh hưởng thời hạn; không cam kết nhận bài sau hạn. Không phải trạng thái lưu chung cho mọi ứng dụng.

Lịch sử thay đổi quyền hiển thị 100 lần gần nhất cho quyền quản lý trường, chỉ đại diện trường xem; lần mới ghi trạng thái trước/sau, người thao tác và nhân sự. Ghi lịch sử và đổi quyền thực hiện chung giao dịch; bản ghi cũ có thể thiếu trạng thái trước. Không bao gồm quyền ở các phạm vi khác, không phải nhật ký toàn hệ thống.

Cảnh báo đăng nhập mới trong trung tâm thông báo khi IP và user-agent khác mọi phiên còn lưu có thông tin trong 90 ngày gần đây; không báo ở lần đầu hoặc khi thiếu IP/user-agent, tối đa một cảnh báo mỗi 24 giờ. Cron xóa phiên hết hạn nên lịch sử thường ngắn hơn 90 ngày; khi không còn phiên cũ sẽ không cảnh báo. Đây là tín hiệu gần đúng, có thể sai hoặc bị giả mạo, không phân tích địa lý, không gửi email/push và không thay thế xác thực hai bước. Lỗi thông báo không chặn đăng nhập; trung tâm có nút làm mới.

Thư viện tài liệu cá nhân cho phép tác giả phân loại thông thường hoặc nhạy cảm. Tài liệu nhạy cảm không thể chia sẻ vào lớp; chuyển tài liệu đã chia sẻ sang nhạy cảm yêu cầu gỡ chia sẻ khi lưu, nhưng bản đã tải không thu hồi được. Nhãn thủ công, không quét nội dung, không mã hóa riêng; không áp dụng với tệp chat, giáo án hoặc toàn hệ thống. Tệp cũ mặc định thông thường. Migration 0103 cần áp dụng.

Xác thực hai bước dùng ứng dụng TOTP và 8 mã dự phòng dùng một lần; cấu hình trong Profile → Security, có giới hạn thử, ngăn đặt lại khi đang bật và kiểm tra mã khi tắt. Đăng nhập mật khẩu/mã email/liên kết email yêu cầu bước thứ hai; SSO hiện bị chặn khi bật 2FA, cần dùng các cách kia. Khóa TOTP hiện lưu trên cơ sở dữ liệu của ứng dụng; chưa mã hóa riêng bằng KMS. Cơ chế tìm ticket chỉ xét 20 yêu cầu mới nhất trên toàn hệ thống nên tải đăng nhập lớn có thể làm yêu cầu hợp lệ hết hiệu lực sớm. Mã dự phòng hết hạn sau 365 ngày; bước bật và cấp mã chưa phải một giao dịch nguyên tử, vì vậy cần hỗ trợ khôi phục nếu xảy ra lỗi giữa hai bước.

Phiên đăng nhập: Profile → Security liệt kê tối đa 30 phiên hoạt động gần nhất theo tài khoản, có IP/tác nhân trình duyệt và lần hoạt động, đăng xuất từng phiên khác hoặc tất cả phiên khác sau xác nhận; phiên đang dùng được giữ lại. Nhãn thiết bị/IP chỉ phản ánh thông tin phiên và có thể không chính xác. Máy chủ chặn thu hồi phiên của tài khoản khác.

Bảng Service status cho quản trị viên tại Settings: thời điểm kiểm tra, Worker, khả năng đọc D1 và độ đầy đủ schema; trạng thái AI/email chỉ cho biết cấu hình, lưu tệp bằng D1 và hàng đợi import là lựa chọn backend chứ không kiểm tra khả dụng. Không phải giám sát liên tục, không kiểm thử gửi email/AI hay kết nối thực tế đến nhà cung cấp.

Tổ bộ môn: quản lý trường hoặc người được cấp MANAGE_GROUPS tạo, sửa, xóa tổ và phân tổ trưởng cùng các thành viên hoạt động; tổ trưởng phải thuộc tổ. Không tự cấp vị trí tổ trưởng cho người quản lý được ủy quyền; giáo án đã gửi duyệt chặn xóa tổ để giữ lịch sử. Tài khoản bị khóa không được bổ nhiệm, không nằm trong danh sách thành viên đang hoạt động. Danh sách giới hạn 200 tổ/200 nhân sự; đây không phải phân công theo học kỳ.

Hồ sơ năng lực do nhân sự tự khai riêng theo trường đã duyệt (chuyên môn, bằng cấp và kinh nghiệm); mặc định riêng tư, có thể chia sẻ cho đại diện trường, rút chia sẻ hoặc xóa. Đại diện xem tối đa 200 hồ sơ được chủ động chia sẻ của nhân sự còn hoạt động, không có tệp chứng chỉ hay xác minh thông tin. Khi rời trường không xem được cho đến khi được nhận lại. Migration 0102 cần áp dụng.

Khối lượng giáo viên cho đại diện trường: tối đa 200 nhân sự đang hoạt động, số lớp liên kết đang hoạt động nơi họ chủ trì/đồng giảng và tổng thời lượng buổi do họ tạo, bắt đầu trong 7 ngày tới. Người xem tự điều chỉnh ngưỡng số lớp/giờ để đánh dấu cần xem xét; không tự kết luận quá tải, không gồm chấm bài, lịch ngoài, trùng lịch hoặc công việc khác, không có dữ liệu học viên.

Mẫu thông báo cấp trường được tạo/sửa/xóa bởi đại diện trường đã duyệt, tối đa 50 mẫu/trường. Mẫu lưu tên, tiêu đề, nội dung và màu của banner học viên, không lưu ảnh hoặc tự phát hành; khi áp dụng tạo bản nháp tắt hiển thị và cần chủ động lưu. Không áp dụng vào tin nhắn lớp hay gửi thông báo tự động. Migration 0096 cần áp dụng.

Lịch trường có loại sự kiện/ngày lễ/nghỉ trường, lọc và quản lý thủ công cho trường đã duyệt; nhân sự đang hoạt động xem, quản lý hoặc người được cấp quyền lịch sửa. Thời gian hiển thị theo thiết bị, tối đa 200 sự kiện mới theo thời điểm bắt đầu; không tự lấy ngày lễ, thay đổi lịch dạy, kiểm tra trùng hay gửi nhắc nhở. Migration 0095 cần áp dụng.

Tùy chọn tương phản cao và chữ lớn trong Cài đặt hình nền của desktop, lưu cục bộ theo tài khoản và có thể tắt lại. Kiểu áp dụng cho khung desktop và phần lớn nội dung trong cửa sổ; một số màn hình chuyên dụng/nội dung đặc biệt có thể cần dùng chức năng phóng to hoặc tương phản của hệ điều hành/trình duyệt. Chưa chứng nhận WCAG toàn bộ ứng dụng và không đồng bộ giữa thiết bị.

Kiểm tra người nhận trước khi chia sẻ **tài liệu trong thư viện cá nhân**: xem tên lớp, số học viên đang hoạt động và tối đa 100 tên, cùng cảnh báo giáo viên/đồng giảng/quản trị viên có quyền truy cập, thành viên có thể thay đổi và tệp đã tải không thu hồi được; xác nhận hoặc quay lại trước khi lưu. Máy chủ kiểm tra quyền chia sẻ và lớp hoạt động khi xem lẫn khi lưu. Đây không áp dụng cho mọi loại tin nhắn hoặc chia sẻ khác.

- **#16:** Chủ lớp/quản trị viên có thể chọn một bài tiên quyết cùng lớp trước khi bài đích có lượt làm. Học viên phải nộp bài tiên quyết (không tính hết giờ) trước khi bắt đầu; kiểm tra được thực thi lúc tạo lượt làm. Kiểm tra đối tượng bao phủ, tránh vòng lặp; không thể lưu trữ/chuyển về nháp bài đang là tiên quyết của bài chưa lưu trữ. Không sao chép điều kiện khi nhân bản, không xét điểm hay khóa lượt đang làm. Hạn nộp vẫn độc lập. Cần migration 0118.

- **#17:** Chủ lớp/quản trị viên lập tối đa 50 bước riêng cho từng học viên đang hoạt động, với ngày dự kiến tùy chọn; học viên tự đánh dấu/bỏ dấu. Đồng giảng có quyền lớp được xem; học viên chỉ xem lộ trình của mình. Các bước thủ công không phải bài nộp, điểm, nhắc hạn hay điều kiện bắt buộc; xóa bước xóa dấu, rời lớp mất quyền xem. Migration 0119 cần áp dụng.

- **#13:** Chủ lớp/quản trị viên gia hạn cho học viên đủ điều kiện trước hạn chung, tối đa 90 ngày sau hạn chung. Có thể gỡ trước hạn chung hoặc sau khi hạn riêng đã qua; không đổi hạn chung khi còn gia hạn. Danh sách bài, lịch, nhắc hạn và lượt mới dùng hạn riêng; hạn của lượt đang chạy không thay đổi. Chính sách kết quả AFTER_DEADLINE của Reading/Listening chờ hạn riêng muộn nhất của cả bài, kể cả khi học viên rời lớp; Writing tiếp tục quy tắc trả kết quả hiện có. Thay đổi cài đặt công bố hoặc kết quả đã được xem không thể thu hồi; không chống chia sẻ. Không tự thông báo khi gia hạn, bản sao không mang gia hạn, không chỉnh sau hạn chung. Migration 0120 cần áp dụng.

- **#63/#69:** Đại diện trường đã duyệt tạo tối đa 100 học kỳ và ghi nhận tối đa 500 phân công/kỳ cho giáo viên hiện là chủ lớp hoặc đồng giảng, có thành viên hoạt động cùng trường và lớp liên kết trường. Phân công chỉ là hồ sơ theo kỳ, giáo viên xem phần của mình trong Hôm nay; không tự cấp/thu hồi quyền lớp, tạo lịch hay gửi thông báo. Nếu quyền hoặc liên kết đổi thì hồ sơ kỳ mở được cảnh báo. Sau ngày kết thúc đại diện trường lưu trữ bản chỉ đọc gồm tên lớp/giáo viên, trạng thái quyền và số liệu tổng hợp tại thời điểm lưu; số học viên là thành viên hiện hoạt lúc lưu, bài là bài tạo trong kỳ và lượt đã nộp/hết giờ của những bài đó, không phải lịch sử thành viên tại từng ngày. Lớp nhiều giáo viên lặp số liệu, không cộng các dòng. Không có bài làm cá nhân, không khóa/xóa lớp, không phải sao lưu dữ liệu hay phục hồi. Migration 0121 cần áp dụng.

- **#64:** Đại diện trường đã duyệt tạo yêu cầu đổi giáo viên chủ lớp sang giáo viên hoạt động cùng trường; giáo viên cũ và mới từng người đồng ý hoặc từ chối, sau đó đại diện trường xác nhận chuyển. Khi chuyển, chủ lớp mới nhận quyền lớp và bài làm được phép; chủ cũ mất quyền chủ lớp và đồng giảng (nếu có), nhưng thành viên học viên riêng của họ không bị xóa. Vai trò chủ phòng gọi được cập nhật, nhãn trường phòng được bỏ để chọn lại; lớp và lịch sử tác giả bài không bị đổi. Từ chối chuyển nếu còn người trong phòng, lịch dạy hoặc lịch hỗ trợ của chủ cũ chưa kết thúc; các lịch và ghi chú riêng không chuyển. Hai bên nhận thông báo trong ứng dụng theo cơ chế best-effort; yêu cầu và trạng thái được lưu. Dữ liệu đã tải không thu hồi được. Migration 0122 cần áp dụng.

- **#96:** Chính sách lưu giữ cá nhân theo hai lựa chọn độc lập, mặc định tắt: việc đã hoàn thành (tính từ thời điểm hoàn thành) và tổng kết ngày (tính từ lần sửa cuối), chọn 90/180/365 ngày. Việc đang ủy quyền chưa hết hạn được bỏ qua. Sau xác nhận bật, cron xóa vĩnh viễn tối đa 500 mục mỗi loại/lần; có thể xem số mục đủ điều kiện và chủ động xóa ngay sau xác nhận. Không áp dụng cho lớp, bài làm, nhật ký học viên hay dữ liệu trường; không đảm bảo giờ chạy và không thu hồi bản tải xuống. Cần migration 0123, 0126 và cron hoạt động.
- **#97:** Sao lưu/khôi phục thủ công dữ liệu giáo viên sở hữu: tối đa 500 việc, 365 tổng kết gần nhất và mẫu bài giao/nhận xét/báo cáo; ngân hàng câu hỏi cùng media và tài nguyên tải riêng theo từng nhóm tối đa 5 mục; giáo án riêng và tối đa 5 tệp đang dùng tải tại cửa sổ giáo án. File JSON không mã hóa cần tự lưu an toàn. Khôi phục vào cùng tài khoản; dữ liệu cá nhân/ngân hàng/tài nguyên chỉ thêm mục còn thiếu, không ghi đè; tài nguyên khôi phục mặc định riêng tư. Giáo án chỉ khôi phục vào cùng trường khi còn là nhân sự hoạt động, tạo bản riêng mới và không khôi phục lịch sử hay gửi duyệt. Khi vượt giới hạn, giao dịch không thay đổi dữ liệu. Không bao gồm lớp, quyền ủy quyền, bài làm học viên hoặc mọi dữ liệu khác; không phải sao lưu/khôi phục thảm họa toàn hệ thống. Dữ liệu đã khôi phục vẫn chịu chính sách #96 đang bật.

- **#30:** Phiên bản đã được giao, kể cả thành phần đệ quy trong mock, được bảo vệ tại cơ sở dữ liệu: nội dung, đáp án, tên/loại đề, cấu hình và tài sản liên quan không thể sửa hoặc xóa; lưu trữ vẫn được phép, thay đổi cần tạo phiên bản/đề mới. Tải file vào D1 thực hiện nguyên tử và không thể giao khi file chưa sẵn sàng; hard-delete kiểm tra trong cùng giao dịch. Các URL bên ngoài và tệp đóng gói có thể thay đổi hoặc mất ở nơi lưu trữ bên ngoài, không thể cam kết bất biến byte; cấu hình chấm điểm fallback có thể thay đổi. Cần migration 0124–0125 (schema bootstrap cũng cài trigger).
