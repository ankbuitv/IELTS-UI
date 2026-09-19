# Hướng dẫn tạo câu hỏi (Question authoring guide)

Tài liệu này dành cho giáo viên và quản trị viên: cách đưa nội dung đề thi vào
nền tảng, viết câu hỏi cho từng dạng, và khai báo đáp án kèm *evidence* /
*explanation* để màn hình giải thích sau khi nộp bài có dữ liệu hiển thị.

> Đọc kèm: [`docs/samples/cities-knowledge-and-adaptation.json`](samples/cities-knowledge-and-adaptation.json)
> là một đề Reading hoàn chỉnh (3 passage, 3 section, 4 group). File này chạy
> được ngay: dán vào **Administration → Imports → Paste JSON**.
>
> Đề thi đầy đủ: [`docs/samples/full-test.json`](samples/full-test.json) là một
> **FULL_MOCK 1-file** — Listening (câu 1–10), 3 passage Reading (11–50) và 2
> Writing task (51–52) nằm chung trong **một** JSON, mọi section khai báo ngay trong
> `sections[]`, **không cần** cấu hình mock components. Khi start, nền tảng tự gom
> các section cùng kỹ năng liên tiếp thành 3 phần Listening → Reading → Writing
> (thời lượng mặc định 30′/60′/60′). Định dạng này chỉ chạy được khi repo đã có
> bản vá "Support one-file full mocks" (`inlineMockComponentRows` trong
> `src/worker/services/attempt-service.ts`); bản cũ hơn sẽ báo
> `MOCK_WITHOUT_COMPONENTS` khi publish. Trường `audioUrl` của file là một asset
> id (`ast_…`) chỉ tồn tại trên production: ở đó Apply chạy bình thường; trên DB
> local chưa có asset này, Apply sẽ bị chặn với *"One of the referenced assets
> (section audio) no longer exists"* — hãy thay `audioUrl` bằng một URL `https://`
> (hoặc tạo asset cùng id trong Settings → Assets) rồi Apply lại.

---

## 1. Có hai đường để tạo đề

| Đường | Khi nào dùng | Đi tới |
| --- | --- | --- |
| **Import JSON** | Có nội dung ở dạng file/paste, muốn nền tảng tự tách passage, group, đáp án | Administration → **Imports** → *Upload* hoặc *Paste* |
| **Soạn tay** | Số câu ít, muốn sửa từng câu trên giao diện | Administration → **Tests** → *New test* → **Editor** |

Cả hai đường đều ghi vào cùng một mô hình dữ liệu (test → version → section →
group → question → answer key), nên có thể import rồi chỉnh tay tiếp.

### Luồng import

1. `POST /api/imports` (upload file `.json`, `.txt`, `.md`) hoặc
   `POST /api/imports/paste` (dán text/JSON). Nội dung được lưu nguyên văn, xử lý
   ở background qua queue — không cần giữ file.
2. `POST /api/imports/:id/process` — nền tảng nhận dạng định dạng và tạo **draft**
   (bản nháp) gồm các section/group/question, kèm danh sách `issues`
   (`ERROR` chặn publish, `WARNING` chỉ để xem lại).
3. `GET /api/imports/:id/extracted` — xem lại văn bản đã tách.
4. `POST /api/imports/:id/apply` — ghi draft vào test version. Kiểm tra tự động
   của nền tảng sẽ báo lỗi nếu thiếu đáp án, trùng số câu, sai loại câu hỏi…
5. `POST /api/imports/:id/discard` — bỏ draft.

---

## 2. Định dạng JSON đầy đủ (khuyên dùng)

Đây là định dạng "sectioned" — mỗi section là một Passage / Part / Task, trong đó
`questionGroups` là các nhóm câu hỏi:

```jsonc
{
  "testTitle": "Cambridge 18 – Test 2",
  "testType": "READING",            // READING | LISTENING | WRITING | FULL_MOCK
  "durationSeconds": 3600,          // tuỳ chọn, đặt thời lượng cả đề
  "sections": [
    {
      "sectionNumber": 1,           // hoặc "type": "reading_passage"
      "type": "reading_passage",    // reading_passage | listening_part | writing_task
      "title": "The rise of urban farming",
      "label": "Passage 1",         // nhãn hiển thị; bỏ trống sẽ tự đánh số
      "instructions": "You should spend about 20 minutes on Questions 1–13.",

      "passage": {
        "title": "The rise of urban farming",
        "paragraphs": [
          { "label": "A", "text": "First paragraph…" },
          { "label": "B", "text": "Second paragraph…" }
        ]
      },

      // Listening: hoặc "audioUrl", hoặc "audio": { "url": "https://…" }
      "audio": { "url": "https://example.com/part1.mp3" },
      "transcript": {
        "segments": [
          { "id": "ls1-01", "startSeconds": 0,   "speaker": "Narrator", "text": "Section 1…" },
          { "id": "ls1-02", "startSeconds": 14,  "speaker": "Female",   "text": "Good morning…" }
        ]
      },

      "questionGroups": [
        {
          "questionType": "NOTE_COMPLETION",
          "instructions": "Write ONE WORD AND/OR A NUMBER for each answer.",
          "fromQuestion": 1,
          "toQuestion": 4,
          "configuration": { "wordLimitMax": 1 },
          "questions": [
            {
              "number": 1,
              "prompt": "The festival is held on [[1]] every year.",
              "answer": "2nd July",
              "evidence": "segment:ls1-02",       // cho Listening: nhảy tới đúng câu thoại
              "explanation": "Người nói đọc ngày tổ chức festival ngay sau lời chào."
            }
          ]
        }
      ]
    }
  ],

  // Tuỳ chọn: bảng đáp án tách riêng ở cấp đề. Câu nào đã có "answer" ở trên thì
  // giá trị trong group được ưu tiên.
  "answerKey": [
    { "questionNumber": 1, "acceptedAnswers": ["2nd July", "second of July"], "evidence": "…", "explanation": "…" }
  ]
}
```

### Chi tiết từng trường

| Trường | Bắt buộc | Ghi chú |
| --- | --- | --- |
| `testType` | ✅ | `READING`, `LISTENING`, `WRITING`, `FULL_MOCK` |
| `sections[].type` | nên có | `reading_passage` / `listening_part` / `writing_task`; chấp nhận cả `READING`, `part`, `task`… |
| `sections[].passage.paragraphs` | Reading | Mảng `{ label, text }`. Chỉ cần `text`; thiếu `label` nền tảng tự đánh A, B, C… |
| `sections[].audio` / `audioUrl` | Listening | URL công khai. Với đề thi thật nên upload qua Media rồi dán URL nội bộ. |
| `sections[].transcript.segments[]` | Listening | `id`, `startSeconds`, `speaker`, `text`. Transcript chỉ hiện ở màn hình review, không hiện khi đang làm bài. |
| `questions[].prompt` | ✅ | Với dạng completion, đặt `[[n]]` tại chỗ trống (xem §4). |
| `questions[].answer` | ✅ | Xem §5. Có thể thay bằng `answerKey` cấp đề. |
| `configuration.wordLimitMax` | Completion | Số từ tối đa; hiển thị trong banner hướng dẫn. |
| `configuration.selectCount` | MCQ nhiều đáp án | Ví dụ chọn 2 trong 5. |
| `configuration.optionNumbering` | Matching | `roman` \| `alpha` \| `numeric` — cách đánh số option bank. |
| `configuration.minimumWords` | Writing | Số từ tối thiểu (Task), hiển thị cho thí sinh. |

Ngoài ra nền tảng vẫn nhận **định dạng AI cũ** (`passages[]` + `sections[].groups[]`
với `questionType` phẳng) để tương thích với các draft đã sinh trước đây. Định dạng
có `questionGroups` là định dạng nên dùng cho nội dung mới.

---

## 3. Các loại câu hỏi được hỗ trợ

`questionType` (hoặc `type`) phải là một trong các giá trị sau — viết hoa, hoặc
viết thường snake_case đều được:

| Nhóm | `questionType` | Kỹ năng | Ghi chú |
| --- | --- | --- | --- |
| Đúng/Sai | `TRUE_FALSE_NOT_GIVEN` | Reading | 3 lựa chọn TRUE / FALSE / NOT GIVEN |
| Đúng/Sai | `YES_NO_NOT_GIVEN` | Reading | YES / NO / NOT GIVEN |
| Trắc nghiệm | `MCQ_SINGLE` | Reading, Listening | 1 đáp án đúng |
| Trắc nghiệm | `MCQ_MULTI` | Reading, Listening | `configuration.selectCount` |
| Nối | `MATCHING_INFORMATION` | Reading | cần `options` (option bank) |
| Nối | `MATCHING_HEADINGS` | Reading | `configuration.optionNumbering` |
| Nối | `MATCHING_FEATURES` | Reading | nối với danh sách đặc điểm |
| Điền | `SENTENCE_COMPLETION` | Reading, Listening | đặt `[[n]]` trong `prompt` |
| Điền | `SUMMARY_COMPLETION` | Reading, Listening | `[[n]]` trong đoạn tóm tắt |
| Điền | `NOTE_COMPLETION` | Listening | notes form |
| Điền | `TABLE_COMPLETION` | Listening | bảng |
| Điền | `FLOWCHART_COMPLETION` | Listening | sơ đồ quy trình |
| Trả lời ngắn | `SHORT_ANSWER` | Reading, Listening | giới hạn từ qua `wordLimitMax` |
| Viết | `WRITING_TASK_1`, `WRITING_TASK_2` | Writing | chấm tay bởi giáo viên |

Sai `questionType` → import **bỏ group đó** và ghi một `ERROR`; draft vẫn còn để
sửa nhưng không publish được.

---

## 4. Viết đề completion: dấu `[[n]]`

Dạng completion (sentence/summary/note/table/flowchart) hiển thị câu hỏi như một
form có ô điền số. Ô điền được đánh dấu bằng `[[n]]` trong `prompt`:

```jsonc
{
  "questionType": "SUMMARY_COMPLETION",
  "instructions": "Complete the summary. Write NO MORE THAN TWO WORDS.",
  "configuration": { "wordLimitMax": 2 },
  "questions": [
    { "number": 6, "prompt": "Urban farms reduce the [[6]] of transporting food.", "answer": "cost" },
    { "number": 7, "prompt": "They also lower a city's [[7]].", "answer": "temperature" }
  ]
}
```

Quy tắc:

- `[[n]]` phải trùng `number` của câu hỏi trong cùng group; mỗi số chỉ xuất hiện một lần.
- Nếu `prompt` không có `[[n]]`, nền tảng vẫn render câu hỏi dạng text + ô trả lời riêng.
- Với `TABLE_COMPLETION`, đặt `[[n]]` ngay trong ô của bảng, mỗi ô một số.

---

## 5. Đáp án: một giá trị, nhiều cách viết, chấm tự động

Ô `answer` có thể là:

```jsonc
"answer": "cost"                                  // một đáp án
"answer": "cost | expense | expenditure"          // nhiều cách viết được chấp nhận (ngăn cách bởi dấu |)
```

Hoặc khai báo ở bảng đáp án cấp đề:

```jsonc
"answerKey": [
  { "questionNumber": 6, "acceptedAnswers": ["cost", "expense"] }
]
```

Cách chấm (đối chiếu `src/shared/answer-key.ts`):

- **Chuẩn hoá**: trim, gộp khoảng trắng, bỏ qua hoa/thường.
- **TFNG / YNN / MCQ**: so khớp `id` của option (`TRUE`, `B`, `iii`…). Đúng số đáp
  án của `selectCount` mới được điểm (MCQ nhiều đáp án chấm tất-cả-hoặc-không).
- **Completion / Short answer**: so khớp với danh sách đáp án được chấp nhận;
  giới hạn từ (`wordLimitMax`) được kiểm tra và ghi chú khi thí sinh vượt.
- Điểm mỗi câu mặc định 1; điểm của group được cộng theo số câu.

> Đáp án **không bao giờ** được gửi xuống trình duyệt trong lúc làm bài: payload
> của attempt chỉ chứa câu hỏi và lựa chọn. Vì vậy bảng "Làm đúng x/y" chỉ có ở
> phần review sau khi nộp.

---

## 6. `evidence` và `explanation` — dữ liệu cho panel "Giải thích"

Sau khi nộp (và khi kỳ thi cho phép xem lại), mỗi câu hỏi có thể kèm:

- `evidence`: câu/dẫn chứng trong passage hoặc transcript.
  - Dạng văn bản tự do: `"Paragraph C: 'the cost of transport…'"`.
  - Dạng trỏ tới transcript: `"segment:ls1-05"` → màn hình Listening hiện nút
    **Listen from here** và tua audio tới đúng đoạn thoại đó.
- `explanation`: lời giải thích, nên nêu cả lý do loại đáp án sai.

Cả hai nằm ngoài `prompt` nên không rò rỉ thông tin khi thí sinh đang làm bài;
màn hình review chỉ hiển thị chúng khi attempt đã được release.

---

## 7. Checklist trước khi publish

- [ ] Mỗi section có `type` (hoặc `skill`) và ít nhất một `questionGroup`.
- [ ] Số câu liên tục, không trùng giữa các group (1–13, 14–26…).
- [ ] Mọi câu có `answer` (hoặc có dòng trong `answerKey`).
- [ ] `wordLimitMax` khớp với hướng dẫn in trong `instructions`.
- [ ] `[[n]]` xuất hiện đúng một lần cho mỗi câu completion.
- [ ] Listening: có `audio` và (nên có) `transcript` để review hoạt động.
- [ ] Chạy **Imports → Apply** và xem danh sách `issues`; sửa hết `ERROR`.
- [ ] Mở đề ở chế độ preview (staff) để xem banner, ô điền và màu lựa chọn.

---

## 8. Lỗi thường gặp

| Triệu chứng | Nguyên nhân | Cách sửa |
| --- | --- | --- |
| `AI_UNKNOWN_QUESTION_TYPE` | sai `questionType` | dùng đúng giá trị trong §3 |
| `INVALID_SECTION_TYPE` | sai `type` của section | dùng `reading_passage` / `listening_part` / `writing_task` |
| Câu completion không hiện ô điền | thiếu `[[n]]` trong `prompt` | thêm `[[n]]` khớp `number` |
| Đáp án luôn sai | `answer` không khớp `id` của option | với MCQ/TFNG dùng `id` (`TRUE`, `B`…), không dùng nội dung hiển thị |
| Panel giải thích trống | thiếu `evidence` / `explanation` | bổ sung ở câu hỏi hoặc trong `answerKey` |
| Audio không phát | URL không công khai hoặc sai định dạng | upload qua Media, dán lại URL |

---

## 9. Kiểm tra bằng dòng lệnh

```bash
# Đưa đề mẫu vào môi trường local
npm run db:migrate:local
npm run db:seed:local

# Chạy test của bộ import / answer key
npx vitest run tests/unit/import-conversion.test.ts tests/unit/import-validation.test.ts tests/unit/answer-key.test.ts
```

Sau khi import, mở **Administration → Tests & content → (đề) → Editor** để xem
cấu trúc section/group/question mà nền tảng đã dựng, và dùng nút **Candidate
preview** trong editor (chế độ staff, không kèm đáp án) để kiểm tra giao diện
làm bài trước khi giao cho lớp.
