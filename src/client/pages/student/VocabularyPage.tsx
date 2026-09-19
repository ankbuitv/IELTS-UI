import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, describeError } from '../../lib/api';
import { useAsync } from '../../hooks/useAsync';
import { Icon } from '../../components/Icon';
import { Badge, Button, Card, EmptyState, Field, Notice, TextArea, TextInput, useToast } from '../../components/ui';
import { formatDateTime } from '../../lib/format';
import type { VocabularyEntry, VocabularyList } from '@shared/vocabulary';

/**
 * Vocabulary notebook.
 *
 * Candidates collect words while reading a passage, following a transcript or
 * reading an explanation panel, then revise them here: the list supports
 * search, inline editing of the definition, a self-test flip card and delete.
 * The saving flow is optimistic-free on purpose — the API is the source of
 * truth, and a duplicate word updates the existing row instead of adding one.
 */
export function VocabularyPage() {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [meaning, setMeaning] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editMeaning, setEditMeaning] = useState('');

  const { data, loading, error, reload } = useAsync<VocabularyList>(
    () => api.get(`/api/student/vocabulary${search.trim() ? `?search=${encodeURIComponent(search.trim())}` : ''}`),
    [search],
  );

  const [practice, setPractice] = useState<VocabularyEntry | null>(null);
  const [flipped, setFlipped] = useState(false);

  const entries = useMemo(() => data?.entries ?? [], [data]);
  const due = useMemo(() => entries.filter((entry) => entry.reviewCount === 0).slice(0, 20), [entries]);

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

  const markReviewed = async (entry: VocabularyEntry) => {
    try {
      await api.patch(`/api/student/vocabulary/${entry.id}`, { reviewed: true });
      setPractice(null);
      setFlipped(false);
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

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <span className="public-eyebrow">Study tools</span>
          <h1>Vocabulary notebook</h1>
          <p className="page-head__meta">
            Every word you save while reading, listening or reviewing an explanation lands here. Definitions are yours to
            edit, and the self-test keeps the list alive.
          </p>
        </div>
        {data ? (
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <Badge tone="accent">{data.totals.entries} words</Badge>
            <Badge tone="success">{data.totals.reviewed} reviewed</Badge>
            <Badge>{data.totals.thisWeek} added this week</Badge>
          </div>
        ) : null}
      </div>

      <div className="vocab-grid">
        <Card title="Add a word">
          <div className="stack">
            <Field label="Word or phrase" required>
              {(id) => (
                <TextInput
                  id={id}
                  value={term}
                  onChange={(event) => setTerm(event.target.value)}
                  placeholder="e.g. sustainable"
                  maxLength={80}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void add();
                  }}
                />
              )}
            </Field>
            <Field label="Meaning" hint="Optional — you can edit it later.">
              {(id) => (
                <TextArea
                  id={id}
                  rows={3}
                  value={meaning}
                  onChange={(event) => setMeaning(event.target.value)}
                  placeholder="Able to continue over time without damaging the environment."
                  maxLength={600}
                />
              )}
            </Field>
            <Button variant="primary" loading={saving} onClick={() => void add()}>
              <Icon name="plus" size={15} />
              Save to notebook
            </Button>
            {due.length > 0 ? (
              <Notice tone="info" title={`${due.length} word${due.length === 1 ? '' : 's'} still to review`}>
                <span>Start a self-test: read the word, say the meaning, then reveal the answer.</span>
                <div style={{ marginTop: 8 }}>
                  <Button
                    size="sm"
                    onClick={() => {
                      setPractice(due[0]!);
                      setFlipped(false);
                    }}
                  >
                    Start self-test
                  </Button>
                </div>
              </Notice>
            ) : null}
          </div>
        </Card>

        <Card
          title="Your words"
          actions={
            <div className="row" style={{ gap: 8 }}>
              <TextInput
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search words or meanings"
                aria-label="Search vocabulary"
              />
            </div>
          }
        >
          {loading ? (
            <p className="muted">Loading your words…</p>
          ) : error ? (
            <Notice tone="danger" title="Could not load your notebook">
              {error}
            </Notice>
          ) : entries.length === 0 ? (
            <EmptyState title="No words yet">
              Save a word from a passage, a transcript or an explanation panel, or add one on the left. Words you save
              from an exam show where they came from.
            </EmptyState>
          ) : (
            <ul className="vocab-list">
              {entries.map((entry) => (
                <li key={entry.id} className="vocab-item">
                  <div className="vocab-item__head">
                    <span className="vocab-item__term">{entry.term}</span>
                    {entry.reviewCount > 0 ? <Badge tone="success">reviewed {entry.reviewCount}×</Badge> : <Badge>new</Badge>}
                  </div>
                  {editingId === entry.id ? (
                    <div className="stack" style={{ gap: 8, marginTop: 8 }}>
                      <TextArea rows={2} value={editMeaning} onChange={(event) => setEditMeaning(event.target.value)} />
                      <div className="row" style={{ gap: 8 }}>
                        <Button size="sm" variant="primary" onClick={() => void saveMeaning(entry)}>
                          Save meaning
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="vocab-item__meaning">{entry.meaning || 'No meaning saved yet.'}</p>
                  )}
                  <div className="vocab-item__foot">
                    <span className="tiny muted">
                      {entry.source ? `${entry.source} · ` : ''}
                      added {formatDateTime(entry.createdAt)}
                      {entry.lastReviewedAt ? ` · last reviewed ${formatDateTime(entry.lastReviewedAt)}` : ''}
                    </span>
                    <div className="row" style={{ gap: 4 }}>
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
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setPractice(entry);
                          setFlipped(false);
                        }}
                      >
                        Self-test
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
        </Card>
      </div>

      {practice ? (
        <div className="vocab-card" role="dialog" aria-label="Self-test">
          <span className="vocab-card__kicker">Self-test</span>
          <p className="vocab-card__term">{practice.term}</p>
          {flipped ? (
            <p className="vocab-card__meaning">{practice.meaning || 'No meaning saved for this word yet.'}</p>
          ) : (
            <p className="muted small">Say the meaning out loud, then reveal it.</p>
          )}
          <div className="row" style={{ gap: 8, justifyContent: 'center' }}>
            <Button size="sm" onClick={() => setFlipped((value) => !value)}>
              {flipped ? 'Hide meaning' : 'Reveal meaning'}
            </Button>
            <Button size="sm" variant="primary" onClick={() => void markReviewed(practice)}>
              <Icon name="check" size={14} />
              I knew it
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setPractice(null);
                setFlipped(false);
              }}
            >
              Close
            </Button>
          </div>
        </div>
      ) : null}

      <p className="tiny muted">
        Looking for something to read? <Link to="/practice">Browse the practice catalogue</Link> and the words you save
        from a test will be filed here automatically.
      </p>
    </div>
  );
}
