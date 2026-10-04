/**
 * The input lockdown's key table.
 *
 * The hook itself needs a document and a real user gesture to mean anything, but
 * the part that decides *what* is refused is a pure function over a key event, and
 * that is the part with a security-ish job: F12 and every "open the inspector"
 * spelling of every mainstream browser has to be in the table, while ordinary
 * typing — the letter `i` on its own, Ctrl+C, a shortcut a surface may still want
 * — must survive it. A missing combination is a hole; an over-broad match breaks
 * the lesson.
 */
import { describe, expect, it } from 'vitest';
import { DEVTOOLS_SHORTCUTS, isBlockedShortcut, type KeyLike } from '../../src/client/hooks/useInputLockdown';

/** A key event with only the fields the matcher reads. */
function key(value: string, modifiers: Partial<Omit<KeyLike, 'key'>> = {}): KeyLike {
  return { key: value, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...modifiers };
}

describe('devtools shortcut table', () => {
  it('refuses the console / inspector shortcuts of every mainstream browser', () => {
    const blocked: KeyLike[] = [
      key('F12'), // Chrome, Edge, Firefox — Windows and Linux
      key('i', { ctrlKey: true, shiftKey: true }), // inspector
      key('j', { ctrlKey: true, shiftKey: true }), // console
      key('c', { ctrlKey: true, shiftKey: true }), // element picker
      key('k', { ctrlKey: true, shiftKey: true }), // Firefox web console
      key('e', { ctrlKey: true, shiftKey: true }), // Firefox network
      key('s', { ctrlKey: true, shiftKey: true }), // Firefox debugger
      key('I', { ctrlKey: true, shiftKey: true }), // shifted key value, same combo
      key('i', { metaKey: true, shiftKey: true }), // macOS ⌘⇧I
      key('i', { metaKey: true, altKey: true }), // Safari ⌘⌥I
      key('c', { metaKey: true, altKey: true }), // Safari ⌘⌥C
      key('u', { metaKey: true, altKey: true }), // Safari "Show Page Source"
      key('j', { metaKey: true, altKey: true }), // Safari ⌘⌥J
      key('e', { metaKey: true, altKey: true }), // Safari ⌘⌥E
    ];
    for (const event of blocked) expect(isBlockedShortcut(event), JSON.stringify(event)).toBe(true);
  });

  it('refuses the routes that copy the paper out: view source, save as, print', () => {
    for (const event of [
      key('u', { ctrlKey: true }),
      key('s', { ctrlKey: true }),
      key('p', { ctrlKey: true }),
      key('U', { metaKey: true }),
      key('s', { metaKey: true }),
      key('p', { metaKey: true }),
    ]) {
      expect(isBlockedShortcut(event), JSON.stringify(event)).toBe(true);
    }
  });

  it('leaves ordinary typing and unrelated shortcuts alone', () => {
    const allowed: KeyLike[] = [
      key('i'),
      key('U'),
      key('c', { ctrlKey: true }), // copy is the policy's business, not this table's
      key('v', { ctrlKey: true }),
      key('a', { ctrlKey: true }),
      key('Enter'),
      key('ArrowDown', { altKey: true }), // the exam's own question stepping
      key('f', { altKey: true }), // the exam's own "flag" shortcut
      key('F5'), // reload: logged as an integrity event, never swallowed
      key('r', { ctrlKey: true }),
      key('s', { ctrlKey: true, altKey: true }), // not a browser shortcut, and not ours
      key('j', { ctrlKey: true }), // downloads, not the console
      key('Escape'),
    ];
    for (const event of allowed) expect(isBlockedShortcut(event), JSON.stringify(event)).toBe(false);
  });

  it('matches every row of the exported table', () => {
    for (const combo of DEVTOOLS_SHORTCUTS) {
      expect(
        isBlockedShortcut({
          key: combo.key,
          ctrlKey: Boolean(combo.ctrl),
          metaKey: false,
          altKey: Boolean(combo.alt),
          shiftKey: Boolean(combo.shift),
        }),
        JSON.stringify(combo),
      ).toBe(true);
    }
  });

  it('is exact, not "contains": one modifier either way is a different shortcut', () => {
    const nearMisses: KeyLike[] = [
      key('i', { ctrlKey: true }), // ⌘I / Ctrl+I is italic, not the inspector
      key('j', { ctrlKey: true }), // downloads
      key('k', { ctrlKey: true }), // a search field's shortcut
      key('c', { ctrlKey: true, altKey: true, shiftKey: true }), // one modifier too many
      key('e', { ctrlKey: true }), // not the network panel
      key('u', { shiftKey: true }),
      key('s', { ctrlKey: true, altKey: true }),
      key('p', { ctrlKey: true, shiftKey: true }),
      key('F12', { ctrlKey: true }),
    ];
    for (const event of nearMisses) expect(isBlockedShortcut(event), JSON.stringify(event)).toBe(false);
  });

  it('has no duplicate rows', () => {
    const seen = new Set(DEVTOOLS_SHORTCUTS.map((combo) => `${combo.key}|${combo.ctrl ?? false}|${combo.shift ?? false}|${combo.alt ?? false}`));
    expect(seen.size).toBe(DEVTOOLS_SHORTCUTS.length);
  });
});
