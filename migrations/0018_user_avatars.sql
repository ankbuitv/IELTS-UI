-- Migration 0018: user avatars.
--
-- `user_profiles.avatar_asset_id` points at the `assets` row holding the user's
-- current avatar (stored in `asset_blobs` with `storage_kind = 'INLINE'` and
-- streamed through `/api/auth/avatar/:userId?v=<assetId>`). Storing the
-- asset id on the profile row lets `/api/auth/me` and the leaderboards derive
-- `avatarUrl` in the same SELECT with no extra round-trip.

ALTER TABLE user_profiles ADD COLUMN avatar_asset_id TEXT NOT NULL DEFAULT '';
