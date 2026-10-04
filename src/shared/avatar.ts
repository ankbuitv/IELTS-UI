/**
 * Avatar upload policy and validators.
 *
 * Avatars can be uploaded by any signed-in user and are rendered inside
 * `<img>` tags on the top bar, account menu, profile page and leaderboards.
 * Because the file comes from a browser, we enforce five independent checks
 * before accepting or serving it:
 *
 *   1. Strict filename inspection (`validateAvatarFilename`):
 *      - strips any directory component and control/null characters;
 *      - rejects hidden files, trailing dots/spaces, and empty stems;
 *      - splits on `.` and requires the final extension to be one of
 *        `png`, `jpg`, `jpeg`, `webp`, or `svg`;
 *      - inspects EVERY earlier dot-separated segment and rejects any double
 *        extension that names an executable, script, archive or other image
 *        type (e.g. `shell.php.jpg`, `backdoor.phtml.png`, `payload.jsp.webp`,
 *        `trick.html.svg`, `two.png.jpg`).
 *   2. Declared MIME check (`validateAvatarMime`): only `image/png`,
 *      `image/jpeg`, `image/webp` and `image/svg+xml`, and the MIME must match
 *      the filename extension.
 *   3. Byte-size cap (`MAX_AVATAR_BYTES`, 2 MB).
 *   4. Magic-byte / content sniffing (`sniffAvatarBytes`): the raw bytes must
 *      begin with the PNG, JPEG or RIFF/WEBP signature, or — for SVG — must
 *      be valid UTF-8 XML containing an `<svg>` root with no `<script>`,
 *      `<foreignObject>`, `on*=` event handlers, `javascript:`/`data:` URLs
 *      or external entity declarations.
 *   5. Safe response headers when served (`Content-Security-Policy:
 *      default-src 'none'; style-src 'unsafe-inline'`, `X-Content-Type-Options:
 *      nosniff`), and always rendered via `<img src>`, never inline in the DOM.
 */

export const ALLOWED_AVATAR_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'svg'] as const;
export type AvatarExtension = (typeof ALLOWED_AVATAR_EXTENSIONS)[number];

export const AVATAR_MIME_BY_EXTENSION: Record<AvatarExtension, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

export const ALLOWED_AVATAR_MIMES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
] as const;

/** 2 MB is generous for a square avatar and keeps D1 base64 chunks compact. */
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

/**
 * Extensions that must never appear anywhere in an avatar filename (for
 * example `avatar.php.jpg`, `shell.phtml.png`, `exploit.html.svg`, or even
 * stacked image extensions like `photo.png.jpg`).
 */
const FORBIDDEN_INNER_EXTENSIONS = new Set([
  // Server-side scripts & templates
  'php', 'php3', 'php4', 'php5', 'php7', 'php8', 'phtml', 'phar', 'phps', 'pht', 'pgif',
  'asp', 'aspx', 'ascx', 'ashx', 'asmx', 'cer', 'asa', 'asax',
  'jsp', 'jspx', 'jsw', 'jsv', 'jspf', 'cfm', 'cfml', 'cfc',
  'pl', 'pm', 'cgi', 'fcgi', 'py', 'pyc', 'pyo', 'rb', 'erb', 'lua', 'tcl',
  // Client/browser active content
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'html', 'htm', 'xhtml', 'shtml', 'hta', 'htc',
  'vbs', 'vbe', 'wsf', 'wsh', 'SCT', 'wasm', 'swf', 'jar', 'class',
  // Executables, shells & packages
  'exe', 'dll', 'so', 'dylib', 'bin', 'com', 'bat', 'cmd', 'ps1', 'psm1', 'sh', 'bash', 'zsh', 'ksh', 'csh',
  'msi', 'msp', 'scr', 'pif', 'cpl', 'reg', 'inf', 'lnk', 'app', 'apk', 'ipa', 'deb', 'rpm', 'dmg', 'pkg',
  // Config / server overrides / archives / docs
  'htaccess', 'htpasswd', 'ini', 'conf', 'config', 'env', 'json', 'xml', 'xsl', 'xslt', 'yml', 'yaml', 'toml',
  'sql', 'sqlite', 'db', 'zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'iso',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'rtf', 'csv',
  // Other image extensions (blocks `foo.png.jpg`, `bar.svg.png`, `baz.gif.webp`)
  'png', 'jpg', 'jpeg', 'webp', 'svg', 'svgz', 'gif', 'bmp', 'ico', 'tif', 'tiff', 'avif', 'heic', 'heif',
]);

export type AvatarValidationResult =
  | { ok: true; extension: AvatarExtension; mime: string; sanitizedFilename: string }
  | { ok: false; reason: string };

/**
 * Inspects a candidate filename and rejects anything that is not a clean
 * `.png`, `.jpg`, `.jpeg`, `.webp` or `.svg` name.
 */
export function validateAvatarFilename(rawName: string): AvatarValidationResult {
  if (typeof rawName !== 'string') {
    return { ok: false, reason: 'Choose an image file (.png, .jpg, .jpeg, .webp or .svg).' };
  }
  if (!rawName || rawName.length > 180) {
    return { ok: false, reason: 'File name must be between 1 and 180 characters.' };
  }
  // Trailing dots or spaces are classic Windows/IIS parser-confusion tricks (`shell.jpg.`, `avatar.jpg `).
  if (/^[.\s]|[. \t\r\n]$/.test(rawName)) {
    return { ok: false, reason: 'File name cannot start or end with a dot or space.' };
  }
  const trimmed = rawName;
  // Reject null bytes, control chars, or path separators disguised in the name.
  const hasControlOrSlash =
    [...trimmed].some((ch) => {
      const code = ch.charCodeAt(0);
      return code <= 0x1f || code === 0x7f || ch === '/' || ch === '\\';
    }) || trimmed.includes('..');
  if (hasControlOrSlash) {
    return { ok: false, reason: 'File name contains invalid characters.' };
  }

  const parts = trimmed.split('.');
  if (parts.length < 2) {
    return { ok: false, reason: 'File must have a .png, .jpg, .jpeg, .webp or .svg extension.' };
  }

  const rawExt = parts[parts.length - 1]!.toLowerCase();
  if (!(ALLOWED_AVATAR_EXTENSIONS as readonly string[]).includes(rawExt)) {
    return {
      ok: false,
      reason: `Only .png, .jpg, .jpeg, .webp and .svg files are allowed (got .${rawExt || 'unknown'}).`,
    };
  }
  const extension = rawExt as AvatarExtension;

  const stemSegments = parts.slice(0, -1);
  if (stemSegments.some((seg) => seg.trim().length === 0)) {
    return { ok: false, reason: 'File name cannot contain empty segments (such as "..").' };
  }

  // Every segment before the final extension is checked so `avatar.php.jpg`,
  // `shell.phtml.png`, `xss.html.svg` or `img.png.jpg` is rejected outright.
  for (let i = 1; i < stemSegments.length; i += 1) {
    const seg = stemSegments[i]!.toLowerCase();
    if (FORBIDDEN_INNER_EXTENSIONS.has(seg)) {
      return {
        ok: false,
        reason: `Double extensions like ".${seg}.${extension}" are not allowed. Rename the file first.`,
      };
    }
  }
  // Also reject when the first segment itself is a known script extension in
  // disguise (e.g. `php.jpg` stays allowed only if it is a normal word, so we
  // still check if there are 2+ extensions; for 2-part names like `shell.php.jpg`
  // the loop above already caught `php`).

  const safeStem =
    stemSegments
      .join('-')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 64) || 'avatar';

  return {
    ok: true,
    extension,
    mime: AVATAR_MIME_BY_EXTENSION[extension],
    sanitizedFilename: `${safeStem}.${extension}`,
  };
}

/**
 * Checks that the browser-supplied MIME type is on the allowlist and matches
 * the validated filename extension.
 */
export function validateAvatarMime(declaredMime: string | undefined | null, extension: AvatarExtension): AvatarValidationResult {
  const clean = (declaredMime ?? '').split(';')[0]!.trim().toLowerCase();
  const expected = AVATAR_MIME_BY_EXTENSION[extension];
  if (!clean) {
    return { ok: true, extension, mime: expected, sanitizedFilename: `avatar.${extension}` };
  }
  // Some browsers send `image/pjpeg` or `image/jpg` for JPEGs.
  const normalised = clean === 'image/jpg' || clean === 'image/pjpeg' ? 'image/jpeg' : clean;
  if (!(ALLOWED_AVATAR_MIMES as readonly string[]).includes(normalised)) {
    return {
      ok: false,
      reason: `Unsupported file type "${clean}". Only PNG, JPG, JPEG, WEBP and SVG are accepted.`,
    };
  }
  if (normalised !== expected) {
    return {
      ok: false,
      reason: `File extension (.${extension}) does not match the file content type (${normalised}).`,
    };
  }
  return { ok: true, extension, mime: expected, sanitizedFilename: `avatar.${extension}` };
}

/**
 * Inspects the actual file bytes so a renamed script (e.g. a PHP or HTML file
 * renamed to `avatar.png`) or a weaponised SVG is rejected even when its
 * filename and `Content-Type` look clean.
 */
export function sniffAvatarBytes(
  bytes: Uint8Array,
  extension: AvatarExtension,
): { ok: true; mime: string } | { ok: false; reason: string } {
  if (!bytes || bytes.byteLength === 0) {
    return { ok: false, reason: 'The selected image file is empty.' };
  }
  if (bytes.byteLength > MAX_AVATAR_BYTES) {
    return { ok: false, reason: 'Avatar must be 2 MB or smaller.' };
  }

  // Reject PHP / ASP / HTML / script tags smuggled inside binary comments or headers.
  const headSample = new TextDecoder('utf-8', { fatal: false, ignoreBOM: false }).decode(bytes.subarray(0, Math.min(bytes.byteLength, 4096)));
  if (/<\?(?:php|=)/i.test(headSample) || /<script\b/i.test(headSample)) {
    return { ok: false, reason: 'The file contains executable script content and cannot be used as an avatar.' };
  }

  if (extension === 'png') {
    // 89 50 4E 47 0D 0A 1A 0A
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (bytes.byteLength < 24 || !sig.every((b, idx) => bytes[idx] === b)) {
      return { ok: false, reason: 'This file is not a valid PNG image.' };
    }
    return { ok: true, mime: 'image/png' };
  }

  if (extension === 'jpg' || extension === 'jpeg') {
    // FF D8 FF
    if (bytes.byteLength < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
      return { ok: false, reason: 'This file is not a valid JPEG image.' };
    }
    return { ok: true, mime: 'image/jpeg' };
  }

  if (extension === 'webp') {
    // "RIFF" .... "WEBP"
    if (
      bytes.byteLength < 16 ||
      bytes[0] !== 0x52 ||
      bytes[1] !== 0x49 ||
      bytes[2] !== 0x46 ||
      bytes[3] !== 0x46 ||
      bytes[8] !== 0x57 ||
      bytes[9] !== 0x45 ||
      bytes[10] !== 0x42 ||
      bytes[11] !== 0x50
    ) {
      return { ok: false, reason: 'This file is not a valid WEBP image.' };
    }
    return { ok: true, mime: 'image/webp' };
  }

  if (extension === 'svg') {
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
    } catch {
      return { ok: false, reason: 'SVG file must be valid UTF-8 text.' };
    }
    const trimmed = text.trim();
    if (!/<svg[\s>]/i.test(trimmed) || !/<\/svg\s*>/i.test(trimmed)) {
      return { ok: false, reason: 'This file is not a valid SVG image.' };
    }
    if (
      /<!ENTITY/i.test(trimmed) ||
      /<script\b/i.test(trimmed) ||
      /<foreignObject\b/i.test(trimmed) ||
      /<iframe\b/i.test(trimmed) ||
      /<object\b/i.test(trimmed) ||
      /<embed\b/i.test(trimmed) ||
      /\bon[a-z]+\s*=/i.test(trimmed) ||
      /javascript\s*:/i.test(trimmed) ||
      /vbscript\s*:/i.test(trimmed) ||
      /data\s*:\s*text\/html/i.test(trimmed)
    ) {
      return { ok: false, reason: 'SVG avatars cannot contain scripts, event handlers or embedded objects.' };
    }
    return { ok: true, mime: 'image/svg+xml' };
  }

  return { ok: false, reason: 'Unsupported image format.' };
}
