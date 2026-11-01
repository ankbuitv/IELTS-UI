CREATE TABLE IF NOT EXISTS assignment_reminders (
 assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
 student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 deadline_at TEXT NOT NULL,
 notification_id TEXT NOT NULL,
 created_at TEXT NOT NULL,
 PRIMARY KEY(assignment_id,student_id,deadline_at)
);
