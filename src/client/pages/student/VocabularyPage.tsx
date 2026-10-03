import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, describeError } from '../../lib/api';
import { useAsync } from '../../hooks/useAsync';
import { Icon } from '../../components/Icon';
import { Badge, Button, Chips, EmptyState, Field, Notice, TextArea, TextInput, useToast } from '../../components/ui';
import { learnApi } from '../../lib/learn-api';
import { canSpeak, speak } from '../../lib/speech';
import { MAX_LEITNER_BOX, type VocabularyEntry, type VocabularyList } from '@shared/vocabulary';

/**
 * Vocabulary notebook.
 *
 * Words arrive from four places: the learner (passages, transcripts, the
 * dictionary), the daily AI words, words missed in a lesson, and the judges'
 * feedback on Writing and Speaking. Each word sits in a Leitner box and comes
 * back for review when it is due; reviewing is a lesson on the Learn path.
 */
type Filter = 'ALL' | 'DUE' | 'AI' | 'MINE' | 'LESSON';

function isDue(entry: VocabularyEntry): boolean {
  return entry.dueAt === null || entry.dueAt <= new Date().toISOString();
}

function dueLabel(entry: VocabularyEntry): string {
  if (isDue(entry)) return 'Due now';
  const days = Math.max(1, Math.ceil((Date.parse(entry.dueAt!) - Date.now()) / 86_400_000));
  return `Back in ${days}d`;
}

export function VocabularyPage() {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('ALL');
  const [adding, setAdding] = useState(false);
  const [term, setTerm] = useState('');
  const [meaning, setMeaning] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editMeaning, setEditMeaning] = useState('');
  const [fetching, setFetching] = useState(false);
  const askedForWords = useRef(false);

  const { data, loading, error, reload } = useAsync<VocabularyList>(
    () => api.get(`/api/student/vocabulary${search.trim() ? `?search=${encodeURIComponent(search.trim())}` : ''}`),
    [search],
  );
  const entries = useMemo(() => data?.entries ?? [], [data]);

  const counts = useMemo(
    () => ({
      ALL: entries.length,
      DUE: entries.filter(isDue).length,
      AI: entries.filter((entry) => entry.origin === 'AI').length,
      MINE: entries.filter((entry) => entry.origin === 'USER').length,
      LESSON: entries.filter((entry) => entry.origin === 'WORDBANK').length,
    }),
    [entries],
  );
  const visible = useMemo(
    () =>
      entries.filter((entry) => {
        if (filter === 'DUE') return isDue(entry);
        if (filter === 'AI') return entry.origin === 'AI';
        if (filter === 'MINE') return entry.origin === 'USER';
        if (filter === 'LESSON') return entry.origin === 'WORDBANK';
        return true;
      }),
    [entries, filter],
  );

  const fetchWords = async (extra: boolean) => {
    setFetching(true);
    try {
      const result = await learnApi.dailyWords(extra);
      if (result.added > 0) toast.push(`${result.added} new word${result.added === 1 ? '' : 's'} added for your level.`, 'success');
      else if (result.alreadyDone) toast.push('You already have today’s words. Ask for 5 more if you want extra.', 'info');
      else toast.push('No new words could be added right now.', 'warning');
      await reload();
    } catch (cause) {
      toast.push(describeError(cause), 'error');
    } finally {
      setFetching(false);
    }
  };

  // The first visit of the day adds the day's words by itself; nobody has to ask.
  useEffect(() => {
    if (askedForWords.current) return;
    askedForWords.current = true;
    void learnApi
      .dailyWords()
      .then((result) => (result.added > 0 ? reload() : undefined))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const add = async () => {
    if (!term.trim()) {
      toast.push('Type the word or phrase you want to save.', 'warning');
      return;
    }
    setSaving(true);
    try {
      await api.post('/api/student/vocabulary', { term: term.trim(), meaning: meaning.trim() });
      setTerm('');
      setMeaning('');
      setAdding(false);
      await reload();
      toast.push('Saved to your vocabulary notebook.', 'success');
    } catch (cause) {
      toast.push(describeError(cause), 'error');
    } finally {
      setSaving(false);
    }
  };

  const saveMeaning = async (entry: VocabularyEntry) => {
    try {
      await api.patch(`/api/student/vocabulary/${entry.id}`, { meaning: editMeaning });
      setEditingId(null);
      await reload();
    } catch (cause) {
      toast.push(describeError(cause), 'error');
    }
  };

  const remove = async (entry: VocabularyEntry) => {
    try {
      await api.delete(`/api/student/vocabulary/${entry.id}`);
      await reload();
    } catch (cause) {
      toast.push(describeError(cause), 'error');
    }
  };

  const dueCount = counts.DUE;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Vocabulary</h1>
          <p className="page-head__meta">
            Words you save, new words the AI picks for your level every day, and the words you missed in lessons. Review
            the ones that are due and they come back less and less often.
          </p>
        </div>
        <div className="row">
          <Link className={`btn btn--primary${dueCount === 0 ? ' is-disabled' : ''}`} to="/learn/review" aria-disabled={dueCount === 0}>
            <Icon name="rotate" size={14} />
            Review {dueCount > 0 ? `${dueCount} due` : 'words'}
          </Link>
          <Button onClick={() => void fetchWords(true)} loading={fetching}>
            <Icon name="sparkle" size={14} />
            5 more words
          </Button>
          <Button onClick={() => setAdding((open) => !open)} aria-expanded={adding}>
            <Icon name="plus" size={14} />
            Add
          </Button>
        </div>
      </div>

      {data ? (
        <div className="kpi-row kpi-row--compact">
          <div className="kpi">
            <span className="kpi__label">Words</span>
            <span className="kpi__value">{data.totals.entries}</span>
          </div>
          <div className="kpi">
            <span className="kpi__label">Due now</span>
            <span className="kpi__value">{data.totals.due}</span>
          </div>
          <div className="kpi">
            <span className="kpi__label">Reviewed</span>
            <span className="kpi__value">{data.totals.reviewed}</span>
          </div>
          <div className="kpi">
            <span className="kpi__label">This week</span>
            <span className="kpi__value">{data.totals.thisWeek}</span>
          </div>
        </div>
      ) : null}

      {adding ? (
        <div className="card vocab-add">
          <div className="grid grid--2">
            <Field label="Word or phrase" required>
              {(id) => (
                <TextInput
                  id={id}
                  value={term}
                  onChange={(event) => setTerm(event.target.value)}
                  placeholder="e.g. sustainable"
                  maxLength={80}
                  autoFocus
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void add();
                  }}
                />
              )}
            </Field>
            <Field label="Meaning" hint="Optional. Use the dictionary to fill it in.">
              {(id) => (
                <TextArea
                  id={id}
                  rows={2}
                  value={meaning}
                  onChange={(event) => setMeaning(event.target.value)}
                  placeholder="Able to continue over time without harming the environment."
                  maxLength={600}
                />
              )}
            </Field>
          </div>
          <div className="row">
            <Button variant="primary" loading={saving} onClick={() => void add()}>
              Save to notebook
            </Button>
            <Link className="btn btn--ghost" to="/dictionary">
              Look it up in the dictionary
            </Link>
          </div>
        </div>
      ) : null}

      <div className="toolbar">
        <Chips
          value={filter}
          onChange={setFilter}
          options={[
            { id: 'ALL', label: 'All', count: counts.ALL },
            { id: 'DUE', label: 'Due', count: counts.DUE },
            { id: 'AI', label: 'AI picks', count: counts.AI },
            { id: 'MINE', label: 'Mine', count: counts.MINE },
            { id: 'LESSON', label: 'From lessons', count: counts.LESSON },
          ]}
        />
        <label className="search">
          <Icon name="search" size={15} />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search words or meanings"
            aria-label="Search vocabulary"
          />
        </label>
      </div>

      {loading && !data ? (
        <p className="muted">Loading your words…</p>
      ) : error ? (
        <Notice tone="danger" title="Could not load your notebook">
          {error}
        </Notice>
      ) : visible.length === 0 ? (
        <EmptyState title={entries.length === 0 ? 'No words yet' : 'No words in this view'} icon="layers">
          {entries.length === 0
            ? 'Words appear here as you study: from lessons, from the dictionary, from your marked Writing and Speaking, and a few new ones every day.'
            : 'Try another filter.'}
        </EmptyState>
      ) : (
        <ul className="vocab-list">
          {visible.map((entry) => (
            <li key={entry.id} className="vocab-item">
              <div className="vocab-item__head">
                <span className="vocab-item__term">{entry.term}</span>
                {entry.pos ? <span className="vocab-item__pos">{entry.pos}</span> : null}
                {entry.phonetic ? <span className="vocab-item__phonetic">{entry.phonetic}</span> : null}
                {canSpeak() ? (
                  <button type="button" className="vocab-item__speak" onClick={() => speak(entry.term)} aria-label={`Hear “${entry.term}”`}>
                    <Icon name="play" size={11} />
                  </button>
                ) : null}
                <span className="vocab-item__tags">
                  {entry.origin === 'AI' ? <Badge tone="accent">AI pick</Badge> : null}
                  {entry.origin === 'WORDBANK' ? <Badge tone="info">Lesson</Badge> : null}
                  {entry.level ? <Badge tone="neutral">Band {entry.level}</Badge> : null}
                </span>
              </div>
              {editingId === entry.id ? (
                <div className="stack" style={{ gap: 8, marginTop: 8 }}>
                  <TextArea rows={2} value={editMeaning} onChange={(event) => setEditMeaning(event.target.value)} />
                  <div className="row">
                    <Button size="sm" variant="primary" onClick={() => void saveMeaning(entry)}>
                      Save meaning
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="vocab-item__meaning">{entry.meaning || 'No meaning saved yet.'}</p>
                  {entry.meaningVi ? <p className="vocab-item__vi">{entry.meaningVi}</p> : null}
                  {entry.example ? <p className="vocab-item__example">“{entry.example}”</p> : null}
                </>
              )}
              <div className="vocab-item__foot">
                <span className="vocab-item__box" title={`Review box ${entry.box} of ${MAX_LEITNER_BOX}`}>
                  <span className="leitner" aria-hidden="true">
                    {Array.from({ length: MAX_LEITNER_BOX }, (_, index) => (
                      <i key={index} className={index < entry.box ? 'on' : ''} />
                    ))}
                  </span>
                  <span className={isDue(entry) ? 'vocab-item__due' : ''}>{dueLabel(entry)}</span>
                  {entry.source ? <span className="muted"> · {entry.source}</span> : null}
                </span>
                <div className="row" style={{ gap: 2 }}>
                  <Link className="btn btn--ghost btn--sm" to={`/dictionary?term=${encodeURIComponent(entry.term)}`}>
                    Look up
                  </Link>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEditingId(entry.id);
                      setEditMeaning(entry.meaning);
                    }}
                  >
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void remove(entry)}>
                    Delete
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
