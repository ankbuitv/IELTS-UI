# Teacher features: implementation progress

This tracks the 20 teacher ideas agreed in the conversation. The initial implementation of all 20 ideas is available; the scope and limits are explicit below. Scope must remain class- and school-authorized on the server; learners retain their normal interface.

| # | Idea | Status |
|---|---|---|
| 1 | Personal timetable with teaching, grading deadlines and meetings | Class teaching events, assignment marking deadlines, personal plans, support appointments, mentor sessions and school events in the calendar. Class teaching events are individual entries, not recurring rules. Marking deadlines are shared with class staff. |
| 2 | Manual attendance | Implemented: daily present/absent/late, history and authorized teacher access (migration 0060). |
| 3 | Seating chart | Implemented: shared seating order with drag-and-drop and accessible move buttons, up to 200 students (migration 0062). |
| 4 | Lesson templates, copy and versions | Implemented: two starter templates, duplicate text and version history. Attachments and review history are not copied. |
| 5 | Personal teacher document library | Implemented: private file library organized by subject/topic with optional sharing to one authorized class, bounded to 25 files of 500 KB. |
| 6 | Assign work to subsets of students | Implemented: select up to 200 active learners on creation; server enforces visibility and eligibility throughout attempts, reminders and reporting. Audience is fixed after creation. |
| 7 | Schedule assignments and deadline reminders | Assignment opening/deadline plus deduplicated in-app reminders within 24 hours. The 30-minute scheduled job handles up to 500 eligible learners per run for normal assignments and another 500 for supplementary worksheets; delivery is not exact-time or email. |
| 8 | Personal question bank | Private searchable text question bank with reference answers; snapshots of 1–20 questions can be assigned as a class-wide supplementary worksheet. These worksheets are separate from the formal test engine and gradebook; multiple-choice bank questions are not supported. |
| 9 | Custom Writing/Speaking rubrics and reusable feedback | Private reusable Writing/Speaking rubrics (up to eight criteria) and editable feedback templates. Teachers can score Writing and Speaking with rubric snapshots; these are practice assessments, not official IELTS bands. |
| 10 | Inline feedback and resubmission | Teachers can add per-question feedback on formal exams and selected-text or whole-response comments on Writing. Formal Writing and supplementary worksheet feedback is drafted privately, explicitly returned, and supports up to ten immutable versions. Writing revision does not automatically change the original score; result release policy still applies. |
| 11 | Class gradebook | Implemented: current students and latest submitted/expired results, learner and deadline-date filters, bounded to 200 students and 100 assignments. |
| 12 | Early support signals | Class gradebook flags two absences in 30 days, two overdue unsubmitted assignments, or a drop of at least one band against the preceding completed assignment of the same type. Flags are informational, not automatic push notifications. |
| 13 | Individual skill progress charts | Implemented in the class: Reading/Listening/Writing sessions and linked Speaking mock scores, scoped to class assignments. |
| 14 | Individual target-band comparison | Implemented on class skill progress when a learner has set a target; comparison uses latest available class-assignment band, not an official score. |
| 15 | Teacher-reviewed end-of-term report | Implemented: class-scoped draft, explicit teacher approval, immutable shared snapshots and student view. |
| 16 | Class announcements, pinning and read counts | Implemented: teacher creation, pinning and removal; explicit student read acknowledgements and active-member counts (migration 0063). |
| 17 | Student booking of teacher support sessions | Teachers publish non-overlapping 10–120 minute support slots within 90 days. Active students book/cancel; teachers cancel. Participants receive in-app notifications and calendar entries. |
| 18 | Quick classroom polls | Implemented: teacher-created 2–6 choice polls, student vote/change and aggregate counts; teacher can close (migration 0063). |
| 19 | Teacher-private student notes | Implemented: author-only, class-scoped notes; active students only, archived classes read-only (migration 0061). |
| 20 | Granular co-teacher duties | Class owners/admins can grant or revoke co-teachers’ grading, attendance and class resource-sharing duties. Existing co-teachers default to all three; revocation immediately prevents the corresponding server operations and hides their class resource shares. |

Separately, the desktop now groups role-permitted apps in built-in folders; user-created shortcut folders remain supported. Lesson-plan attachments were added in migration 0059, with immutable submission snapshots and private author/reviewer access.

Migrations 0069–0078 add audiences, deadlines, support appointments, duties, rubrics, worksheets, Writing revision, teaching events, worksheet reminders and question feedback. Apply migrations with the existing deployment procedure only after inspecting the target database; no remote migration or deployment is performed by these changes.
