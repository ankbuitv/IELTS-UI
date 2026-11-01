-- No row means the original whole-class audience. A row makes targets explicit.
CREATE TABLE IF NOT EXISTS assignment_audiences (
 assignment_id TEXT PRIMARY KEY REFERENCES assignments(id) ON DELETE CASCADE,
 expected_count INTEGER NOT NULL CHECK(expected_count BETWEEN 1 AND 200),
 verified_count INTEGER NOT NULL CHECK(verified_count=expected_count)
);
CREATE TABLE IF NOT EXISTS assignment_audience_students (
 assignment_id TEXT NOT NULL REFERENCES assignment_audiences(assignment_id) ON DELETE CASCADE,
 student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 PRIMARY KEY(assignment_id,student_id)
);
