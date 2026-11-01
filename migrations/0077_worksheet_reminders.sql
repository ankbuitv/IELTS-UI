CREATE TABLE IF NOT EXISTS worksheet_reminders (
 worksheet_id TEXT NOT NULL REFERENCES class_worksheets(id) ON DELETE CASCADE,
 student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 deadline_at TEXT NOT NULL,
 notification_id TEXT NOT NULL,
 created_at TEXT NOT NULL,
 PRIMARY KEY(worksheet_id,student_id,deadline_at)
);
