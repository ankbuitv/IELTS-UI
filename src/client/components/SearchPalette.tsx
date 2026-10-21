import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { learnApi } from '../lib/learn-api';
import { Icon } from './Icon';
import { Loading, Modal } from './ui';

/**
 * The top-bar search: one palette across tests, Learn lessons, mentors and the
 * dictionary. Lists are fetched once per open and filtered locally so typing
 * feels instant; the dictionary does a real lookup for the typed term.
 */
interface Searchable {
  key: string;
  title: string;
  detail: string;
  to: string;
  icon: 'book' | 'target' | 'graduation' | 'search';
}

export function SearchPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<Searchable[] | null>(null);
  const [word, setWord] = useState<{ term: string; meaning: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setWord(null);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 60);
    void (async () => {
      try {
        const [tests, mentors, catalogue] = await Promise.all([
          api.get<{ tests: Array<{ id: string; title: string; summary: string | null; type: string }> }>('/api/tests').catch(() => ({ tests: [] })),
          api.get<{ mentors: Array<{ userId: string; displayName: string; headline: string | null }> }>('/api/mentors').catch(() => ({ mentors: [] })),
          learnApi.catalogue().catch(() => null),
        ]);
        const lessons: Array<{ id: string; title: string; skill: string; band: string }> = [];
        const catalogueData = catalogue as { bands?: Array<{ band: string; lessons?: Array<{ id: string; title: string; skill: string }> }> } | null;
        for (const bandBlock of catalogueData?.bands ?? []) {
          for (const lesson of bandBlock.lessons ?? []) {
            lessons.push({ id: lesson.id, title: lesson.title, skill: lesson.skill, band: bandBlock.band });
          }
        }
        const collected: Searchable[] = [
          ...tests.tests.map((test) => ({
            key: `test-${test.id}`,
            title: test.title,
            detail: `${test.type.replace('_', ' ').toLowerCase()} · ${test.summary ?? 'practice test'}`,
            to: '/practice',
            icon: 'book' as const,
          })),
          ...lessons.map((lesson) => ({
            key: `lesson-${lesson.id}`,
            title: lesson.title,
            detail: `learn · ${lesson.skill.toLowerCase()} · band ${lesson.band}`,
            to: `/learn/lesson/${lesson.id}`,
            icon: 'target' as const,
          })),
          ...mentors.mentors.map((mentor) => ({
            key: `mentor-${mentor.userId}`,
            title: mentor.displayName,
            detail: `mentor · ${mentor.headline ?? 'coaching'}`,
            to: `/mentors/${mentor.userId}`,
            icon: 'graduation' as const,
          })),
        ];
        setItems(collected);
      } catch {
        setItems([]);
      }
    })();
    return () => window.clearTimeout(timer);
  }, [open]);

  // Dictionary lookup for the typed term (only when it looks like one word).
  useEffect(() => {
    const term = query.trim();
    if (!open || term.length < 2 || term.includes(' ')) {
      setWord(null);
      return;
    }
    const timer = window.setTimeout(() => {
      void api
        .get<{ entry?: { term: string; meaning?: string; definition?: string; vi?: string } | null }>(
          `/api/dictionary/lookup?term=${encodeURIComponent(term)}`,
        )
        .then((result) => {
          const entry = result.entry ?? (result as unknown as { term?: string; meaning?: string; definition?: string });
          const meaning = entry?.meaning ?? entry?.definition ?? '';
          setWord(entry?.term ? { term: entry.term, meaning } : null);
        })
        .catch(() => setWord(null));
    }, 320);
    return () => window.clearTimeout(timer);
  }, [query, open]);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!items) return null;
    if (!needle) return items.slice(0, 8);
    return items
      .filter((item) => item.title.toLowerCase().includes(needle) || item.detail.toLowerCase().includes(needle))
      .slice(0, 12);
  }, [items, query]);

  const go = (to: string) => {
    onClose();
    navigate(to);
  };

  return (
    <Modal open={open} onClose={onClose} title="Search">
      <div className="search-palette">
        <div className="search-palette__field">
          <Icon name="search" size={16} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search tests, lessons, mentors…"
            aria-label="Search"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && results && results.length > 0) go(results[0]!.to);
            }}
          />
        </div>
        {word ? (
          <button type="button" className="search-palette__word" onClick={() => go('/dictionary')}>
            <Icon name="search" size={15} />
            <span>
              <b>{word.term}</b> — {word.meaning.slice(0, 120) || 'open the dictionary'}
            </span>
          </button>
        ) : null}
        {results === null ? (
          <Loading label="Loading…" />
        ) : results.length === 0 ? (
          <p className="muted small" style={{ padding: '10px 4px' }}>
            Nothing matches “{query}”. Try a shorter word.
          </p>
        ) : (
          <div className="search-palette__list">
            {results.map((item) => (
              <button key={item.key} type="button" className="search-palette__item" onClick={() => go(item.to)}>
                <Icon name={item.icon} size={15} />
                <span>
                  <b>{item.title}</b>
                  <small>{item.detail}</small>
                </span>
                <Icon name="chevronRight" size={13} />
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
