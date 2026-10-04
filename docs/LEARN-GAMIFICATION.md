# Learn: mascot, sounds, coins, shop, quests and leaderboards

> What was added to the Learn path, why each piece exists, and where it lives.
> Everything below is implemented and tested; the one thing that depends on a
> configured AI provider is the Vietnamese translation of a whole sentence
> (it degrades to the word's own gloss when no provider answers).

## The shape of a session

1. `/learn` opens with the **arena**: the mascot, the streak, total XP, coins and
   the daily-goal ring, plus a one-press "continue" into the next lesson.
2. A **lesson** plays full screen with a creature that reacts to every answer, a
   sound for every event, hearts, hints, coins and a feedback panel that shows
   the whole sentence, its Vietnamese rendering and the word's meaning.
3. Finishing pays **XP and coins**, settles any **daily quest**, and can spend a
   **streak freeze** if a day was missed.
4. **Coins** are spent in `/learn/shop` on a hint, a heart refill, a streak
   freeze or 30 minutes of double XP.
5. `/learn/leaderboard` shows two boards: XP on the Learn path, and submitted
   tests on the Practice side.

## The mascot

`src/client/components/learn/Mascot.tsx` — **Bơ**, an original round sprout-bird
drawn as SVG (body, belly, wings, feet, a leaf on its head, blush). No third-party
character, no image files.

Seven moods, each legible at every size and each with its own motion:
`idle` (breathe), `happy` (hop), `sad` (droop, with a falling tear), `wow`
(shake, sparkles), `think` (sway, eyes to the side, a "?"), `wave` (flapping
wing), `sleep` (closed eyes, drifting "z z"). `reactionTo(verdict)` is the single
place that maps an answer to a mood and a line, so the lesson player and the
review player describe the same verdicts the same way.

## Sound: one effect per event

`src/client/lib/sfx.ts` is a small WebAudio synth — no audio files, nothing to
download — with **26 named effects**, each distinct in pitch, shape and texture:

| Event | Sound | Event | Sound |
|---|---|---|---|
| choosing an option | `tap` | buying | `buy` |
| picking a card up | `select` | coins paid | `coin` |
| a pair matching | `match` | double XP switched on | `boost` |
| a right answer | `correct` | a freeze spent | `freeze` |
| right answers in a row | `combo` (climbs a pentatonic ladder) | the streak growing | `streak` |
| five in a row, then every five | `milestone` (a longer arpeggio per tier) | | |
| right, with a slip | `almost` | daily goal reached | `dailyGoal` |
| a wrong answer | `wrong` | a new band opening | `levelUp` |
| a heart lost | `heartLost` | a lesson opening | `lessonStart` |
| out of hearts | `outOfHearts` | a lesson finished | `complete` |
| a hint used | `hint` | a perfect lesson | `perfect` |
| the answer revealed | `reveal` | a lesson lost | `fail` |
| a lesson unlocked | `unlock` | something failed to save | `error` |
| moving on | `whoosh` | | |

Rules that keep it from being noise: everything is a no-op while muted, before
the first user gesture, or on a browser without WebAudio; every voice is short
(30 ms–700 ms) and quiet (a master gain of 0.5, with each note well below it);
noise bursts come from a generated buffer rather than an oscillator, because a
thud needs texture, not pitch; and each voice is disconnected when it ends.

The **soundboard** in the shop lists all of them with a play button, so "turn the
sound off" is an informed choice. Auditions ignore the mute switch — that is the
point of them.

## Effects

`src/client/components/learn/Effects.tsx`: `Confetti` (28 pieces for a combo, 60
for a lesson, 120 for a perfect one, 68/96/124 for a milestone tier),
`FloatingAward` (the "+1 XP", "−1 heart",
"+N coins" that rises from the footer), `ComboBadge` ("×3 in a row"), `ScreenFlash`
(a green, red, gold or violet wash), and `StreakPulse` (a ring out of the flame).
They are `aria-hidden`, keyed by a burst number so the same effect can fire twice,
and switched off under `prefers-reduced-motion` — colour and number still carry
the meaning.

**Milestones.** A run of five first-try answers is not just a bigger badge, so it
gets its own banner: `comboMilestone(combo)` (a pure function, unit-tested) says
which run counts and what tier it is, and `ComboMilestone` draws it — Bơ in its
`wow` mood, the count, one line of encouragement, its own fall of confetti
underneath and two rings pushing out from behind the card, in the middle of the
lesson for 2.6 s (the banner fades itself out with one keyframe; no JS timer).
Three tiers, each a different colour, a longer `milestone` arpeggio and more
confetti: gold at **×5** (68 pieces), brand red at **×10** (96), violet from
**×15** upwards and every five after that (124). `burst` is a counter, not a
clock — two runs of five must never share a React key, or the second banner
would reuse the first one's finished animation. The old rule is unchanged
underneath: `ComboBadge` still appears at three and grows with the run, and a
wrong answer puts the counter back to zero.

## Coins, quests and the shop

`src/shared/shop.ts` holds the pure rules the Worker and the browser both read;
`src/worker/services/learn-shop-service.ts` is the only place that moves a
balance.

**Earning** — a lesson pays `4 + right answers + 4 for a perfect run` (halved on a
repeat); a review pays 1 per word plus 2 for a clean sweep; the first activity of
any day pays 10; each daily quest pays its own amount.

**Quests** — finish 2 lessons (+15), review the notebook (+8), reach the daily XP
goal (+10). A quest is paid by an `INSERT OR IGNORE` against
`learn_quest_rewards (user_id, day, quest)`, which is what makes the payment
idempotent: quests are settled both when a lesson finishes (so the finish screen
can name the quest) and when the overview is read (so a closed tab does not cost
the coins).

**Items** (`learn_inventory`, one row per item; `item_key` is deliberately not
constrained by a CHECK so a new item needs no table rebuild):

| Item | Price | Cap | What it does |
|---|---|---|---|
| Hint | 12 | 9 | In a lesson: removes two wrong options, pre-places the first word of a word-order answer, highlights one match, or starts a typed answer. Never removes the answer. |
| Heart refill | 20 | 5 | On the "Out of hearts" screen: back to three hearts and the lesson continues where it stopped. |
| Double XP | 30 | 5 | 30 minutes of doubled XP (`learn_profiles.xp_boost_until`). The multiplier is applied to the award, never to the total. |
| Streak freeze | 40 | 3 | Covers exactly one missed day. Spent automatically, once, by the conditional `UPDATE … WHERE quantity > 0` that decides whether the streak survives. It does not cover two missed days. |

Every movement is recorded in `learn_coin_log`, every purchase in
`learn_shop_orders` — a balance can always be explained.

## Leaderboards

`src/worker/services/learn-leaderboard-service.ts`, one endpoint
(`GET /api/learn/leaderboard?scope=&window=&day=`), two boards:

- **Learn** — XP, this week (Monday to Sunday, in the reader's own day) or all
  time. The second line on a row is the streak.
- **Practice** — submitted attempts, with the best band beside the count.
  Deliberately *not* ranked by band: that would reward one lucky paper and make
  the board useless to the person who is actually working.

Both return the top 50, the total number of learners with activity, and the
reader's own row with its true rank even when it is outside the list. Names are
display names only — never an email or an id — and staff accounts never appear.

## Understanding an answer

After every answer the footer shows:

- the verdict (**Correct** / **Almost** / **Not quite**) and the right answer;
- the **whole sentence** the exercise was about — the blank filled in for a
  fill-in-the-blank, the model answer for a written one, the evidence line for a
  reading question — with the word the exercise taught underlined;
- **Nghĩa cả câu**: a Vietnamese rendering of that sentence
  (`POST /api/learn/translate`), cached per sentence in `learn_translations` so
  the provider is paid once for the whole platform, and cached per tab in the
  client so a replay is instant. With no provider configured the line is
  replaced by the word's own gloss and a note, never by an error;
- the **word's meaning**: English definition, part of speech and Vietnamese gloss.

## Tap a word to look it up

`src/client/components/learn/LookupText.tsx` turns every word of a prompt,
sentence, passage, evidence line or model answer into a button that opens the
dictionary in a bottom sheet (`DictionaryPanel`, the same component the exam
uses, so a saved word lands in the notebook). Punctuation stays with the
sentence and is stripped from the term (`“Friday.”` looks up `Friday`). The words
are `tabIndex={-1}` on purpose: making every word focusable would put hundreds of
stops in the tab order of one question. Legendary lessons disable the feature —
answering from memory is the point of them.

## Data and API

Migration `0017_learn_shop_and_quests.sql` adds `learn_profiles.coins` and
`xp_boost_until`, plus `learn_inventory`, `learn_shop_orders`, `learn_coin_log`,
`learn_quest_rewards` and `learn_translations`. `npm run schema:generate` was
re-run, so the Worker's self-healing bootstrap creates all of them on a database
that has never been migrated.

| Endpoint | What it does |
|---|---|
| `GET /api/learn/shop` | the catalogue, the wallet and the item caps |
| `POST /api/learn/shop/buy` | buys one or more, priced server-side |
| `POST /api/learn/items/use` | spends one item and applies its effect |
| `GET /api/learn/leaderboard` | one board, week or all time, with `me` |
| `POST /api/learn/translate` | Vietnamese for one sentence, cached |

Rate limits: 60 buys/hour, 90 item uses/hour, 240 translations/hour. `GET /learn
/overview` now also returns `quests`, `coinsFromQuests`, and the wallet on the
profile (`coins`, `xpBoostUntil`, `inventory`).

## Tests

`tests/unit/learn-shop.test.ts` pins the economy (lesson/review coins, prices and
caps, the boost window and its rounding, the freeze rules including the
two-day gap and the same-day repeat, quest progress and completion), the
leaderboard guards and week start (Monday), and the translation prompt contract
(stable task kind, one-field JSON, the sentence quoted as data with its quotes
stripped). `tests/unit/client-sfx.test.ts` keeps the sound library honest: a
name with no gallery entry is invisible in the soundboard, an entry with no
sound is a dead button, and every public call has to survive an environment with
no WebAudio at all. `npm test` runs 378 tests across 29 files, and
`npm run test:integration` drives the whole platform over HTTP (85 checks).
