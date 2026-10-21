# Surface: Student dashboard + app shell (first surface of the redesign)

Mode: operate. Desktop-first working screen (1440 base, responsive to 390).

Audience: Vietnamese IELTS candidates (self-study at home, phone or laptop,
evenings) plus the teacher/admin shells that inherit this system later.
Job: land, read where I stand (bands, streak, deadline), and start the next
action (a test, a lesson, an assignment) in one move.
Task: one primary action per region; state always readable at a glance
(estimate vs official is always labelled; deadlines always carry their clock).
Proof/content: real dashboard data only — estimates, recent attempts,
assignments from classrooms, Learn strip (XP/coins/streak). No invented claims.
Constraints: Vietnamese-first learner copy; every band labelled "Thực hành —
không phải kết quả chính thức"; no emoji in UI; server-truth untouched (this is
a visual rebuild only).

Chosen direction: **Character Goods Catalog** (pop-culture-shelf-character-goods-catalog,
competitive verdict that won the hand). A pastel roster world: cream ground,
per-cell pastel color-blocking, rank ribbons, name plates, rounded bubble
display face. First surface = the shell plus the student dashboard rebuilt in
this world.
Memorable moment: the four skills as a pastel roster with rank ribbons and
name plates — the learner's own cast — with the deadline as the one butter
cell that raises its voice.

## Direction contract

<!-- impeccable:direction-contract 1 -->

THESIS: The dashboard a learner opens every night is their own cast of skills
— a pastel roster with rank, name plate and one-line state — not another
neutral stat wall. Refuses the category default: white cards + grey borders +
blue accent, one flat canvas, hierarchy by size only.

OWN-WORLD: Ground cream #FFF6E8; pastel cell fills lilac #EDE4FF, mint
#E6F7EF, sky #E3F1FF, butter #FFF0B8; ink navy #2A2F5A for all text; ribbon
pink #FF6BA7 as the single saturated accent (primary buttons, active pills,
rank-1 ribbon); mint ribbon #7FD8B4, sky ribbon #8FC1F5, butter ribbon
#F5C84C as rank/skill roles. Display face Baloo 2 800 (bubble, tight);
body Quicksand 500/700. Cells: 18-24px radius, fill = pastel block, soft
shadow 0 6px 18px rgba(42,47,90,.08), hairline none — separation by fill and
space. Pill buttons, pill nav (active = lilac pill with ink text), pill name
plates under figures. Sparkle/star glyphs as the only ornament, inline SVG.

STORY: The learner lands, sees the greeting and today's one action, reads the
four skills as ranked cells with bands on name plates, checks the butter
deadline cell (with clock), glances at the weekly leaderboard column with rank
ribbons, and leaves through "Bắt đầu thi" or the next lesson. They believe:
this is mine, it is friendly, and the estimate is honestly labelled.

FIRST VIEWPORT (1440×900): top pill nav bar on cream (logo "Ai eo" in Baloo
800 with sparkle, pill links Trang chủ active / Luyện thi / Học tập / Kết quả /
Từ vựng / Từ điển, right: pink "480 xu" chip, pink pill CTA "Bắt đầu thi",
avatar). Below: headline "Xin chào Minh An!" (~38px Baloo) + band line; left
2/3: four pastel skill cells in a row (Đọc sky, Nghe mint, Viết butter, Nói
lilac) each with glyph, band on name plate, thin progress bar; then the
deadline cell (butter fill, small ribbon, red clock line "Còn 6 giờ", pink
"Làm bài" pill) beside the Learn strip card (streak flame + XP + coins + daily
goal ring). Right 1/3 column: "Bảng xếp hạng tuần" card (four ranked rows,
rank ribbons 1-4, XP figures) and the next-lesson cell with Bơ's face (inline
SVG blob) and "Matching Headings — Bậc 6.5". Everything above the fold.

FORM: chosen form position 4 of the ordered seven (grounded list: sticker
sheet, transit line map, notebook & red pen, character goods catalog [chosen
via challenger win], board game route, riso zine, scoreboard). seed:
d1c9294b13126b2d

FINISH: unreviewed and undocumented is unfinished; this build ends with the
finish review, the verdict, DESIGN.md, and every shipping raster carrying its
provenance.
