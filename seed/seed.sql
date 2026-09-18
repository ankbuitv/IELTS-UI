-- ---------------------------------------------------------------------------
-- Original sample content for a fresh local database.
--
-- Everything below was written for this platform. No IELTS, Cambridge,
-- British Council or IDP material is reproduced. You are responsible for the
-- rights of any content you add yourself.
--
-- The sample Reading test is seeded as a DRAFT so the publish/version workflow
-- can be shown: Admin -> Tests & content -> open it -> Publish.
-- ---------------------------------------------------------------------------

DELETE FROM score_conversion_ranges WHERE profile_id IN ('scp_seed_reading', 'scp_seed_listening');
DELETE FROM scoring_profiles WHERE id IN ('scp_seed_reading', 'scp_seed_listening');

INSERT INTO scoring_profiles (id, name, skill, test_type, version, status, min_questions, source_notes, created_by, created_at, updated_at)
VALUES
  ('scp_seed_reading', 'Reading — 40 question practice table', 'READING', 'READING', 1, 'ACTIVE', 40,
   'Original practice conversion table written for this platform. It is an estimate only, not an official IELTS band.', NULL,
   '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('scp_seed_listening', 'Listening — 40 question practice table', 'LISTENING', 'LISTENING', 1, 'ACTIVE', 40,
   'Original practice conversion table written for this platform. It is an estimate only, not an official IELTS band.', NULL,
   '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

-- Reading: 10-12 -> 4.0 ... 39-40 -> 9.0 (contiguous, one point of band per step)
INSERT INTO score_conversion_ranges (id, profile_id, raw_min, raw_max, band, sort_order) VALUES
  ('scr_r_00', 'scp_seed_reading', 0,  9,  3.5, 0),
  ('scr_r_01', 'scp_seed_reading', 10, 12, 4.0, 1),
  ('scr_r_02', 'scp_seed_reading', 13, 14, 4.5, 2),
  ('scr_r_03', 'scp_seed_reading', 15, 18, 5.0, 3),
  ('scr_r_04', 'scp_seed_reading', 19, 22, 5.5, 4),
  ('scr_r_05', 'scp_seed_reading', 23, 26, 6.0, 5),
  ('scr_r_06', 'scp_seed_reading', 27, 29, 6.5, 6),
  ('scr_r_07', 'scp_seed_reading', 30, 32, 7.0, 7),
  ('scr_r_08', 'scp_seed_reading', 33, 34, 7.5, 8),
  ('scr_r_09', 'scp_seed_reading', 35, 36, 8.0, 9),
  ('scr_r_10', 'scp_seed_reading', 37, 38, 8.5, 10),
  ('scr_r_11', 'scp_seed_reading', 39, 40, 9.0, 11);

INSERT INTO score_conversion_ranges (id, profile_id, raw_min, raw_max, band, sort_order) VALUES
  ('scr_l_00', 'scp_seed_listening', 0,  9,  3.5, 0),
  ('scr_l_01', 'scp_seed_listening', 10, 12, 4.0, 1),
  ('scr_l_02', 'scp_seed_listening', 13, 15, 4.5, 2),
  ('scr_l_03', 'scp_seed_listening', 16, 19, 5.0, 3),
  ('scr_l_04', 'scp_seed_listening', 20, 22, 5.5, 4),
  ('scr_l_05', 'scp_seed_listening', 23, 26, 6.0, 5),
  ('scr_l_06', 'scp_seed_listening', 27, 29, 6.5, 6),
  ('scr_l_07', 'scp_seed_listening', 30, 32, 7.0, 7),
  ('scr_l_08', 'scp_seed_listening', 33, 34, 7.5, 8),
  ('scr_l_09', 'scp_seed_listening', 35, 36, 8.0, 9),
  ('scr_l_10', 'scp_seed_listening', 37, 38, 8.5, 10),
  ('scr_l_11', 'scp_seed_listening', 39, 40, 9.0, 11);

-- ---------------------------------------------------------------------------
-- Sample Reading practice set (13 questions, original text)
-- ---------------------------------------------------------------------------
DELETE FROM tests WHERE id = 'tst_seed_night_train';

INSERT INTO tests (id, slug, title, type, status, summary, current_version_id, created_by, created_at, updated_at,
                   content_origin, source_title, source_url, attribution, license_notes)
VALUES (
  'tst_seed_night_train',
  'the-return-of-the-night-train',
  'Reading Practice — The Return of the Night Train',
  'READING',
  'DRAFT',
  'A short original practice passage with True/False/Not Given, multiple choice and short-answer questions. Practise the question types, then publish the test from the admin area.',
  NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z',
  'ORIGINAL', 'Written for this platform', NULL, 'Original content, no third-party rights involved.', 'Free to use within this platform.'
);

INSERT INTO test_versions (id, test_id, version_number, status, change_note, config_json, total_questions, duration_seconds,
                           is_complete_test, scoring_profile_id, created_by, created_at, updated_at, published_at, published_by,
                           archived_at, frozen_snapshot_json, validation_json)
VALUES (
  'ver_seed_night_train_v1',
  'tst_seed_night_train',
  1,
  'DRAFT',
  'Initial original practice set',
  '{"skillConfig":{"READING":{"durationSeconds":1200}}}',
  13,
  1200,
  0,
  'scp_seed_reading',
  NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL, NULL, NULL, NULL, NULL
);

INSERT INTO passages (id, test_version_id, order_index, title, subtitle, body_json, word_count, created_at, updated_at)
VALUES (
  'psg_seed_night_train',
  'ver_seed_night_train_v1',
  0,
  'The Return of the Night Train',
  'How sleeping carriages came back to European timetables',
  json('[{"label":"A","text":"For most of the twentieth century the sleeping car was an ordinary way to cross Europe. A traveller could board in the evening, eat dinner while the countryside slid past, sleep through the borders, and step onto a platform in another capital before breakfast. Then, over three decades, the network thinned. Cheap flights, motorways and a generation of high-speed daytime trains made the night service look slow and expensive to operate, and one operator after another withdrew its carriages."},
{"label":"B","text":"The economics were unforgiving in a specific way. A sleeping carriage carries far fewer people than a seated one, yet it must be cleaned, staffed and shunted at both ends of its journey. Its timetable is awkward: it occupies busy platforms at the hours when those platforms are needed for maintenance. Operators also found that the same rolling stock could earn more on daytime routes, where it could complete several trips instead of one."},
{"label":"C","text":"The revival began in Austria. Rather than ordering new trains, the national operator refurbished a fleet of carriages that had been in storage, cut the number of berths in each compartment and sold the upper bunks at prices close to a seat reservation. The change was modest, but it turned a loss-making curiosity into a service that filled up months in advance. Other operators noticed, and a handful of routes were reinstated."},
{"label":"D","text":"Demand, however, is only half of the problem. Crossing several countries means dealing with several safety regimes, several signalling systems and several sets of crew rules. A single journey may require three locomotives and two changes of staff, and each border adds paperwork that has nothing to do with passengers. Operators say that the administrative cost of a route can rival its fuel bill."},
{"label":"E","text":"Where the service has worked best, the reason has usually been political rather than commercial. Several governments now treat an overnight connection as part of the public transport network and subsidise it in the same way as a regional bus. In those countries the timetable is planned alongside daytime services, and platforms are reserved rather than fought over. Where no such support exists, new routes have tended to appear and then quietly disappear within a couple of years."},
{"label":"F","text":"For a student preparing for an English examination, the story is useful for one simple reason: it is full of the vocabulary of change. Routes are withdrawn and reinstated; carriages are refurbished rather than replaced; services fill up and sell out. Recognising how a text moves between cause and consequence, or between a claim and its qualification, matters far more than memorising any single word from it."}]'),
  420,
  '2026-01-01T00:00:00.000Z',
  '2026-01-01T00:00:00.000Z'
);

INSERT INTO sections (id, test_version_id, skill, order_index, title, subtitle, instructions, passage_id, audio_asset_id,
                      duration_seconds, config_json, created_at, updated_at)
VALUES (
  'sec_seed_night_train',
  'ver_seed_night_train_v1',
  'READING',
  0,
  'Reading Passage 1',
  NULL,
  'Read the passage and answer questions 1 to 13. The passage has six paragraphs, labelled A to F.',
  'psg_seed_night_train',
  NULL,
  1200,
  '{}',
  '2026-01-01T00:00:00.000Z',
  '2026-01-01T00:00:00.000Z'
);

INSERT INTO question_groups (id, test_version_id, section_id, order_index, question_type, instructions,
                             shared_options_json, config_json, range_from, range_to, created_at, updated_at)
VALUES
  ('grp_seed_tfng', 'ver_seed_night_train_v1', 'sec_seed_night_train', 0, 'TRUE_FALSE_NOT_GIVEN',
   'Do the following statements agree with the information given in the passage? Write TRUE if the statement agrees with the information, FALSE if it contradicts it, or NOT GIVEN if there is no information on this.',
   '[]', '{}', 1, 5, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('grp_seed_mcq', 'ver_seed_night_train_v1', 'sec_seed_night_train', 1, 'MCQ_SINGLE',
   'Choose the correct letter, A, B, C or D.',
   '[]', '{}', 6, 9, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('grp_seed_short', 'ver_seed_night_train_v1', 'sec_seed_night_train', 2, 'SHORT_ANSWER',
   'Answer the questions below. Choose NO MORE THAN TWO WORDS from the passage for each answer.',
   '[]', '{"wordLimit":{"max":2}}', 10, 13, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

INSERT INTO questions (id, test_version_id, section_id, question_group_id, number, order_index, prompt,
                       body_json, options_json, config_json, created_at, updated_at)
VALUES
  ('q_seed_01', 'ver_seed_night_train_v1', 'sec_seed_night_train', 'grp_seed_tfng', 1, 0,
   'Sleeping carriages were a common way to travel across Europe for much of the twentieth century.',
   '{}', '[]', '{}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('q_seed_02', 'ver_seed_night_train_v1', 'sec_seed_night_train', 'grp_seed_tfng', 2, 1,
   'A sleeping carriage can carry as many passengers as a seated carriage.',
   '{}', '[]', '{}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('q_seed_03', 'ver_seed_night_train_v1', 'sec_seed_night_train', 'grp_seed_tfng', 3, 2,
   'Night services are convenient for railway companies because they use platforms that would otherwise be free.',
   '{}', '[]', '{}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('q_seed_04', 'ver_seed_night_train_v1', 'sec_seed_night_train', 'grp_seed_tfng', 4, 3,
   'The Austrian operator bought a completely new fleet of sleeping carriages.',
   '{}', '[]', '{}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('q_seed_05', 'ver_seed_night_train_v1', 'sec_seed_night_train', 'grp_seed_tfng', 5, 4,
   'Passengers on the busiest routes are generally satisfied with the food served on board.',
   '{}', '[]', '{}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('q_seed_06', 'ver_seed_night_train_v1', 'sec_seed_night_train', 'grp_seed_mcq', 6, 5,
   'According to paragraph B, why is a sleeping carriage expensive to run?',
   '{}',
   '[{"id":"A","text":"It uses more fuel than a seated carriage."},{"id":"B","text":"It carries relatively few people for the work it requires."},{"id":"C","text":"It must be replaced more often than other stock."},{"id":"D","text":"It attracts lower ticket prices than daytime services."}]',
   '{}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('q_seed_07', 'ver_seed_night_train_v1', 'sec_seed_night_train', 'grp_seed_mcq', 7, 6,
   'What made the refurbished Austrian service profitable enough to continue?',
   '{}',
   '[{"id":"A","text":"The introduction of brand-new carriages."},{"id":"B","text":"A large government subsidy for every journey."},{"id":"C","text":"Fewer berths per compartment and cheaper upper bunks."},{"id":"D","text":"A reduction in the number of border crossings."}]',
   '{}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('q_seed_08', 'ver_seed_night_train_v1', 'sec_seed_night_train', 'grp_seed_mcq', 8, 7,
   'What does the writer say about administrative costs in paragraph D?',
   '{}',
   '[{"id":"A","text":"They are usually lower than fuel costs."},{"id":"B","text":"They can be as significant as the cost of fuel."},{"id":"C","text":"They have fallen since signalling was harmonised."},{"id":"D","text":"They are paid for by the passengers at the border."}]',
   '{}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('q_seed_09', 'ver_seed_night_train_v1', 'sec_seed_night_train', 'grp_seed_mcq', 9, 8,
   'In paragraph E, what does the writer suggest about unsuccessful new routes?',
   '{}',
   '[{"id":"A","text":"They were badly advertised."},{"id":"B","text":"They lacked the political support that makes routes last."},{"id":"C","text":"They suffered from a shortage of trained crews."},{"id":"D","text":"They were withdrawn because of safety concerns."}]',
   '{}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('q_seed_10', 'ver_seed_night_train_v1', 'sec_seed_night_train', 'grp_seed_short', 10, 9,
   'Which paragraph describes how the same carriages could earn more money on daytime services? Write the letter of the paragraph.',
   '{}', '[]', '{}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('q_seed_11', 'ver_seed_night_train_v1', 'sec_seed_night_train', 'grp_seed_short', 11, 10,
   'Which paragraph mentions that some governments now support overnight services in the same way as a regional bus? Write the letter of the paragraph.',
   '{}', '[]', '{}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('q_seed_12', 'ver_seed_night_train_v1', 'sec_seed_night_train', 'grp_seed_short', 12, 11,
   'What kind of daytime trains are said to have made night services look slow? (Answer using no more than two words from the text.)',
   '{}', '[]', '{}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('q_seed_13', 'ver_seed_night_train_v1', 'sec_seed_night_train', 'grp_seed_short', 13, 12,
   'The writer says that recognising the movement of a text between cause and consequence matters more than memorising vocabulary. Which paragraph makes this point? Write the letter of the paragraph.',
   '{}', '[]', '{}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

INSERT INTO answer_keys (id, question_id, test_version_id, answer_json, evidence, explanation, updated_by, created_at, updated_at)
VALUES
  ('ak_seed_01', 'q_seed_01', 'ver_seed_night_train_v1', '{"kind":"CHOICE","values":["TRUE"]}',
   'Paragraph A: "For most of the twentieth century the sleeping car was an ordinary way to cross Europe."',
   'The statement agrees with the passage.', NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('ak_seed_02', 'q_seed_02', 'ver_seed_night_train_v1', '{"kind":"CHOICE","values":["FALSE"]}',
   'Paragraph B: "A sleeping carriage carries far fewer people than a seated one."',
   'The statement contradicts the passage.', NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('ak_seed_03', 'q_seed_03', 'ver_seed_night_train_v1', '{"kind":"CHOICE","values":["FALSE"]}',
   'Paragraph B: "it occupies busy platforms at the hours when those platforms are needed for maintenance."',
   'The passage says the opposite: the hours are awkward.', NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('ak_seed_04', 'q_seed_04', 'ver_seed_night_train_v1', '{"kind":"CHOICE","values":["FALSE"]}',
   'Paragraph C: "Rather than ordering new trains, the national operator refurbished a fleet of carriages that had been in storage."',
   'The carriages were refurbished, not new.', NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('ak_seed_05', 'q_seed_05', 'ver_seed_night_train_v1', '{"kind":"CHOICE","values":["NOT_GIVEN"]}',
   NULL,
   'The passage does not discuss passenger satisfaction with food.', NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('ak_seed_06', 'q_seed_06', 'ver_seed_night_train_v1', '{"kind":"CHOICE","values":["B"]}',
   'Paragraph B: "A sleeping carriage carries far fewer people than a seated one, yet it must be cleaned, staffed and shunted at both ends of its journey."',
   NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('ak_seed_07', 'q_seed_07', 'ver_seed_night_train_v1', '{"kind":"CHOICE","values":["C"]}',
   'Paragraph C: "cut the number of berths in each compartment and sold the upper bunks at prices close to a seat reservation."',
   NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('ak_seed_08', 'q_seed_08', 'ver_seed_night_train_v1', '{"kind":"CHOICE","values":["B"]}',
   'Paragraph D: "Operators say that the administrative cost of a route can rival its fuel bill."',
   NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('ak_seed_09', 'q_seed_09', 'ver_seed_night_train_v1', '{"kind":"CHOICE","values":["B"]}',
   'Paragraph E: "Where no such support exists, new routes have tended to appear and then quietly disappear within a couple of years."',
   NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('ak_seed_10', 'q_seed_10', 'ver_seed_night_train_v1', '{"kind":"TEXT","accept":["B"]}',
   'Paragraph B: "Operators also found that the same rolling stock could earn more on daytime routes."',
   NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('ak_seed_11', 'q_seed_11', 'ver_seed_night_train_v1', '{"kind":"TEXT","accept":["E"]}',
   'Paragraph E: "Several governments now treat an overnight connection as part of the public transport network and subsidise it in the same way as a regional bus."',
   NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('ak_seed_12', 'q_seed_12', 'ver_seed_night_train_v1', '{"kind":"TEXT","accept":["high-speed","high speed"]}',
   'Paragraph A: "a generation of high-speed daytime trains made the night service look slow and expensive to operate".',
   NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('ak_seed_13', 'q_seed_13', 'ver_seed_night_train_v1', '{"kind":"TEXT","accept":["F"]}',
   'Paragraph F: "Recognising how a text moves between cause and consequence, or between a claim and its qualification, matters far more than memorising any single word from it."',
   NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

-- A Writing practice test (two tasks, no AI scoring; teachers mark submissions).
DELETE FROM tests WHERE id = 'tst_seed_writing';
INSERT INTO tests (id, slug, title, type, status, summary, current_version_id, created_by, created_at, updated_at,
                   content_origin, source_title, source_url, attribution, license_notes)
VALUES (
  'tst_seed_writing', 'writing-practice-two-tasks', 'Writing Practice — Two Tasks', 'WRITING', 'DRAFT',
  'A short Task 1 and Task 2 writing practice set. Submissions are reviewed and marked by a teacher or administrator; the platform does not score writing automatically.',
  NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z',
  'ORIGINAL', 'Written for this platform', NULL, 'Original content, no third-party rights involved.', 'Free to use within this platform.'
);

INSERT INTO test_versions (id, test_id, version_number, status, change_note, config_json, total_questions, duration_seconds,
                           is_complete_test, scoring_profile_id, created_by, created_at, updated_at, published_at, published_by,
                           archived_at, frozen_snapshot_json, validation_json)
VALUES (
  'ver_seed_writing_v1', 'tst_seed_writing', 1, 'DRAFT', 'Initial writing practice set',
  '{"skillConfig":{"WRITING":{"durationSeconds":3600}}}', 2, 3600, 0, NULL,
  NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL, NULL, NULL, NULL, NULL
);

INSERT INTO sections (id, test_version_id, skill, order_index, title, subtitle, instructions, passage_id, audio_asset_id,
                      duration_seconds, config_json, created_at, updated_at)
VALUES (
  'sec_seed_writing', 'ver_seed_writing_v1', 'WRITING', 0, 'Writing Tasks', NULL,
  'Complete both tasks. You should spend about 20 minutes on Task 1 and about 40 minutes on Task 2. Your answers are saved automatically and marked by a teacher.',
  NULL, NULL, 3600, '{}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
);

INSERT INTO question_groups (id, test_version_id, section_id, order_index, question_type, instructions,
                             shared_options_json, config_json, range_from, range_to, created_at, updated_at)
VALUES
  ('grp_seed_task1', 'ver_seed_writing_v1', 'sec_seed_writing', 0, 'WRITING_TASK_1',
   'Write at least 150 words.', '[]', '{"note":"Task 1"}', 1, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('grp_seed_task2', 'ver_seed_writing_v1', 'sec_seed_writing', 1, 'WRITING_TASK_2',
   'Write at least 250 words.', '[]', '{"note":"Task 2"}', 2, 2, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

INSERT INTO questions (id, test_version_id, section_id, question_group_id, number, order_index, prompt,
                       body_json, options_json, config_json, created_at, updated_at)
VALUES
  ('q_seed_w1', 'ver_seed_writing_v1', 'sec_seed_writing', 'grp_seed_task1', 1, 0,
   'The table below shows the percentage of households in three districts that had a home internet connection in 2005, 2015 and 2025. Summarise the information by selecting and reporting the main features, and make comparisons where relevant. Write at least 150 words.',
   '{}', '[]', '{"wordLimit":{"min":150}}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('q_seed_w2', 'ver_seed_writing_v1', 'sec_seed_writing', 'grp_seed_task2', 2, 1,
   'Some people believe that examinations are the fairest way to measure a student''s progress, while others argue that continuous assessment gives a better picture. Discuss both views and give your own opinion. Write at least 250 words.',
   '{}', '[]', '{"wordLimit":{"min":250}}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

-- Writing tasks are marked manually: no automatic key is created for them.
INSERT INTO answer_keys (id, question_id, test_version_id, answer_json, evidence, explanation, updated_by, created_at, updated_at)
VALUES
  ('ak_seed_w1', 'q_seed_w1', 'ver_seed_writing_v1', '{"kind":"MANUAL"}', NULL,
   'Teacher-marked task. A human reviewer awards the band and writes feedback.', NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('ak_seed_w2', 'q_seed_w2', 'ver_seed_writing_v1', '{"kind":"MANUAL"}', NULL,
   'Teacher-marked task. A human reviewer awards the band and writes feedback.', NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
