-- Used inside the same transaction as a hard-delete. Existing assignments,
-- including archived ones and assigned mocks' components, keep their content.
CREATE TABLE IF NOT EXISTS content_delete_guards (
 id TEXT PRIMARY KEY,
 safe INTEGER NOT NULL CONSTRAINT no_assigned_version CHECK(safe=1)
);
