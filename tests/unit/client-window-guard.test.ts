import { describe, expect, it } from 'vitest';
import { describeOverlayNode, isForeignBodyNode, isPopupGesture } from '../../src/client/components/exam/window-guard';

/**
 * The window guard's decisions are pure, so they are tested as data — no DOM,
 * no browser, and no dependence on jsdom emulating fullscreen or an extension.
 */
const node = (init: {
  tagName: string;
  id?: string;
  className?: string;
  exempt?: boolean;
  attributes?: Record<string, string>;
}) => ({
  tagName: init.tagName,
  id: init.id ?? '',
  className: init.className ?? '',
  getAttribute: (name: string) => (init.exempt && name === 'data-exam-layer' ? '' : (init.attributes?.[name] ?? null)),
  matches: (selector: string) => (init.exempt && selector.includes('data-exam-layer')) || (init.id === 'root' && selector.includes('#root')),
});

describe('isPopupGesture', () => {
  const plain = { ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, button: 0 };

  it('leaves a plain left click alone', () => {
    expect(isPopupGesture(plain)).toBe(false);
  });

  it('flags every click a browser turns into a new tab or window', () => {
    expect(isPopupGesture({ ...plain, ctrlKey: true })).toBe(true);
    expect(isPopupGesture({ ...plain, metaKey: true })).toBe(true);
    expect(isPopupGesture({ ...plain, shiftKey: true })).toBe(true);
    expect(isPopupGesture({ ...plain, button: 1 })).toBe(true);
  });

  it('ignores right clicks, which are the context menu and already recorded elsewhere', () => {
    expect(isPopupGesture({ ...plain, button: 2 })).toBe(false);
  });
});

describe('isForeignBodyNode', () => {
  it('does not treat the app root or the page plumbing as an intrusion', () => {
    expect(isForeignBodyNode(node({ tagName: 'DIV', id: 'root' }))).toBe(false);
    expect(isForeignBodyNode(node({ tagName: 'SCRIPT' }))).toBe(false);
    expect(isForeignBodyNode(node({ tagName: 'STYLE' }))).toBe(false);
    expect(isForeignBodyNode(node({ tagName: 'LINK' }))).toBe(false);
    expect(isForeignBodyNode(null)).toBe(false);
  });

  it('does not hide a layer the exam itself portals into the body', () => {
    expect(isForeignBodyNode(node({ tagName: 'DIV', className: 'exam-lightbox', exempt: true }))).toBe(false);
  });

  it('flags a body-level element it did not create', () => {
    expect(isForeignBodyNode(node({ tagName: 'DIV', className: 'translater-popup' }))).toBe(true);
    expect(isForeignBodyNode(node({ tagName: 'IFRAME', id: 'dict-frame' }))).toBe(true);
    expect(isForeignBodyNode(node({ tagName: 'DIV', attributes: { translate: 'yes' } }))).toBe(true);
  });

  it('honours a different root id', () => {
    expect(isForeignBodyNode(node({ tagName: 'DIV', id: 'app' }), 'app')).toBe(false);
    expect(isForeignBodyNode(node({ tagName: 'DIV', id: 'app' }), 'root')).toBe(true);
  });
});

describe('describeOverlayNode', () => {
  it('names a node by tag, id, classes and role, and stays short', () => {
    expect(describeOverlayNode(node({ tagName: 'DIV', id: 'gl-trans', className: 'a b c' }))).toBe('div#gl-trans.a.b');
    expect(describeOverlayNode(node({ tagName: 'SECTION', attributes: { role: 'dialog' } }))).toBe('section[role=dialog]');
    expect(describeOverlayNode(node({ tagName: 'DIV', className: ''.padEnd(400, 'x') })).length).toBeLessThanOrEqual(120);
  });
});
