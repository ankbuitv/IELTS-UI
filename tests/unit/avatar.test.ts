import { describe, expect, it } from 'vitest';
import {
  AVATAR_ACCEPT,
  AVATAR_EXTENSIONS,
  AVATAR_MAX_BYTES,
  AVATAR_PRESETS,
  AVATAR_SVG_MAX_BYTES,
  EMPTY_AVATAR,
  checkSvgSafety,
  inspectAvatarFilename,
  isAvatarPreset,
  mimeMatchesType,
  sniffImageType,
  validateAvatar,
} from '../../src/shared/avatar';

/**
 * The avatar upload policy.
 *
 * These tests are the specification for the one part of the feature that has to
 * be right: what a server will accept as a picture. Every case below is a thing
 * that was actually tried against the endpoint during development (see the
 * notes on each), and each asserts the *code* as well as the outcome, so a
 * rewrite that keeps the behaviour but loses the reason still fails here.
 */

// ---------------------------------------------------------------------------
// Fixtures: real magic bytes, not placeholders. A validator that only ever sees
// well-formed input proves nothing.
// ---------------------------------------------------------------------------
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const WEBP = new TextEncoder().encode('RIFF\x24\x00\x00\x00WEBPVP8 ');
const GIF = new TextEncoder().encode('GIF89a\x01\x00\x01\x00');
const PHP = new TextEncoder().encode('<?php system($_GET["c"]); ?>');
const SVG_SAFE = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#e23a41"/></svg>',
);

describe('avatar filename policy', () => {
  it('accepts the five extensions the file picker offers', () => {
    for (const [name, type] of [
      ['photo.png', 'png'],
      ['photo.jpg', 'jpeg'],
      ['photo.jpeg', 'jpeg'],
      ['photo.webp', 'webp'],
      ['drawing.svg', 'svg'],
    ] as const) {
      const checked = inspectAvatarFilename(name);
      expect(checked.ok, name).toBe(true);
      if (checked.ok) expect(checked.type).toBe(type);
    }
  });

  it('reads every tail, so a script behind an image extension is refused', () => {
    // The case the feature exists for: the extension the OS shows is `.jpg`,
    // and the part that matters is `.php`.
    const checked = inspectAvatarFilename('shell.php.jpg');
    expect(checked.ok).toBe(false);
    if (!checked.ok) expect(checked.code).toBe('EXTENSION_NOT_ALLOWED');
  });

  it('refuses two image extensions that disagree, even though both are allowed', () => {
    // `photo.jpg.png` is not a PHP trick, but it is still a name that describes
    // two different files, and the server has to pick one. It does not guess.
    const checked = inspectAvatarFilename('photo.jpg.png');
    expect(checked.ok).toBe(false);
    if (!checked.ok) expect(checked.code).toBe('EXTENSIONS_DISAGREE');
  });

  it('accepts a repeated tail, which is a name and not a contradiction', () => {
    // `backup.png.png` says one thing twice. Refusing it would be strictness
    // with no rule behind it.
    const checked = inspectAvatarFilename('backup.png.png');
    expect(checked.ok).toBe(true);
    if (checked.ok) expect(checked.type).toBe('png');
  });

  it('is case-insensitive about the extension but not about the shape', () => {
    expect(inspectAvatarFilename('PHOTO.PNG').ok).toBe(true);
    expect(inspectAvatarFilename('photo.Png').ok).toBe(true);
  });

  it('refuses a name with no extension, only an extension, or a trailing dot', () => {
    for (const name of ['photo', '.png', 'photo.', '.']) {
      const checked = inspectAvatarFilename(name);
      expect(checked.ok, name).toBe(false);
      if (!checked.ok) expect(['NO_EXTENSION', 'EMPTY_NAME', 'EXTENSION_NOT_ALLOWED']).toContain(checked.code);
    }
  });

  it('refuses a path, a traversal and a URL masquerading as a filename', () => {
    for (const name of ['a/../b.png', '/etc/passwd.png', 'C:\\photos\\me.png', 'https://evil.test/x.png']) {
      const checked = inspectAvatarFilename(name);
      expect(checked.ok, name).toBe(false);
      if (!checked.ok) expect(checked.code).toBe('NAME_CHARACTERS');
    }
  });

  it('refuses control characters, including a NUL that would truncate the name', () => {
    // "photo.png\0.php" is the classic: a C string stops at the NUL, a JS
    // string does not, and the two disagree about what the file is called.
    for (const name of ['photo.png\u0000.php', 'photo\n.png', 'photo\u001b.png', 'photo\u007f.png']) {
      const checked = inspectAvatarFilename(name);
      expect(checked.ok, name).toBe(false);
      if (!checked.ok) expect(checked.code).toBe('NAME_CHARACTERS');
    }
  });

  it('refuses an over-long name rather than storing it and hoping', () => {
    const checked = inspectAvatarFilename(`${'a'.repeat(140)}.png`);
    expect(checked.ok).toBe(false);
    if (!checked.ok) expect(checked.code).toBe('NAME_TOO_LONG');
  });

  it('accepts the ordinary punctuation a real filename has', () => {
    for (const name of ['my photo (1).png', 'holiday-2026.jpeg', "o'brien.webp", 'img_0042.JPG']) {
      expect(inspectAvatarFilename(name).ok, name).toBe(true);
    }
  });

  it('reports the base name so the stored name can be normalised', () => {
    const checked = inspectAvatarFilename('Holiday Photo.PNG');
    expect(checked.ok).toBe(true);
    if (checked.ok) {
      expect(checked.base).toBe('Holiday Photo');
      expect(checked.extension).toBe('png');
      expect(checked.mime).toBe('image/png');
    }
  });

  it('publishes exactly the extensions it accepts', () => {
    expect(AVATAR_ACCEPT).toBe('.png,.jpg,.jpeg,.svg,.webp');
    expect([...AVATAR_EXTENSIONS]).toEqual(['png', 'jpg', 'jpeg', 'svg', 'webp']);
  });
});

describe('declared content type', () => {
  it('agrees with the name when both describe the same picture', () => {
    expect(mimeMatchesType('image/png', 'png')).toBe(true);
    expect(mimeMatchesType('image/jpeg', 'jpeg')).toBe(true);
    expect(mimeMatchesType('image/svg+xml', 'svg')).toBe(true);
    expect(mimeMatchesType('image/webp', 'webp')).toBe(true);
  });

  it('ignores a charset or a wrong-case type, which browsers do send', () => {
    expect(mimeMatchesType('IMAGE/PNG', 'png')).toBe(true);
    expect(mimeMatchesType('image/svg+xml; charset=utf-8', 'svg')).toBe(true);
  });

  it('refuses a type that names something else', () => {
    expect(mimeMatchesType('image/gif', 'png')).toBe(false);
    expect(mimeMatchesType('text/plain', 'png')).toBe(false);
    expect(mimeMatchesType('application/x-php', 'png')).toBe(false);
    expect(mimeMatchesType('', 'png')).toBe(false);
    expect(mimeMatchesType(null, 'png')).toBe(false);
  });
});

describe('magic bytes', () => {
  it('recognises the four types it stores', () => {
    expect(sniffImageType(PNG)).toBe('png');
    expect(sniffImageType(JPEG)).toBe('jpeg');
    expect(sniffImageType(WEBP)).toBe('webp');
    expect(sniffImageType(SVG_SAFE)).toBe('svg');
  });

  it('does not mistake another image format for an allowed one', () => {
    // A GIF is a real picture and still refused: the whitelist is the whitelist,
    // and the reason is that only these four were reviewed for what they can do.
    expect(sniffImageType(GIF)).toBeNull();
  });

  it('does not mistake code for a picture', () => {
    expect(sniffImageType(PHP)).toBeNull();
    expect(sniffImageType(new Uint8Array(0))).toBeNull();
    expect(sniffImageType(new TextEncoder().encode('not an image at all'))).toBeNull();
  });

  it('reads an SVG through a doctype or an XML declaration', () => {
    expect(sniffImageType(new TextEncoder().encode('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe('svg');
    expect(
      sniffImageType(new TextEncoder().encode('<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd"><svg/>')),
    ).toBe('svg');
  });

  it('refuses text that merely mentions svg somewhere inside it', () => {
    // `<html><body>the word <svg appears here</body></html>` is not an SVG
    // document: what the document *begins* with decides, once the preamble is
    // stripped. Searching for the first `<svg` anywhere would have accepted this.
    expect(sniffImageType(new TextEncoder().encode('<html><body>an <svg> tag</body></html>'))).toBeNull();
    expect(sniffImageType(new TextEncoder().encode('the string <svg/> in a sentence'))).toBeNull();
  });

  it('accepts an empty <svg/> and preamble in any order', () => {
    expect(sniffImageType(new TextEncoder().encode('<svg/>'))).toBe('svg');
    expect(sniffImageType(new TextEncoder().encode('\ufeff  <!-- a comment -->\n<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe(
      'svg',
    );
  });
});

describe('SVG safety', () => {
  it('passes a plain drawing', () => {
    expect(checkSvgSafety(new TextDecoder().decode(SVG_SAFE))).toBeNull();
  });

  it('refuses the ways an SVG can execute or reach out', () => {
    for (const text of [
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><body xmlns="http://www.w3.org/1999/xhtml"/></foreignObject></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><iframe src="//evil.test"/></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><embed src="x.swf"/></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><object data="x.html"/></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>',
      '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><text>x</text></a></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="data:text/html,<script>alert(1)</script>"/></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="//evil.test/x.png"/></svg>',
      // A relative path resolves against whatever document embeds this one.
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><use xlink:href="../secret.svg"/></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><a href="https://evil.test"><text>click</text></a></svg>',
    ]) {
      expect(checkSvgSafety(text), text.slice(0, 60)).not.toBeNull();
    }
  });

  it('still allows the two references an SVG legitimately makes', () => {
    // Its own defs, and a raster embedded by whichever tool exported it. Both are
    // unreachable from outside the document, which is why they are not refused.
    expect(
      checkSvgSafety(
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">' +
          '<defs><linearGradient id="g"/></defs><rect fill="url(#g)"/><use xlink:href="#g"/></svg>',
      ),
    ).toBeNull();
    expect(
      checkSvgSafety(
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">' +
          '<image xlink:href="data:image/png;base64,iVBORw0KGgo="/></svg>',
      ),
    ).toBeNull();
  });

  it('is not fooled by case or by whitespace inside the tag', () => {
    expect(checkSvgSafety('<SVG><SCRIPT>alert(1)</SCRIPT></SVG>')).not.toBeNull();
    expect(checkSvgSafety('<svg><script\n>alert(1)</script></svg>')).not.toBeNull();
    expect(checkSvgSafety('<svg onLOAD="alert(1)"/>')).not.toBeNull();
  });
});

describe('validateAvatar', () => {
  it('accepts a picture whose name, type and bytes all agree', () => {
    const result = validateAvatar({ filename: 'me.png', mime: 'image/png', bytes: PNG });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.type).toBe('png');
      expect(result.extension).toBe('png');
      // The stored name is rebuilt from the validated parts, never taken from
      // the submitted string: that is what stops a path or a second extension
      // reaching the row even if some later code trusted `candidate.filename`.
      expect(result.base).toBe('me');
      expect(result.mime).toBe('image/png');
      expect(result.bytes).toBe(PNG.length);
    }
  });

  it('refuses a mismatch at every layer, and says which layer', () => {
    const cases = [
      [{ filename: 'shell.php.jpg', mime: 'image/jpeg', bytes: JPEG }, 'EXTENSION_NOT_ALLOWED'],
      [{ filename: 'photo.jpg.png', mime: 'image/png', bytes: PNG }, 'EXTENSIONS_DISAGREE'],
      [{ filename: 'me.png', mime: 'image/gif', bytes: PNG }, 'MIME_DISAGREES'],
      [{ filename: 'me.png', mime: 'image/png', bytes: JPEG }, 'SIGNATURE_MISMATCH'],
      [{ filename: 'me.png', mime: 'image/png', bytes: PHP }, 'NOT_AN_IMAGE'],
      [{ filename: 'me.png', mime: 'image/png', bytes: new Uint8Array(0) }, 'UNREADABLE'],
      [{ filename: '', mime: 'image/png', bytes: PNG }, 'EMPTY_NAME'],
    ] as const;
    for (const [candidate, code] of cases) {
      const result = validateAvatar(candidate);
      expect(result.ok, `${candidate.filename} → ${code}`).toBe(false);
      if (!result.ok) expect(result.code).toBe(code);
    }
  });

  it('enforces a smaller budget for SVG, which is text and is parsed', () => {
    expect(AVATAR_SVG_MAX_BYTES).toBeLessThan(AVATAR_MAX_BYTES);
    const bigSvg = new TextEncoder().encode(
      `<svg xmlns="http://www.w3.org/2000/svg">${'<rect width="1" height="1"/>'.repeat(9000)}</svg>`,
    );
    expect(bigSvg.length).toBeGreaterThan(AVATAR_SVG_MAX_BYTES);
    const result = validateAvatar({ filename: 'big.svg', mime: 'image/svg+xml', bytes: bigSvg });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('TOO_LARGE');
  });

  it('refuses a raster picture over the size limit', () => {
    const fat = new Uint8Array(AVATAR_MAX_BYTES + 1);
    fat.set(PNG, 0);
    const result = validateAvatar({ filename: 'fat.png', mime: 'image/png', bytes: fat });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('TOO_LARGE');
  });

  it('refuses an SVG that is well formed and still dangerous', () => {
    const bytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const result = validateAvatar({ filename: 'evil.svg', mime: 'image/svg+xml', bytes });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('SVG_UNSAFE');
  });

  it('checks the name before the bytes, so a bad name is never half-processed', () => {
    const result = validateAvatar({ filename: 'shell.php.jpg', mime: 'image/png', bytes: PHP });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('EXTENSION_NOT_ALLOWED');
  });

  it('writes a refusal a person can act on', () => {
    const result = validateAvatar({ filename: 'shell.php.jpg', mime: 'image/jpeg', bytes: JPEG });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('.php');
      expect(result.reason.toLowerCase()).toContain('png');
      expect(result.reason.length).toBeGreaterThan(30);
    }
  });
});

describe('presets', () => {
  it('accepts every coat the client can draw and nothing else', () => {
    for (const preset of AVATAR_PRESETS) expect(isAvatarPreset(preset)).toBe(true);
    expect(isAvatarPreset('sprout')).toBe(true);
    expect(isAvatarPreset('nope')).toBe(false);
    expect(isAvatarPreset('../../etc/passwd')).toBe(false);
    expect(isAvatarPreset('')).toBe(false);
    expect(isAvatarPreset(null)).toBe(false);
    expect(isAvatarPreset(12)).toBe(false);
  });

  it('keeps the empty avatar free of any claim about a picture', () => {
    expect(EMPTY_AVATAR).toEqual({
      kind: '',
      preset: '',
      mime: '',
      bytes: 0,
      filename: '',
      updatedAt: null,
      dataUrl: null,
    });
  });
});
