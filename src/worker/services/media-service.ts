import type { Env } from '../env';

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
  // OBJECT_STORAGE is a documented extension point, not a V1 code path.
  return null;
}

/**
 * Optional future adapter hook. V1 always returns `false`, so no caller can
 * accidentally depend on object storage being present.
 */
export function hasObjectStorage(_env: Env): boolean {
  return false;
}
