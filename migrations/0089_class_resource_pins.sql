-- Private bookmarks for shared class resources; a bookmark never grants access.
CREATE TABLE IF NOT EXISTS classroom_resource_pins (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 classroom_id TEXT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
 resource_id TEXT NOT NULL REFERENCES teacher_resources(id) ON DELETE CASCADE,
 created_at TEXT NOT NULL,
 PRIMARY KEY(user_id,classroom_id,resource_id)
);
