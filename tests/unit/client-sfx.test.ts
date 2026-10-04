/**
 * The sound library.
 *
 * The contract that makes "one effect per event" true is that the list of names
 * and the gallery the shop shows cannot drift apart: a sound with no entry is
 * invisible in the soundboard, and an entry with no sound is a dead button.
 *
 * Named `client-*` because it imports a browser module (WebAudio, localStorage)
 * and therefore runs under vitest only, outside the Worker types — the same
 * convention as the other client-side tests.
 *
 * There is nothing here to assert about how a sound *sounds* — that is what the
 * soundboard in the shop is for — but the wiring around it is testable, and the
 * public calls must survive an environment with no WebAudio at all (Node, an
 * old browser, a page that refused audio permission).
 */
import { describe, expect, it } from 'vitest';
import { SFX_LIBRARY, SFX_NAMES, sfx } from '../../src/client/lib/sfx';

describe('sound library', () => {
  it('has one gallery entry per effect, each name once', () => {
    expect(SFX_NAMES).toHaveLength(26);
    expect(SFX_LIBRARY).toHaveLength(SFX_NAMES.length);
    const catalogued = SFX_LIBRARY.map((entry) => entry.name);
    expect(new Set(catalogued).size).toBe(SFX_NAMES.length);
    for (const name of SFX_NAMES) expect(catalogued).toContain(name);
  });

  it('describes every effect with a distinct label and a moment to hear it', () => {
    const labels = SFX_LIBRARY.map((entry) => entry.label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const entry of SFX_LIBRARY) {
      expect(entry.label.trim().length).toBeGreaterThan(0);
      expect(entry.when.trim().length).toBeGreaterThan(0);
    }
  });

  it('never throws when there is no audio device', () => {
    expect(typeof sfx.isEnabled()).toBe('boolean');
    expect(() => sfx.play('tap')).not.toThrow();
    expect(() => sfx.play('combo', 4)).not.toThrow();
    expect(() => sfx.preview('perfect')).not.toThrow();
    expect(() => sfx.correct()).not.toThrow();
    expect(() => sfx.incorrect()).not.toThrow();
    expect(() => sfx.complete()).not.toThrow();
    expect(() => sfx.setEnabled(false)).not.toThrow();
    expect(() => sfx.setEnabled(true)).not.toThrow();
  });
});
