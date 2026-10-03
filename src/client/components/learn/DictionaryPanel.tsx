import { useCallback, useEffect, useRef, useState } from 'react';
import type { DictionaryEntry } from '@shared/learn';
import { api, describeError } from '../../lib/api';
import { learnApi } from '../../lib/learn-api';
import { canSpeak, speak } from '../../lib/speech';
import { Badge, Button } from '../ui';
import { Icon } from '../Icon';

/**
 * The dictionary: one search box and an entry card. It is used as a page and
 * as a popover inside a practice exam, so it keeps no layout opinions of its
 * own beyond a `compact` flag.
 */
export function DictionaryPanel({
  compact = false,
  initialTerm = '',
  autoFocus = false,
  onSaved,
}: {
  compact?: boolean;
  initialTerm?: string;
  autoFocus?: boolean;
  onSaved?: (term: string) => void;
}) {
  const [term, setTerm] = useState(initialTerm);
  const [entry, setEntry] = useState<DictionaryEntry | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [recent, setRecent] = useState<string[]>(() => readRecent());
  const inputRef = useRef<HTMLInputElement | null>(null);

  const search = useCallback(async (value: string) => {
    const query = value.trim();
    if (!query) return;
    setLoading(true);
    setMessage(null);
    try {
      const result = await learnApi.lookup(query);
      setEntry(result.entry);
      setTerm(result.entry.term);
      setRecent((previous) => {
        const next = [result.entry.term, ...previous.filter((item) => item.toLowerCase() !== result.entry.term.toLowerCase())].slice(0, 8);
        writeRecent(next);
        return next;
      });
    } catch (error) {
      setEntry(null);
      setMessage(describeError(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialTerm) void search(initialTerm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const save = async () => {
    if (!entry) return;
    const first = entry.meanings[0];
    const definition = first?.definitions[0];
    setSaving(true);
    try {
      await api.post('/api/student/vocabulary', {
        term: entry.term,
        meaning: definition?.en || definition?.vi || '',
        meaningVi: definition?.vi ?? '',
        pos: first?.pos ?? '',
        phonetic: entry.phonetic,
        example: definition?.example ?? '',
        source: 'Dictionary',
      });
      setEntry({ ...entry, saved: true });
      onSaved?.(entry.term);
    } catch (error) {
      setMessage(describeError(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`dict${compact ? ' dict--compact' : ''}`}>
      <form
        className="dict__search"
        onSubmit={(event) => {
          event.preventDefault();
          void search(term);
        }}
        role="search"
      >
        <Icon name="search" size={16} />
        <input
          ref={inputRef}
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Type an English word or phrase"
          aria-label="Word to look up"
          maxLength={60}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
        />
        <Button type="submit" variant="primary" size="sm" loading={loading} disabled={!term.trim()}>
          Look up
        </Button>
      </form>

      {message ? (
        <p className="dict__message" role="alert">
          {message}
        </p>
      ) : null}

      {entry ? (
        <article className="dict__entry">
          <header className="dict__head">
            <div>
              <h2 className="dict__term">{entry.term}</h2>
              <div className="dict__sub">
                {entry.phonetic ? <span className="dict__phonetic">{entry.phonetic}</span> : null}
                {canSpeak() ? (
                  <button type="button" className="dict__speak" onClick={() => speak(entry.term)} aria-label={`Hear “${entry.term}”`}>
                    <Icon name="play" size={12} />
                    Listen
                  </button>
                ) : null}
                {entry.level ? <Badge tone="neutral">{entry.level}</Badge> : null}
              </div>
            </div>
            <Button
              variant={entry.saved ? 'ghost' : 'secondary'}
              size="sm"
              onClick={() => void save()}
              loading={saving}
              disabled={entry.saved}
            >
              <Icon name={entry.saved ? 'check' : 'plus'} size={14} />
              {entry.saved ? 'In notebook' : 'Save'}
            </Button>
          </header>

          {entry.meanings.map((meaning, index) => (
            <section key={`${meaning.pos}-${index}`} className="dict__meaning">
              {meaning.pos ? <p className="dict__pos">{meaning.pos}</p> : null}
              <ol className="dict__defs">
                {meaning.definitions.map((definition, defIndex) => (
                  <li key={defIndex}>
                    {definition.en ? <p className="dict__en">{definition.en}</p> : null}
                    {definition.vi ? <p className="dict__vi">{definition.vi}</p> : null}
                    {definition.example ? <p className="dict__example">“{definition.example}”</p> : null}
                  </li>
                ))}
              </ol>
              {meaning.synonyms.length > 0 ? (
                <p className="dict__syn">
                  <span>Similar</span>
                  {meaning.synonyms.map((synonym) => (
                    <button key={synonym} type="button" className="chip" onClick={() => void search(synonym)}>
                      {synonym}
                    </button>
                  ))}
                </p>
              ) : null}
            </section>
          ))}

          <footer className="dict__more" style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="tiny muted">View more</span>
            <a
              className="chip"
              href={`https://www.oxfordlearnersdictionaries.com/definition/english/${encodeURIComponent(entry.term.replace(/\s+/g, '_').toLowerCase())}`}
              target="_blank"
              rel="noreferrer noopener"
            >
              <Icon name="external" size={12} /> Oxford
            </a>
            <a
              className="chip"
              href={`https://dictionary.cambridge.org/dictionary/english/${encodeURIComponent(entry.term.replace(/\s+/g, '-').toLowerCase())}`}
              target="_blank"
              rel="noreferrer noopener"
            >
              <Icon name="external" size={12} /> Cambridge
            </a>
          </footer>
        </article>
      ) : !loading && !message ? (
        compact ? (
          <div className="dict__empty dict__empty--compact">
            <p>Look up any word. Save it to your notebook and it will come back in your daily review.</p>
          </div>
        ) : (
          <div className="dict__empty">
            <span className="empty__icon" aria-hidden="true">
              <Icon name="book" size={22} />
            </span>
            <h2 className="empty__title">Look up any word</h2>
            <p>Definitions in English and Vietnamese, how it sounds and an example. Save it and it comes back in your daily review.</p>
            <p className="dict__syn">
              <span>{recent.length > 0 ? 'Recent' : 'Try'}</span>
              {(recent.length > 0 ? recent : SUGGESTIONS).map((item) => (
                <button key={item} type="button" className="chip" onClick={() => void search(item)}>
                  {item}
                </button>
              ))}
            </p>
          </div>
        )
      ) : null}
    </div>
  );
}

/** Words worth trying first, for someone who has not looked anything up yet. */
const SUGGESTIONS = ['sustainable', 'mitigate', 'scrutiny', 'inevitable', 'coherent', 'trend'];

const RECENT_KEY = 'aieo.dictionary.recent';
function readRecent(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string').slice(0, 8) : [];
  } catch {
    return [];
  }
}
function writeRecent(items: string[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(items));
  } catch {
    // Private mode: recent words are a convenience only.
  }
}
