CREATE TABLE IF NOT EXISTS worksheet_submission_files (
 version_id TEXT PRIMARY KEY REFERENCES class_worksheet_versions(id) ON DELETE CASCADE,
 filename TEXT NOT NULL,bytes INTEGER NOT NULL,data_b64 TEXT NOT NULL
);
