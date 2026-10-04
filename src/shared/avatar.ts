/**
 * Avatars: what a profile picture is allowed to be.
 *
 * These rules live in `shared` rather than in the Worker for one reason — the
 * browser runs the *same* check before it uploads, so a learner who picks
 * `holiday.php.jpg` is told why in the file picker instead of after a round
 * trip, and there is no second copy of the policy to drift. The server runs it
 * again on the bytes it actually received, because a client-side check is a
 * courtesy and never a control.
 *
 * The threat being closed here is a picture that is not a picture. Three things
 * have to agree before an upload is accepted:
 *
 *   1. **the name** — every dot-separated tail of the filename must be one of
 *      the five allowed image extensions, and they must all mean the same image
 *      type. This is what rejects `shell.php.jpg`, `payload.html.png` and
 *      `photo.jpg.png` (jpeg and png are not the same type), while still
 *      allowing `my.cat.jpeg`;
 *   2. **the declared type** — the `Content-Type` the browser sent must be the
 *      type the name claims, so a renamed file cannot smuggle `text/html`
 *      through a `.png` ending;
 *   3. **the bytes** — the file's own signature must be that type. A PNG starts
 *      with eight specific bytes, a JPEG with `FF D8 FF`, a WEBP is a RIFF box
 *      whose second box says `WEBP`, and an SVG is text that opens an `<svg>`
 *      element. Nothing is trusted from the name or the header once the bytes
 *      have been read.
 *
 * SVG gets one more pass, because it is the only format here that is a document
 * rather than a bitmap: it is scanned for script, event handlers, foreign
 * objects and `javascript:` URLs. An SVG in an `<img>` cannot execute anything,
 * but the same file could be opened directly, served inline by another feature
 * later, or downloaded — so it is refused at the door rather than defused on
 * the way out.
 */

/** The five extensions an avatar may have. Nothing else, ever. */
export const AVATAR_EXTENSIONS = ['png', 'jpg', 'jpeg', 'svg', 'webp'] as const;
export type AvatarExtension = (typeof AVATAR_EXTENSIONS)[number];

/** The image types those extensions stand for. */
export const AVATAR_TYPES = ['png', 'jpeg', 'webp', 'svg'] as const;
export type AvatarType = (typeof AVATAR_TYPES)[number];

export const AVATAR_MIME_BY_TYPE: Record<AvatarType, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

/** `jpg` and `jpeg` are the same picture with two spellings; both are accepted. */
const TYPE_BY_EXTENSION: Record<string, AvatarType> = {
  png: 'png',
  jpg: 'jpeg',
  jpeg: 'jpeg',
  webp: 'webp',
  svg: 'svg',
};

/**
 * The most an avatar may weigh.
 *
 * The browser downscales to 256 px before it uploads, so a real photograph
 * arrives at 20–80 KB; this ceiling exists to stop somebody storing a 20 MB
 * image as a profile picture in a database that has no object storage. SVG is
 * held to a tighter limit below because it is text and is scanned.
 */
export const AVATAR_MAX_BYTES = 512 * 1024;
export const AVATAR_SVG_MAX_BYTES = 128 * 1024;

/** Mascot coats a learner may pick instead of uploading anything. */
export const AVATAR_PRESETS = [
  'sprout',
  'brand',
  'scholar',
  'ocean',
  'sunset',
  'violet',
  'berry',
  'mint',
  'gold',
] as const;
export type AvatarPreset = (typeof AVATAR_PRESETS)[number];

export function isAvatarPreset(value: unknown): value is AvatarPreset {
  return typeof value === 'string' && (AVATAR_PRESETS as readonly string[]).includes(value);
}

export type AvatarKind = '' | 'PRESET' | 'UPLOAD';

export interface AvatarState {
  kind: AvatarKind;
  /** The coat name when `kind` is PRESET. */
  preset: string;
  mime: string;
  bytes: number;
  /** The filename the learner uploaded, kept only to describe the picture back to them. */
  filename: string;
  updatedAt: string | null;
  /** `data:<mime>;base64,…` when an upload is stored; null otherwise. */
  dataUrl: string | null;
}

export const EMPTY_AVATAR: AvatarState = {
  kind: '',
  preset: '',
  mime: '',
  bytes: 0,
  filename: '',
  updatedAt: null,
  dataUrl: null,
};

/** What went wrong, in the words the file picker shows. */
export interface AvatarRejection {
  ok: false;
  reason: string;
  /** The rule that refused it, so a test can assert the policy rather than the prose. */
  code:
    | 'EMPTY_NAME'
    | 'NAME_TOO_LONG'
    | 'NAME_CHARACTERS'
    | 'NO_EXTENSION'
    | 'EXTENSION_NOT_ALLOWED'
    | 'EXTENSIONS_DISAGREE'
    | 'MIME_DISAGREES'
    | 'TOO_LARGE'
    | 'UNREADABLE'
    | 'SIGNATURE_MISMATCH'
    | 'SVG_UNSAFE'
    | 'NOT_AN_IMAGE';
}

export type AvatarNameCheck = { ok: true; type: AvatarType; mime: string; extension: AvatarExtension; base: string } | AvatarRejection;

const NAME_CHARACTER = /[^\w .'’\-()]/;

/**
 * C0 controls and DEL, by code point.
 *
 * Written as a loop rather than a character-class regex because a pattern
 * containing a literal control character is exactly the thing a linter (and a
 * reviewer) should refuse to see in a filename validator — and because the loop
 * says what it means. A NUL or a newline inside a submitted name is the oldest
 * way to make a server and a filesystem disagree about what a file is called.
 */
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Reads a filename the way the policy needs it read: carefully.
 *
 * The whole point is the tails. `avatar.php.jpg` has two of them, and the one
 * that matters is not the last — so *every* part after a dot is checked, not
 * just the extension the operating system would show. They must all be image
 * extensions and they must all mean the same type, which turns "ends in .jpg"
 * into "is described as a jpeg from beginning to end".
 *
 * That rule is deliberately stricter than "reject known-bad tails". It also
 * refuses an innocent `my.cat.jpeg`, because a validator that makes exceptions
 * for parts that merely look harmless is a validator with a second, unwritten
 * rule — and the exception is where the bypass lives. The refusal says how to
 * rename the file, so the cost of being strict is one keystroke.
 */
export function inspectAvatarFilename(rawName: string): AvatarNameCheck {
  const name = String(rawName ?? '').trim();
  if (!name) return { ok: false, code: 'EMPTY_NAME', reason: 'The file has no name.' };
  if (name.length > 120) return { ok: false, code: 'NAME_TOO_LONG', reason: 'That filename is longer than 120 characters.' };
  // A path, a URL or a control character in a "filename" is not a filename.
  if (name.includes('/') || name.includes('\\') || hasControlCharacter(name)) {
    return { ok: false, code: 'NAME_CHARACTERS', reason: 'That filename contains a path or a control character.' };
  }
  if (NAME_CHARACTER.test(name)) {
    return {
      ok: false,
      code: 'NAME_CHARACTERS',
      reason: 'Use letters, numbers, spaces, dots, dashes and underscores only.',
    };
  }
  if (name.startsWith('.') || name.endsWith('.')) {
    return { ok: false, code: 'NO_EXTENSION', reason: 'That filename has no usable extension.' };
  }

  const parts = name.split('.');
  if (parts.length < 2) {
    return { ok: false, code: 'NO_EXTENSION', reason: `Add an extension: ${AVATAR_EXTENSIONS.join(', ')}.` };
  }
  const base = parts[0] ?? '';
  const tails = parts.slice(1).map((part) => part.toLowerCase());
  if (!base.trim()) return { ok: false, code: 'EMPTY_NAME', reason: 'The file has no name before its extension.' };

  for (const tail of tails) {
    if (!(AVATAR_EXTENSIONS as readonly string[]).includes(tail)) {
      return {
        ok: false,
        code: 'EXTENSION_NOT_ALLOWED',
        reason: `“.${tail}” is not an accepted avatar type. Only ${AVATAR_EXTENSIONS.join(', ')} are — every part of the name after a dot has to be one of them, so “photo.php.jpg” is refused whatever follows it. If your file is called “${base || 'picture'}.${tail}…”, rename it to “${(base || 'picture').replace(/\s+/g, '-')}.${tails[tails.length - 1] ?? 'png'}”.`,
      };
    }
  }

  const types = new Set(tails.map((tail) => TYPE_BY_EXTENSION[tail]!));
  if (types.size !== 1) {
    return {
      ok: false,
      code: 'EXTENSIONS_DISAGREE',
      reason: 'That name carries two different image extensions. Rename it to a single one.',
    };
  }

  const type = [...types][0]!;
  const extension = tails[tails.length - 1] as AvatarExtension;
  return { ok: true, type, mime: AVATAR_MIME_BY_TYPE[type], extension, base };
}

/** True when a declared `Content-Type` matches the image type the name claims. */
export function mimeMatchesType(declared: string | null | undefined, type: AvatarType): boolean {
  const value = String(declared ?? '')
    .split(';')[0]
    ?.trim()
    .toLowerCase();
  if (!value) return false;
  if (value === AVATAR_MIME_BY_TYPE[type]) return true;
  // Browsers disagree about SVG and about the octet-stream fallback; both are
  // resolved by the byte check below, so they are tolerated here rather than
  // turning a legitimate upload into an error message.
  if (type === 'svg' && (value === 'image/svg' || value === 'text/xml' || value === 'application/xml')) return true;
  return value === 'application/octet-stream' || value === 'binary/octet-stream';
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((value, index) => bytes[offset + index] === value);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let out = '';
  for (let index = 0; index < length; index += 1) out += String.fromCharCode(bytes[offset + index] ?? 0);
  return out;
}

/**
 * What the bytes say the file is — the only opinion that counts.
 *
 * Returns null for anything that is not one of the four image types, including
 * every script, archive, document and renamed executable.
 */
export function sniffImageType(bytes: Uint8Array): AvatarType | null {
  // Only an empty file is refused outright. This used to be `length < 12`, which
  // is the longest raster signature below — but that floor belongs to the raster
  // branches, and applying it to the whole function also threw away legitimate
  // short text (a bare `<svg/>` is six bytes). `startsWith` and `ascii` both
  // bound-check on their own, so a short buffer simply fails to match instead of
  // being refused for its length.
  if (!bytes || bytes.length === 0) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  // JPEG: FF D8 FF, and one of the marker segments that always follows.
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
  // WEBP: "RIFF" … "WEBP", then one of the three VP8 boxes.
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    const box = ascii(bytes, 12, 4);
    if (box === 'VP8 ' || box === 'VP8L' || box === 'VP8X') return 'webp';
    return null;
  }
  // SVG: text, and the only type here that has to be *read* rather than matched.
  //
  // The rule is "strip the legitimate preamble, then the document must begin with
  // the <svg> element". Preamble means a BOM, whitespace, comments, an XML
  // declaration and a doctype — all of which real tools emit. Searching for the
  // first `<svg` anywhere in the head instead (which is what this did before) let
  // `<html><body>an <svg> tag</body></html>` pass as a picture, and requiring
  // whitespace after `<svg` rejected a perfectly valid empty `<svg/>`.
  const head = new TextDecoder('utf-8').decode(bytes.subarray(0, 512));
  let text = head.replace(/^\ufeff/, '').trimStart();
  for (;;) {
    const before = text;
    text = text
      .replace(/^(?:<!--[\s\S]*?-->|<\?xml[\s\S]*?\?>|<!doctype[^>]*>|\s+)/i, '')
      .trimStart();
    if (text === before) break;
  }
  // `[\s/>]` so that both `<svg xmlns=…>` and a bare `<svg/>` count.
  return /^<svg[\s/>]/i.test(text) ? 'svg' : null;
}

/** Tokens that make an SVG a document with behaviour rather than a drawing. */
const SVG_FORBIDDEN: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  { pattern: /<\s*script/i, label: 'a script element' },
  { pattern: /<\s*foreignObject/i, label: 'a foreignObject element' },
  { pattern: /<\s*iframe/i, label: 'an iframe' },
  { pattern: /<\s*embed/i, label: 'an embed' },
  { pattern: /<\s*object/i, label: 'an object element' },
  { pattern: /\son[a-z]+\s*=/i, label: 'an inline event handler' },
  { pattern: /javascript\s*:/i, label: 'a javascript: URL' },
  { pattern: /data\s*:\s*text\/html/i, label: 'an embedded HTML document' },
  { pattern: /href\s*=\s*["']?\s*javascript:/i, label: 'a javascript: URL' },
  // A stylesheet in an SVG can @import one from somewhere else, which is the
  // same reach-out as an href with more steps.
  { pattern: /@import/i, label: 'an imported stylesheet' },
];

/**
 * Every `href` / `xlink:href` value in a document, quotes and all.
 *
 * Parsed rather than pattern-matched. The first version of this rule was a single
 * regex with an optional quote and two negative lookaheads — and an optional
 * quote in front of a lookahead means the engine can simply *not* consume the
 * quote, so `(?!#)` was tested against `"` instead of against the URL and
 * `xlink:href="#g"` looked external. A rule that cannot tell a fragment from a
 * host is worse than no rule: it refuses honest files, which trains everybody to
 * stop reading the refusal.
 */
const HREF_VALUE = /(?:xlink:)?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>]+))/gi;

/**
 * True when the document points at anything it does not contain.
 *
 * Exactly two targets are allowed, because they are the only two an avatar has a
 * reason to use and neither can leave the document: a fragment (`#gradient`, how
 * an SVG refers to its own defs) and an embedded raster (`data:image/png;base64,…`,
 * how every design tool exports a photo inside an SVG). Everything else goes —
 * including the two forms a `https?:|data:` alternation lets through: a
 * protocol-relative `//evil.test/x.png`, and a relative path, which resolves
 * against whatever document ends up embedding this one.
 */
function hasExternalReference(text: string): boolean {
  for (const match of text.matchAll(HREF_VALUE)) {
    const value = (match[1] ?? match[2] ?? match[3] ?? '').trim();
    if (!value) continue;
    if (value.startsWith('#')) continue;
    if (/^data:image\//i.test(value)) continue;
    return true;
  }
  return false;
}

/**
 * Scans an SVG for anything that could act rather than draw.
 *
 * Returns the reason to show the learner, or null when the file is a plain
 * drawing. The scan is a refusal, not a sanitizer: an SVG is text, a learner can
 * edit it, and a half-cleaned document is worse than a rejected one because it
 * looks trusted.
 */
export function checkSvgSafety(text: string): string | null {
  for (const rule of SVG_FORBIDDEN) {
    if (rule.pattern.test(text)) return `That SVG contains ${rule.label}, which is not accepted for an avatar.`;
  }
  if (hasExternalReference(text)) {
    return 'That SVG refers to something outside itself, which is not accepted for an avatar.';
  }
  return null;
}

export interface AvatarCandidate {
  filename: string;
  /** The `Content-Type` the browser declared. */
  mime: string | null;
  bytes: Uint8Array;
}

export type AvatarValidation =
  | { ok: true; type: AvatarType; mime: string; bytes: number; base: string; extension: AvatarExtension }
  | AvatarRejection;

/**
 * The whole policy, in one call: name, declared type, size, signature, and (for
 * SVG) content. The Worker runs it on the uploaded bytes; the browser runs it on
 * the file it is about to send, so the two cannot disagree.
 */
export function validateAvatar(candidate: AvatarCandidate): AvatarValidation {
  const named = inspectAvatarFilename(candidate.filename);
  if (!named.ok) return named;

  if (!mimeMatchesType(candidate.mime, named.type)) {
    return {
      ok: false,
      code: 'MIME_DISAGREES',
      reason: `That file was sent as “${candidate.mime ?? 'no type'}” but its name says ${named.mime}.`,
    };
  }

  const limit = named.type === 'svg' ? AVATAR_SVG_MAX_BYTES : AVATAR_MAX_BYTES;
  if (candidate.bytes.byteLength === 0) return { ok: false, code: 'UNREADABLE', reason: 'That file is empty.' };
  if (candidate.bytes.byteLength > limit) {
    return {
      ok: false,
      code: 'TOO_LARGE',
      reason: `That file is ${Math.round(candidate.bytes.byteLength / 1024)} KB; an avatar may be at most ${Math.round(limit / 1024)} KB.`,
    };
  }

  const sniffed = sniffImageType(candidate.bytes);
  if (!sniffed) return { ok: false, code: 'NOT_AN_IMAGE', reason: 'Those bytes are not a PNG, JPEG, WEBP or SVG image.' };
  if (sniffed !== named.type) {
    return {
      ok: false,
      code: 'SIGNATURE_MISMATCH',
      reason: `That file is named .${named.extension} but its contents are ${sniffed.toUpperCase()}. Renaming a file does not change what it is.`,
    };
  }

  if (sniffed === 'svg') {
    const text = new TextDecoder('utf-8').decode(candidate.bytes);
    const unsafe = checkSvgSafety(text);
    if (unsafe) return { ok: false, code: 'SVG_UNSAFE', reason: unsafe };
  }

  return {
    ok: true,
    type: sniffed,
    mime: AVATAR_MIME_BY_TYPE[sniffed],
    bytes: candidate.bytes.byteLength,
    base: named.base,
    extension: named.extension,
  };
}

/** The accepted types, as one line of copy for a file picker. */
export const AVATAR_ACCEPT = AVATAR_EXTENSIONS.map((extension) => `.${extension}`).join(',');
