---
version: 1
slug: "src-client-pages-student-dashboard-tsx"
primary_target: "src/client/pages/student/Dashboard.tsx"
related_targets: ["src/client/components/AppShell.tsx"]
---

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

Chosen direction: **Catppuccin** — owner-pinned 2026-10-22 via the structured
question ("catpuccin"), which revokes the Character Goods Catalog pin of
2026-10-21. A Latte-flavour ground with a mauve commitment: cool pastel
surface ladder, one saturated accent (mauve) doing all the pointing, slate ink,
a single grotesque family (Be Vietnam Pro) for display and body; Mocha takes
the dark bands and the call room. First surface = the shell plus the student
dashboard rebuilt in this world.
Memorable moment: the four skills as pastel-tinted cells with bands and the
estimate label — one roster, one system — where the only loud element on
screen is the mauve pill (active nav, primary CTA).

## Direction contract

<!-- impeccable:direction-contract 2 -->

THESIS: The dashboard a learner opens every night is a working instrument on
a tinted ground: white cards on Latte base, hierarchy carried by weight and
space, and exactly one loud colour — mauve — doing all the pointing (active
nav, primary CTA, current item). Refuses BOTH category defaults: interchangeable
blue-SaaS chrome (grey page, grey borders, blue accent) and the previous pin's
toy-shop pastel overload.

OWN-WORLD: Catppuccin Latte ground #EFF1F5, white paper cards, #F6F8FC nested
surfaces; slate ink scale #34364A (headings) / #4C4F69 / #6C6F85 (body) /
#8C8FA1 (muted) with #E6E9EF rules; mauve commitment #8839EF (white 5.4:1),
hover #7530D1, tints #F4ECFE → #DCC5FB; pastel cell fills derived from the
four skill hues — lilac #ECE4FB, mint #E0EFE4, sky #E2EBFA, butter #F8ECD6;
role hues info blue #1E66F5, teal #0B7A75, amber #B35408, speaking pink
#A63174; success #2F7D1F, danger #D20F39; gold #DF8E1E for streaks/XP. Dark
bands, footer and the call room flip to Mocha #1E1E2E / #181825 / #313244 with
#CDD6F4 text and #CBA6F7 mauve accents. Display + body: Be Vietnam Pro
400–800, self-hosted woff2 with the vietnamese subset (mandatory); display
= 700/800 at −0.03em, body 500, numerals tabular. Cards 14–24px radius, pill
buttons with a 2px darker lip, shadow 0 6px 18px rgba(76,79,105,.09).
Ornament: none — colour blocks, weight steps and the original mark carry
identity; no gradients-as-decoration, glass, glow or emoji.

STORY: The learner lands, reads the greeting and today's one action, scans the
four skill cells (tint + band + estimate label), checks the deadline (with its
clock), glances at the weekly leaderboard and leaves through "Bắt đầu thi" or
the next lesson. They believe: this is mine, it is calm, and the estimate is
honestly labelled.

FIRST VIEWPORT (1440×900): 76px icon rail on the Latte ground (six icons,
mauve active pill, hover names, everything else grouped behind "More"); top
bar with the mark, "480 xu" gold chip, avatar; headline "Xin chào Minh An!"
(~38px, 800) + band line; left 2/3: four skill cells in ONE row — Đọc sky,
Nghe mint, Viết butter, Nói lilac — each with glyph, band, estimate label and
thin bar; the deadline row (clock, red hour line) and the Learn strip (streak,
XP, coins, goal ring). Right 1/3: "Bảng xếp hạng tuần" card and the
next-lesson cell. Everything above the fold.

FORM: no form roll — the direction is user-pinned (Catppuccin, 2026-10-22);
a pinned direction beats the roll per new-work.md. Flavour mapping: app =
Latte (light), call room + dark band + dark display theme = Mocha.

FINISH: unreviewed and undocumented is unfinished. This world ends with
DESIGN.md (token-bearing) written and PRODUCT.md's binding look re-recorded.
The pixel finish review (screenshots at 1440 + 390) is blocked this session —
browser MCP disconnected, disclosed to the user; it runs as soon as a browser
session is back.
