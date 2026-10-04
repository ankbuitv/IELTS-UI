import type { Env } from '../env';
import { nowIso } from '../lib/ids';

/**
 * Chunked base64 blob storage in D1.
 *
 * V1 has no object storage, and D1 caps what a single SQL statement can carry,
 * so a file is split into ~36 KB of binary per row and reassembled on read.
 * Listing audio, a chart image or a candidate's speaking recording therefore
 * survives a redeploy without any bucket — at the cost of being read through
 * the Worker (which is also what keeps candidate audio private).
 */

/** base64 characters per chunk (~36 KB of binary, comfortably inside D1's statement cap). */
export const BLOB_CHUNK_CHARS = 48_000;

export type BlobTable = 'asset_blobs' | 'speaking_recording_blobs' | 'avatar_blobs';

export async function putBlob(
  env: Env,
  table: BlobTable,
  ownerColumn: 'asset_id' | 'response_id' | 'user_id',
  ownerId: string,
  base64: string,
  options: { mime?: string; bytes?: number } = {},
): Promise<{ chunks: number; bytes: number }> {
  const payload = base64.replace(/\s+/g, '');
  const mime = options.mime ?? 'application/octet-stream';
  const totalBytes = options.bytes ?? Math.round((payload.length * 3) / 4);
  const timestamp = nowIso();

  await env.DB.prepare(`DELETE FROM ${table} WHERE ${ownerColumn} = ?`).bind(ownerId).run();

  const statements: D1PreparedStatement[] = [];
  for (let offset = 0, index = 0; offset < payload.length; offset += BLOB_CHUNK_CHARS, index += 1) {
    const chunk = payload.slice(offset, offset + BLOB_CHUNK_CHARS);
    statements.push(
      env.DB.prepare(
        `INSERT INTO ${table} (${ownerColumn}, chunk_index, data_b64, bytes, mime, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(ownerId, index, chunk, index === 0 ? totalBytes : 0, mime, timestamp),
    );
  }

  for (let i = 0; i < statements.length; i += 40) {
    await env.DB.batch(statements.slice(i, i + 40));
  }
  return { chunks: statements.length, bytes: totalBytes };
}

export async function getBlob(
  env: Env,
  table: BlobTable,
  ownerColumn: 'asset_id' | 'response_id' | 'user_id',
  ownerId: string,
): Promise<{ base64: string; mime: string; bytes: number } | null> {
  const rows = await env.DB.prepare(
    `SELECT chunk_index, data_b64, bytes, mime FROM ${table}
      WHERE ${ownerColumn} = ? ORDER BY chunk_index`,
  )
    .bind(ownerId)
    .all<{ chunk_index: number; data_b64: string; bytes: number; mime: string }>();
  if (rows.results.length === 0) return null;

  const base64 = rows.results.map((row) => row.data_b64).join('');
  const first = rows.results[0]!;
  return {
    base64,
    mime: first.mime,
    bytes: first.bytes || Math.round((base64.length * 3) / 4),
  };
}

export async function deleteBlob(
  env: Env,
  table: BlobTable,
  ownerColumn: 'asset_id' | 'response_id' | 'user_id',
  ownerId: string,
): Promise<void> {
  await env.DB.prepare(`DELETE FROM ${table} WHERE ${ownerColumn} = ?`).bind(ownerId).run();
}

/** Encodes bytes as base64 without Node buffers, so it runs in a Worker and in a test. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  // Chunked so a large file cannot blow the argument limit of `apply`.
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

/** Decodes base64 into bytes without Node buffers (Workers + browser safe). */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * Parses a `Range: bytes=start-end` header against a known length.
 * Returns null when the header is absent or unsatisfiable (the caller then sends
 * the whole body, or a 416 for an unsatisfiable range).
 */
export function parseRange(header: string | null, length: number): { start: number; end: number } | null | 'unsatisfiable' {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  let start = rawStart ? Number.parseInt(rawStart, 10) : Number.NaN;
  let end = rawEnd ? Number.parseInt(rawEnd, 10) : Number.NaN;
  if (Number.isNaN(start) && Number.isNaN(end)) return 'unsatisfiable';
  if (Number.isNaN(start)) {
    // Suffix range: the last N bytes.
    start = Math.max(0, length - end);
    end = length - 1;
  } else if (Number.isNaN(end)) {
    end = length - 1;
  }
  if (start > end || start >= length) return 'unsatisfiable';
  return { start, end: Math.min(end, length - 1) };
}
