-- 0010: the bundled sample Writing test still described itself as teacher-marked.
-- Writing is now marked automatically by the AI judges (a teacher's band replaces their
-- estimate), so the two sentences a candidate reads are corrected.
--
-- Only rows that still hold the original sample wording are touched (exact match), so any
-- text an administrator has edited is left alone. Safe to run more than once.

UPDATE tests
SET summary = 'A short Task 1 and Task 2 writing practice set. It is marked automatically by two AI judges as soon as you submit, and a teacher can award an official practice band that replaces their estimate.'
WHERE id = 'tst_seed_writing'
  AND summary = 'A short Task 1 and Task 2 writing practice set. Submissions are reviewed and marked by a teacher or administrator; the platform does not score writing automatically.';

UPDATE sections
SET instructions = 'Complete both tasks. You should spend about 20 minutes on Task 1 and about 40 minutes on Task 2. Your answers are saved automatically and marked by the AI judges when you finish.'
WHERE id = 'sec_seed_writing'
  AND instructions = 'Complete both tasks. You should spend about 20 minutes on Task 1 and about 40 minutes on Task 2. Your answers are saved automatically and marked by a teacher.';

-- A published version carries a frozen copy of its content; keep the copy in step with the rows above.
UPDATE test_versions
SET frozen_snapshot_json = REPLACE(
      REPLACE(
        frozen_snapshot_json,
        'Your answers are saved automatically and marked by a teacher.',
        'Your answers are saved automatically and marked by the AI judges when you finish.'),
      'Submissions are reviewed and marked by a teacher or administrator; the platform does not score writing automatically.',
      'It is marked automatically by two AI judges as soon as you submit, and a teacher can award an official practice band that replaces their estimate.')
WHERE id = 'ver_seed_writing_v1'
  AND frozen_snapshot_json IS NOT NULL;
