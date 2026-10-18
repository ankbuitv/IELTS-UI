# Mentor platform — booking, live call rooms, classes

This note covers the coaching side of Ai eo: the `MENTOR` account type, how a
student books a mentor, what happens in a live call room, and where the
WebRTC signalling lives. It sits on top of the playful UI refresh (soft
lavender sidebar, violet/sun/coral palette, big rounded cards).

Everything here is **practice tooling**. Ai eo is not affiliated with IELTS,
the British Council, IDP or Cambridge.

---

## 1. Roles

- `users.role` accepts `STUDENT | TEACHER | ADMIN | MENTOR` (migration 0020
  rebuilds the CHECK constraint; `ensure-schema.ts` heals older databases via
  `CHECK_REBUILDS`).
- Public sign-up always creates students. A mentor account is created by an
  administrator (**Admin → Users → Create user → Mentor**) or provisioned by
  `scripts/demo-accounts.mjs` (`mentor@demo.test`).
- A mentor signs in to the **Mentor console** (`/mentor`): upcoming sessions,
  students, stats, and modals to publish a live class, set weekly availability
  and edit the coach profile.

## 2. The mentor world in the app

| Route | Who | What |
| --- | --- | --- |
| `/mentors` | everyone signed in | Directory: specialty filters, one card per coach (rating, languages, rate). |
| `/mentors/:mentorId` | everyone signed in | Profile, reviews, 14-day slot picker, booking dialog. |
| `/my-sessions` | student & mentor | Upcoming calls ("Join call" opens 10 min before), past sessions, reviews, "Mark complete". |
| `/classes` | everyone | Mentor-led live classes ("clubs"): join/leave, seats bar, one room for the call. |
| `/mentor` | MENTOR, ADMIN | Console: stats tiles, day schedule, student roster, create-class / availability / profile modals. |
| `/sessions/:id/room` | session members | Full-screen call room (outside the app chrome, like the exam). |

The desktop shell groups these under **Coaching** in the sidebar; the phone tab
bar surfaces *Mentors* next to Learn.

## 3. Booking model

- `mentor_availability` holds weekly windows (weekday + minutes-of-day). The
  profile page expands them into 30-minute slots over the next 14 days.
- `POST /api/mentor/:mentorId/book` creates a `mentor_sessions` row
  (`ONE_ON_ONE`, `SCHEDULED`, 60 minutes by default) and refuses double
  bookings on either side. Price is quoted in Learn coins
  (`hourly_rate_coins × duration`); it is charged only when the learner's
  `learn_profiles.coins` covers it, and refunded on cancel — a fresh account
  books free rather than failing (beta pricing).
- After the mentor marks a session **completed**, the student can leave a
  1–5 star review (`mentor_reviews`); the profile's `rating_avg`/`rating_count`
  are recomputed from reviews only.

## 4. Live call room (`/sessions/:sessionId/room`)

- **Prejoin screen**: camera preview (getUserMedia), mic/cam toggles, then
  `POST /api/mentor/sessions/:id/join` registers presence (`mentor_room_presence`)
  and flips a `SCHEDULED` session to `ACTIVE` when the mentor joins.
- **Media**: peer-to-peer WebRTC mesh (STUN only). Each participant keeps one
  `RTCPeerConnection` per peer; the lexicographically smaller user id initiates
  the offer so both sides don't collide. Screen share replaces the outbound
  video track (`getDisplayMedia`).
- **Signalling**: SDP offers/answers and ICE candidates are relayed through D1
  (`mentor_signals`) — the room polls `GET /api/mentor/sessions/:id/room?since=`
  every 2.5 s and exchanges envelopes with `POST …/signal`. Old envelopes are
  pruned after 10 minutes; presence expires after 90 s of silence. No realtime
  service is required for a two-or-three person coaching call.
- **Everything else in the room**: chat (`mentor_messages`, kind `CHAT`),
  shared session notes (kind `NOTE`), the roster with hand raises
  (`POST …/hand`), a session timer, and **Leave** / **End session** (mentor).
  A failed or declined media permission drops straight into audio-only or
  listen-only rather than blocking the room.

## 5. Classes ("clubs")

- `mentor_classes` + `mentor_class_members`: a mentor publishes a class (title,
  level, capacity, price, schedule, optional recurrence) and students join from
  `/classes`. Joining also creates the member's `CLASS` session row so the room,
  chat and history stay uniform with 1-on-1 calls.
- A class in session (`starts_at ≤ now ≤ ends_at`) shows **Go to sessions** /
  **Open room**; the room itself is the same call room as a 1-on-1.

## 6. API map (all under `/api/mentor`, session + CSRF + same-origin)

```
GET  /directory?specialty=            list active mentors
GET  /:mentorId                       profile + availability + reviews
POST /:mentorId/book                  book a slot
GET  /me/sessions?scope=all|upcoming|past
POST /sessions/:id/cancel | complete | review | join | leave | hand
GET  /sessions/:id/room?since=        session, presence, messages, signals
POST /sessions/:id/messages | signal
GET  /classes/list
POST /classes                         mentor publishes a class
POST /classes/:id/join | leave
GET  /console/overview                mentor dashboard
POST /profile                         mentor edits the coach profile
PUT  /availability                    mentor sets weekly windows
```

## 7. Schema

`migrations/0020_mentor.sql`: rebuilds `users` (role CHECK + `MENTOR`) and adds
`mentor_profiles`, `mentor_availability`, `mentor_classes`,
`mentor_class_members`, `mentor_sessions`, `mentor_messages`, `mentor_signals`,
`mentor_reviews`, `mentor_room_presence`. The runtime schema is regenerated with
`npm run schema:generate`.


## Class chat, class calls & avatars (added after the first release)

- **Classroom = chat + one call room.** Every class owns a durable room session
  (`mentor_sessions`, kind `CLASS`): `GET /api/mentor/classes/:classId/room`
  returns its `sessionId` (created on demand), and any member can open
  `/sessions/:sessionId/room` for the WebRTC group call. The persistent group
  chat is `GET/POST /api/mentor/classes/:classId/messages`
  (`mentor_class_messages`, joined messages carry `senderAvatarUpdatedAt`).
- **Class detail page** — `/classes/:classId` shows the roster with avatars,
  the live chat feed and the “Join class call” button; mentors create classes
  straight from `/classes` (the same `CreateClassModal` powers the console).
- **Profile avatars** — `POST /api/profile/avatar` `{mime, dataBase64}` (PNG/
  JPEG/WebP/GIF ≤ ~2 MB base64) stores the picture in `profile_avatars`
  (chunked); `GET /api/files/avatar/:userId?v=<avatar_updated_at>` serves it
  cache-busted; `DELETE /api/profile/avatar` removes it. `AuthUser.avatarUrl`
  flows through `/api/auth/me|login|register`, and the shared mentor payloads
  carry `avatarUpdatedAt` next to every name. The UI falls back to initials.
- **Mentors take tests too** — the role guard treats MENTOR as candidate-like:
  own attempts only, forced PRACTICE mode, published tests, access codes
  enforced — same rules as students minus staff exemptions.
