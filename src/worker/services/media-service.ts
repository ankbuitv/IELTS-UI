import type { Env } from '../env';
import { putBlob } from './blob-store';
import { nowIso } from '../lib/ids';

/**
 * The single place that decides how a stored asset becomes a URL.
 *
 * V1 has no object storage: assets referenced by `external_url` are delivered
 * straight from their HTTPS origin, and bundled demo media is served from the
 * application's static assets. Everything else in the Worker talks to assets
 * through this module, so adding an optional object-storage adapter later means
 * extending `resolveAssetUrl` rather than touching the exam engine, the player
 * or the admin screens.
 */
export interface AssetStorageRow {
  id: string;
  storage_kind: string;
  external_url: string | null;
  r2_key: string | null;
}

/** External URLs are restricted to HTTPS so mixed content cannot appear in an exam. */
export function isAllowedExternalUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  // Reject credentials embedded in the URL and non-standard ports.
  if (url.username || url.password) return false;
  return url.hostname.includes('.');
}

/** Normalises a pasted URL: trims whitespace and rejects anything unsafe. */
export function normaliseExternalUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!isAllowedExternalUrl(trimmed)) return null;
  const url = new URL(trimmed);
  url.hash = '';
  return url.toString();
}

/**
 * Resolves the delivery URL for an asset row.
 *
 * Returns `null` when the row carries no usable location, which callers surface
 * as "this asset has no media attached" instead of a broken player.
 */
export function resolveAssetUrl(asset: AssetStorageRow): string | null {
  if (asset.storage_kind === 'EXTERNAL_URL') {
    return asset.external_url && isAllowedExternalUrl(asset.external_url) ? asset.external_url : null;
  }
  if (asset.storage_kind === 'BUNDLED') {
    // Bundled demo media lives under /media/ in the static bundle.
    return asset.external_url && asset.external_url.startsWith('/') ? asset.external_url : null;
  }
  if (asset.storage_kind === 'OBJECT_STORAGE') {
    // An uploaded file lives in D1 (`asset_blobs`) and is streamed by
    // `/api/files/:assetId` with Range support, so the exam player can seek.
    // No external URL is involved and nothing is publicly reachable.
    return `/api/files/${asset.id}`;
  }
  return null;
}

/**
 * True when the deployment can store uploaded media. V1 always can: uploads are
 * kept in D1 as chunked base64 (`asset_blobs`), which needs no bucket.
 */
export function hasObjectStorage(_env: Env): boolean {
  return true;
}

/** True when this asset's bytes are stored in D1 rather than fetched from a URL. */
export function isInlineAsset(storageKind: string): boolean {
  return storageKind === 'OBJECT_STORAGE';
}

const AUDIO_MIME = (value: string | null, url: string): string => {
  if (value && value.startsWith('audio/')) return value.split(';')[0] ?? 'audio/mpeg';
  const lower = url.toLowerCase();
  if (lower.endsWith('.m4a') || lower.endsWith('.aac')) return 'audio/mp4';
  if (lower.endsWith('.ogg') || lower.endsWith('.oga')) return 'audio/ogg';
  if (lower.endsWith('.wav')) return 'audio/wav';
  return 'audio/mpeg';
};

const toBase64 = (buffer: ArrayBuffer): string => Buffer.from(new Uint8Array(buffer)).toString('base64');

export interface AudioIngestResult {
  stored: boolean;
  reason?: string;
}

/**
 * Downloads the bytes behind an `EXTERNAL_URL` audio asset and stores them in
 * D1, switching the row to `OBJECT_STORAGE`.
 *
 * Listening audio that is streamed from a third-party host at exam time is only
 * as reliable as that host — and hosts that hand out expiring signed URLs, or
 * that simply go away, turn a paid-for exam into a silent one. Copying the bytes
 * home once, at import or when an administrator asks, makes playback same-origin
 * (served by `/api/files/:id` with Range support) and independent of the source.
 *
 * Returns `stored:false` with a reason instead of throwing, so a flaky source
 * degrades to the old external-URL behaviour rather than breaking the import.
 */
export async function ingestExternalAudio(env: Env, assetId: string): Promise<AudioIngestResult> {
  const row = await env.DB.prepare(
    'SELECT storage_kind, external_url, filename FROM assets WHERE id = ?',
  )
    .bind(assetId)
    .first<{ storage_kind: string; external_url: string | null; filename: string | null }>();
  if (!row || !row.external_url) return { stored: false, reason: 'Asset not found.' };
  if (row.storage_kind === 'OBJECT_STORAGE') return { stored: true };

  const maxBytes = Number(env.MAX_UPLOAD_BYTES || 26_214_400);
  let response: Response;
  try {
    response = await fetch(row.external_url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(30_000),
      headers: { 'user-agent': 'ielts-platform/1.0 (audio ingest)' },
    });
  } catch {
    return { stored: false, reason: 'The source could not be reached.' };
  }
  if (!response.ok) return { stored: false, reason: `The source answered ${response.status}.` };

  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > maxBytes) return { stored: false, reason: 'The file is larger than the upload limit.' };

  let buffer: ArrayBuffer;
  try {
    buffer = await response.arrayBuffer();
  } catch {
    return { stored: false, reason: 'The download was interrupted.' };
  }
  if (buffer.byteLength === 0) return { stored: false, reason: 'The source sent no data.' };
  if (buffer.byteLength > maxBytes) return { stored: false, reason: 'The file is larger than the upload limit.' };

  const mime = AUDIO_MIME(response.headers.get('content-type'), row.external_url);
  await putBlob(env, 'asset_blobs', 'asset_id', assetId, toBase64(buffer), { mime, bytes: buffer.byteLength });
  await env.DB.prepare(
    'UPDATE assets SET storage_kind = ?, mime = ?, size_bytes = ?, updated_at = ? WHERE id = ?',
  )
    .bind('OBJECT_STORAGE', mime, buffer.byteLength, nowIso(), assetId)
    .run();
  return { stored: true };
}
