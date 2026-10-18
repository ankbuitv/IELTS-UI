-- 0027: public profile extras — bio and personal links.
--
-- The learner writes their own description and picks links (YouTube channel,
-- Facebook, portfolio…) shown on their public profile next to the band tag.

ALTER TABLE user_profiles ADD COLUMN bio TEXT NOT NULL DEFAULT '';
ALTER TABLE user_profiles ADD COLUMN links_json TEXT NOT NULL DEFAULT '';
