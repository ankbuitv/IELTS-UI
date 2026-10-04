/**
 * Tap a word, get the dictionary.
 *
 * Every English word in a lesson — the prompt, the sentence, the passage, the
 * line of evidence, the model answer — is a button. Pressing one opens the
 * dictionary for that exact word without leaving the lesson, which is the
 * difference between meeting an unknown word and looking it up: the learner
 * never has to decide whether a detour to /dictionary is worth it.
 *
 * Two details make that work rather than get in the way:
 *
 *   * the words are `tabIndex={-1}`. Making every word focusable would put two
 *     hundred stops in the tab order of a single question, which is hostile to
 *     keyboard users; the lesson keeps its own dictionary button in the header
 *     for anyone who navigates by keyboard, and these are a pointer shortcut;
 *   * punctuation stays with the sentence and is stripped from the term, so
 *     “Friday.” looks up `Friday` and the sentence still reads normally.
 *
 * The panel itself is the same component the exam uses (`DictionaryPanel`), so
 * a word saved from inside a lesson lands in the notebook with everything else.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { Icon } from '../Icon';
import { DictionaryPanel } from './DictionaryPanel';

interface LookupContextValue {
  open: (term: string) => void;
  enabled: boolean;
}

const LookupContext = createContext<LookupContextValue | null>(null);

export function useLookup(): LookupContextValue {
  return useContext(LookupContext) ?? { open: () => undefined, enabled: false };
}

export function LookupProvider({ children, enabled = true }: { children: ReactNode; enabled?: boolean }) {
  const [term, setTerm] = useState<string | null>(null);

  const open = useCallback(
    (next: string) => {
      if (enabled) setTerm(next);
    },
    [enabled],
  );

  const value = useMemo<LookupContextValue>(() => ({ open, enabled }), [open, enabled]);

  return (
    <LookupContext.Provider value={value}>
      {children}
      {term ? (
        <div className="lookup">
          <button type="button" className="lookup__backdrop" aria-label="Close the dictionary" onClick={() => setTerm(null)} />
          <div className="lookup__sheet" role="dialog" aria-label={`Dictionary: ${term}`}>
            <header className="lookup__head">
              <span className="lookup__kicker">
                <Icon name="book" size={14} /> Look up a word
              </span>
              <button type="button" className="lookup__close" onClick={() => setTerm(null)} aria-label="Close the dictionary">
                <Icon name="close" size={16} />
              </button>
            </header>
            <DictionaryPanel key={term} compact initialTerm={term} autoFocus />
          </div>
        </div>
      ) : null}
    </LookupContext.Provider>
  );
}

/** Strips the punctuation a sentence glues to a word, keeping anything letter-like. */
export function lookupTermOf(piece: string): string {
  return piece.replace(/^[^\p{L}\p{N}']+/u, '').replace(/[^\p{L}\p{N}']+$/u, '');
}

/**
 * Renders a passage of text with every word tappable.
 *
 * `highlight` underlines one term inside the sentence — the word the exercise
 * is about — so the answer panel shows where the answer lives.
 */
export function LookupText({
  text,
  highlight,
  className,
  as: Tag = 'span',
}: {
  text: string;
  /** A term to emphasise when it appears (case-insensitive, whole word). */
  highlight?: string;
  className?: string;
  as?: 'span' | 'p' | 'div' | 'h1';
}) {
  const { open, enabled } = useLookup();
  const parts = useMemo(() => text.split(/(\s+)/), [text]);
  const target = highlight?.trim().toLowerCase() ?? '';

  if (!enabled) {
    return <Tag className={className}>{text}</Tag>;
  }

  return (
    <Tag className={`lookup-text${className ? ` ${className}` : ''}`}>
      {parts.map((piece, index) => {
        if (!piece) return null;
        if (/^\s+$/.test(piece)) return piece;
        const term = lookupTermOf(piece);
        if (term.length < 2) return piece;
        const isTarget = target.length > 0 && term.toLowerCase() === target;
        return (
          <button
            key={`${index}-${term}`}
            type="button"
            className={`lookup-word${isTarget ? ' is-target' : ''}`}
            tabIndex={-1}
            aria-label={`Look up “${term}”`}
            title={`Look up “${term}”`}
            onClick={(event) => {
              event.stopPropagation();
              open(term);
            }}
          >
            {piece}
          </button>
        );
      })}
    </Tag>
  );
}

/** A one-line hint that the words in a lesson can be pressed. */
export function LookupHint({ compact = false }: { compact?: boolean }) {
  const { enabled } = useLookup();
  if (!enabled) return null;
  return (
    <p className={`lookup-hint${compact ? ' lookup-hint--compact' : ''}`}>
      <Icon name="search" size={12} />
      Press any word to look it up — your notebook keeps it.
    </p>
  );
}
