/**
 * Avatar storage.
 *
 * The policy — what a filename may look like, what the bytes must prove — lives
 * in `src/shared/avatar.ts` so the browser can run the identical check before it
 * uploads. This module is only the part that needs a database: read the file,
 * validate it *again* on the bytes that actually arrived, store it chunked in
 * `avatar_blobs`, and hand it back as a data URL.
 *
 * A data URL rather than an `<img src>`: the SPA in an embedded preview
 * authenticates with a bearer header, which an `<img>` tag cannot send, so an
 * avatar behind an authenticated route would be a broken picture for exactly the
 * people previewing the site. Avatars are downscaled to 256 px before upload and
 * capped here, so inlining them costs tens of kilobytes and always renders.
 *
 * Preset avatars need no storage at all — they are a coat name the client
 * already knows how to draw — which is why they are cheap enough to send with
 * every leaderboard row.
 */
import type { Env } from '../env';
import { ApiError } from '../lib/errors';
import { nowIso } from '../lib/ids';
import { bytesToBase64, deleteBlob, getBlob, putBlob } from './blob-store';
import {
  EMPTY_AVATAR,
  isAvatarPreset,
  validateAvatar,
  type AvatarPreset,
  type AvatarState,
} from '../../shared/avatar';

interface AvatarRow {
  avatar_kind: string | null;
  avatar_preset: string | null;
  avatar_mime: string | null;
  avatar_bytes: number | null;
  avatar_name: string | null;
  avatar_updated_at: string | null;
}

async function readRow(env: Env, userId: string): Promise<AvatarRow | null> {
  return env.DB.prepare(
    `SELECT avatar_kind, avatar_preset, avatar_mime, avatar_bytes, avatar_name, avatar_updated_at
       FROM user_profiles WHERE user_id = ?`,
  )
    .bind(userId)
    .first<AvatarRow>();
}

async function writeRow(
  env: Env,
  userId: string,
  value: { kind: string; preset: string; mime: string; bytes: number; name: string },
): Promise<void> {
  const stamp = nowIso();
  const updated = await env.DB.prepare(
    `UPDATE user_profiles
        SET avatar_kind = ?, avatar_preset = ?, avatar_mime = ?, avatar_bytes = ?, avatar_name = ?,
            avatar_updated_at = ?, updated_at = ?
      WHERE user_id = ?`,
  )
    .bind(value.kind, value.preset, value.mime, value.bytes, value.name, stamp, stamp, userId)
    .run();
  // A profile row is written at registration, so this should always match one
  // row; if it does not, the account is mid-creation and the avatar is simply
  // not stored rather than an error being thrown at a learner for our race.
  if ((updated.meta?.changes ?? 0) === 0) {
    await env.DB.prepare(
      `INSERT INTO user_profiles (user_id, display_name, avatar_kind, avatar_preset, avatar_mime, avatar_bytes, avatar_name, avatar_updated_at, created_at, updated_at)
       VALUES (?, '', ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(userId, value.kind, value.preset, value.mime, value.bytes, value.name, stamp, stamp, stamp)
      .run();
  }
}

/** The learner's avatar, with the picture itself when one is stored. */
export async function getAvatar(env: Env, userId: string): Promise<AvatarState> {
  const row = await readRow(env, userId);
  if (!row || !row.avatar_kind) return EMPTY_AVATAR;

  const base: AvatarState = {
    kind: row.avatar_kind === 'UPLOAD' ? 'UPLOAD' : 'PRESET',
    preset: row.avatar_preset ?? '',
    mime: row.avatar_mime ?? '',
    bytes: row.avatar_bytes ?? 0,
    filename: row.avatar_name ?? '',
    updatedAt: row.avatar_updated_at ?? null,
    dataUrl: null,
  };
  if (base.kind !== 'UPLOAD') return base;

  const stored = await getBlob(env, 'avatar_blobs', 'user_id', userId);
  if (!stored) return { ...base, kind: '', preset: '', mime: '', bytes: 0, filename: '', updatedAt: null };
  return { ...base, mime: stored.mime || base.mime, dataUrl: `data:${stored.mime};base64,${stored.base64}` };
}

/** A preset coat: no bytes, no storage, nothing to validate beyond the name. */
export async function setPresetAvatar(env: Env, userId: string, preset: string): Promise<AvatarState> {
  if (!isAvatarPreset(preset)) throw ApiError.validation('That avatar is not one of the presets.');
  await deleteBlob(env, 'avatar_blobs', 'user_id', userId);
  await writeRow(env, userId, { kind: 'PRESET', preset: preset as AvatarPreset, mime: '', bytes: 0, name: '' });
  return getAvatar(env, userId);
}

/**
 * Stores an uploaded picture.
 *
 * The bytes are re-read and re-validated here: whatever the browser checked is
 * between the browser and the learner, and the server's copy of the policy is
 * the one that decides what ends up in the database.
 */
export async function setUploadedAvatar(env: Env, userId: string, file: File): Promise<AvatarState> {
  let buffer: ArrayBuffer;
  try {
    buffer = await file.arrayBuffer();
  } catch {
    throw ApiError.validation('That file could not be read. Try exporting it again.');
  }
  const bytes = new Uint8Array(buffer);
  const checked = validateAvatar({ filename: file.name, mime: file.type, bytes });
  if (!checked.ok) throw ApiError.validation(checked.reason, { code: checked.code });

  await putBlob(env, 'avatar_blobs', 'user_id', userId, bytesToBase64(bytes), { mime: checked.mime, bytes: checked.bytes });
  await writeRow(env, userId, {
    kind: 'UPLOAD',
    preset: '',
    mime: checked.mime,
    bytes: checked.bytes,
    name: `${checked.base}.${checked.extension}`.slice(0, 120),
  });
  return getAvatar(env, userId);
}

/** Back to initials. The blob goes too, so nothing is left behind to serve. */
export async function clearAvatar(env: Env, userId: string): Promise<AvatarState> {
  await deleteBlob(env, 'avatar_blobs', 'user_id', userId);
  await writeRow(env, userId, { kind: '', preset: '', mime: '', bytes: 0, name: '' });
  return EMPTY_AVATAR;
}

/**
 * Preset coat names for a batch of accounts, in one query.
 *
 * Leaderboard rows carry this so a board can draw a mascot instead of initials
 * without fetching fifty pictures; an uploaded avatar is never included, because
 * sending other people's profile pictures down to every reader is not something
 * a board needs to do.
 */
export async function getPresetAvatars(env: Env, userIds: readonly string[]): Promise<Record<string, string>> {
  const ids = [...new Set(userIds.filter(Boolean))].slice(0, 200);
  if (ids.length === 0) return {};
  const placeholders = ids.map(() => '?').join(',');
  const rows = await env.DB.prepare(
    `SELECT user_id, avatar_preset FROM user_profiles
      WHERE avatar_kind = 'PRESET' AND avatar_preset != '' AND user_id IN (${placeholders})`,
  )
    .bind(...ids)
    .all<{ user_id: string; avatar_preset: string }>();
  const out: Record<string, string> = {};
  for (const row of rows.results ?? []) out[row.user_id] = row.avatar_preset;
  return out;
}
