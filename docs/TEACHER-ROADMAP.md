# Teacher features: implementation progress

This tracks the 20 teacher ideas agreed in the conversation. Do not treat the list as a claim that every idea is already implemented. Scope must remain class- and school-authorized on the server; learners retain their normal interface.

| # | Idea | Status |
|---|---|---|
| 1 | Personal timetable with teaching, grading deadlines and meetings | Calendar now combines personal events, mentor sessions, teaching assignment submission deadlines and school events. Separate grading deadlines are not yet modeled. |
| 2 | Manual attendance | Implemented: daily present/absent/late, history and authorized teacher access (migration 0060). |
| 3 | Seating chart | Implemented: shared seating order with drag-and-drop and accessible move buttons, up to 200 students (migration 0062). |
| 4 | Lesson templates, copy and versions | Implemented: two starter templates, duplicate text and version history. Attachments and review history are not copied. |
| 5 | Personal teacher document library | Implemented: private file library organized by subject/topic with optional sharing to one authorized class, bounded to 25 files of 500 KB. |
| 6 | Assign work to subsets of students | To do; requires assignment eligibility changes throughout attempt and reporting flows. |
| 7 | Schedule assignments and deadline reminders | Existing start/deadline fields plus automatic in-app reminders within 24 hours for active learners without a submission. Cron runs every 30 minutes and processes up to 500 per run. |
| 8 | Personal question bank | Private searchable text question bank with reference answers implemented; direct question-to-test/assignment integration remains to do. |
| 9 | Custom Writing/Speaking rubrics and reusable feedback | Private reusable Writing feedback templates implemented; custom rubrics and Speaking integration still to do. |
| 10 | Inline feedback and resubmission | Existing marking is a starting point; inline comments and full resubmission workflow still to do. |
| 11 | Class gradebook | Implemented: current students and latest submitted/expired results, learner and deadline-date filters, bounded to 200 students and 100 assignments. |
| 12 | Early support signals | Basic, transparent class gradebook flags for attendance and overdue work implemented; richer trends/notifications still to do. |
| 13 | Individual skill progress charts | Implemented in the class: Reading/Listening/Writing sessions and linked Speaking mock scores, scoped to class assignments. |
| 14 | Individual target-band comparison | Implemented on class skill progress when a learner has set a target; comparison uses latest available class-assignment band, not an official score. |
| 15 | Teacher-reviewed end-of-term report | Implemented: class-scoped draft, explicit teacher approval, immutable shared snapshots and student view. |
| 16 | Class announcements, pinning and read counts | Implemented: teacher creation, pinning and removal; explicit student read acknowledgements and active-member counts (migration 0063). |
| 17 | Student booking of teacher support sessions | To do. |
| 18 | Quick classroom polls | Implemented: teacher-created 2–6 choice polls, student vote/change and aggregate counts; teacher can close (migration 0063). |
| 19 | Teacher-private student notes | Implemented: author-only, class-scoped notes; active students only, archived classes read-only (migration 0061). |
| 20 | Granular co-teacher duties | Co-teacher membership exists; fine-grained duties still to do. |

Separately, the desktop now groups role-permitted apps in built-in folders; user-created shortcut folders remain supported. Lesson-plan attachments were added in migration 0059, with immutable submission snapshots and private author/reviewer access.
