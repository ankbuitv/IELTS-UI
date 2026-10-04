import { describe, expect, it } from 'vitest';
import {
  ALLOWED_AVATAR_EXTENSIONS,
  MAX_AVATAR_BYTES,
  sniffAvatarBytes,
  validateAvatarFilename,
  validateAvatarMime,
} from '@shared/avatar';
import { buildHeartRecoveryExercises, buildLesson } from '@shared/learn-engine';

describe('validateAvatarFilename', () => {
  it('accepts clean single-extension filenames across all 5 allowed formats', () => {
    expect(ALLOWED_AVATAR_EXTENSIONS).toEqual(['png', 'jpg', 'jpeg', 'webp', 'svg']);
    for (const ext of ALLOWED_AVATAR_EXTENSIONS) {
      const res = validateAvatarFilename(`my-profile_2026.${ext.toUpperCase()}`);
      expect(res.ok, ext).toBe(true);
      if (res.ok) {
        expect(res.extension).toBe(ext);
        expect(res.sanitizedFilename).toBe(`my-profile_2026.${ext}`);
      }
    }
  });

  it('rejects double extensions such as .php.jpg, .phtml.png, .html.svg, .exe.webp, .png.jpg', () => {
    const bad = [
      'shell.php.jpg',
      'avatar.php5.png',
      'cmd.phtml.jpeg',
      'exploit.phar.webp',
      'backdoor.asp.jpg',
      'backdoor.aspx.png',
      'payload.jsp.jpg',
      'script.js.png',
      'xss.html.svg',
      'xss.htm.svg',
      'dropper.exe.webp',
      'autorun.sh.jpg',
      'archive.tar.gz.png',
      'htaccess.htaccess.jpg',
      'stacked.png.jpg',
      'stacked.svg.png',
    ];
    for (const name of bad) {
      const res = validateAvatarFilename(name);
      expect(res.ok, `expected "${name}" to be rejected`).toBe(false);
    }
  });

  it('rejects disallowed extensions, path traversal, trailing dots and hidden files', () => {
    const bad = [
      'avatar.gif',
      'avatar.bmp',
      'avatar.ico',
      'avatar.avif',
      'avatar.pdf',
      'avatar.php',
      '../avatar.png',
      'dir/avatar.png',
      'dir\\avatar.png',
      '.hidden.png',
      'avatar.jpg.',
      'avatar.jpg ',
      'avatar..jpg',
      'no-extension',
      '',
    ];
    for (const name of bad) {
      expect(validateAvatarFilename(name).ok, `expected "${name}" to fail`).toBe(false);
    }
  });
});

describe('validateAvatarMime & sniffAvatarBytes', () => {
  const pngHeader = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1,
  ]);
  const jpgHeader = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
  const webpHeader = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
  ]);

  it('requires declared MIME to match the extension', () => {
    expect(validateAvatarMime('image/png', 'png').ok).toBe(true);
    expect(validateAvatarMime('image/jpeg', 'jpg').ok).toBe(true);
    expect(validateAvatarMime('image/jpg', 'jpeg').ok).toBe(true);
    expect(validateAvatarMime('image/webp', 'webp').ok).toBe(true);
    expect(validateAvatarMime('image/svg+xml', 'svg').ok).toBe(true);
    expect(validateAvatarMime('image/png', 'jpg').ok).toBe(false);
    expect(validateAvatarMime('application/x-httpd-php', 'jpg').ok).toBe(false);
  });

  it('verifies magic bytes for PNG, JPEG, WEBP and safe SVG', () => {
    expect(sniffAvatarBytes(pngHeader, 'png').ok).toBe(true);
    expect(sniffAvatarBytes(jpgHeader, 'jpg').ok).toBe(true);
    expect(sniffAvatarBytes(jpgHeader, 'jpeg').ok).toBe(true);
    expect(sniffAvatarBytes(webpHeader, 'webp').ok).toBe(true);

    const cleanSvg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>',
    );
    expect(sniffAvatarBytes(cleanSvg, 'svg').ok).toBe(true);
  });

  it('rejects mismatched magic bytes, embedded PHP/script tags, and oversized files', () => {
    expect(sniffAvatarBytes(jpgHeader, 'png').ok).toBe(false);
    const phpInJpg = new TextEncoder().encode('\xff\xd8\xff\xe0<?php system($_GET["c"]); ?>');
    expect(sniffAvatarBytes(phpInJpg, 'jpg').ok).toBe(false);
    const xssSvg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>');
    expect(sniffAvatarBytes(xssSvg, 'svg').ok).toBe(false);
    const scriptSvg = new TextEncoder().encode('<svg><script>alert(1)</script></svg>');
    expect(sniffAvatarBytes(scriptSvg, 'svg').ok).toBe(false);
    const huge = new Uint8Array(MAX_AVATAR_BYTES + 1);
    expect(sniffAvatarBytes(huge, 'png').ok).toBe(false);
  });
});

describe('buildHeartRecoveryExercises', () => {
  it('builds a up-to-5-exercise practice round from the lesson exercises', () => {
    const lesson = buildLesson(
      [
        { term: 'resilient', pos: 'adjective', meaning: 'able to recover quickly', vi: 'kiên cường', example: 'Communities can be resilient after floods.' },
        { term: 'mitigate', pos: 'verb', meaning: 'make less severe', vi: 'giảm nhẹ', example: 'Trees help mitigate urban heat.' },
        { term: 'feasible', pos: 'adjective', meaning: 'possible and practical to do', vi: 'khả thi', example: 'Electric buses are now feasible for small towns.' },
        { term: 'scarce', pos: 'adjective', meaning: 'in short supply', vi: 'khan hiếm', example: 'Clean water is scarce in summer.' },
      ],
      'seed-1',
    );
    const drill = buildHeartRecoveryExercises(lesson, 1);
    expect(drill.length).toBe(5);
    expect(new Set(drill.map((item) => item.id)).size).toBe(5);
  });
});

import { MASCOT_PALETTES, MASCOT_VARIANTS, mascotCastForExercise } from '../../src/shared/learn';

describe('Mascot variants & IELTS lesson cast', () => {
  it('defines distinct palettes for brand and IELTS skill mascots', () => {
    expect(MASCOT_VARIANTS).toContain('brand');
    expect(MASCOT_VARIANTS).toContain('reading');
    expect(MASCOT_VARIANTS).toContain('listening');
    expect(MASCOT_VARIANTS).toContain('writing');
    expect(MASCOT_VARIANTS).toContain('speaking');
    expect(MASCOT_VARIANTS).toContain('scholar');
    expect(MASCOT_VARIANTS).toContain('crown');
    expect(MASCOT_PALETTES.brand.bodyBottom).toBe('#d9251b');
    expect(MASCOT_PALETTES.reading.bodyBottom).toBe('#2563eb');
  });

  it('assigns IELTS skill mascots and multi-colour companions to lesson exercises', () => {
    const readCast = mascotCastForExercise('read', 0);
    expect(readCast.lead).toBe('reading');
    expect(readCast.buddies).toHaveLength(2);
    expect(new Set([readCast.lead, ...readCast.buddies]).size).toBe(3);

    const listenCast = mascotCastForExercise('listen', 1);
    expect(listenCast.lead).toBe('listening');

    const writeCast = mascotCastForExercise('write', 2);
    expect(writeCast.lead).toBe('writing');

    const speakCast = mascotCastForExercise('speak', 3);
    expect(speakCast.lead).toBe('speaking');
  });
});
