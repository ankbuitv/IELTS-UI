import { useState } from 'react';
import {
  LEARN_BANDS,
  LEARN_BAND_LABELS,
  LESSON_KINDS,
  LESSON_KIND_LABELS,
  type CatalogueLessonRef,
  type LearnBand,
  type LessonKind,
} from '@shared/learn';
import { api, describeError, queryString } from '../../lib/api';
import { useAsync } from '../../hooks/useAsync';
import { Badge, Button, Card, EmptyState, Field, Loading, Notice, Select, Stat, TextInput, useToast } from '../../components/ui';
import { formatDateTime } from '../../lib/format';

type AdminLesson = CatalogueLessonRef & { band: LearnBand; updatedAt: string };

type GenerationResult = { created: number; titles: string[]; rejected: string[] };

/**
 * The learning catalogue.
 *
 * An administrator picks a band and a lesson type, the configured provider
 * writes a batch, and the batch lands as a DRAFT. Publishing is a separate,
 * deliberate step, because a wrong answer key is worse than a missing lesson:
 * nothing generated reaches a learner until a person has read it.
 *
 * Built-in lessons are archived rather than deleted — they are the seed a fresh
 * database rebuilds itself from — and an archived lesson can be published again.
 */
export function AdminLearnPage() {
  const toast = useToast();
  const [band, setBand] = useState('');
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('');

  const [genBand, setGenBand] = useState<LearnBand>(6);
  const [genKind, setGenKind] = useState<LessonKind>('VOCAB');
  const [count, setCount] = useState(2);
  const [unitTitle, setUnitTitle] = useState('');
  const [unitBlurb, setUnitBlurb] = useState('');
  const [publish, setPublish] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GenerationResult | null>(null);

  const { data, loading, error, reload } = useAsync<{ lessons: AdminLesson[] }>(
    () =>
      api.get<{ lessons: AdminLesson[] }>(
        `/api/admin/learn/lessons${queryString({
          ...(band ? { band } : {}),
          ...(status ? { status } : {}),
          ...(kind ? { kind } : {}),
        })}`,
      ),
    [band, status, kind],
  );

  const lessons = data?.lessons ?? [];
  const drafts = lessons.filter((lesson) => lesson.status === 'DRAFT').length;
  const bandCount = (value: LearnBand) => lessons.filter((lesson) => lesson.band === value).length;

  const generate = async () => {
    if (!unitTitle.trim()) {
      toast.push('Give the unit a title first.', 'warning');
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const response = await api.post<GenerationResult>('/api/admin/learn/generate', {
        band: genBand,
        kind: genKind,
        count,
        unitTitle: unitTitle.trim(),
        unitBlurb: unitBlurb.trim() || undefined,
        publish,
      });
      setResult(response);
      toast.push(`${response.created} lesson${response.created === 1 ? '' : 's'} generated.`, 'success');
      await reload();
    } catch (cause) {
      toast.push(describeError(cause), 'error');
    } finally {
      setBusy(false);
    }
  };

  const setStatusFor = async (id: string, next: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED') => {
    try {
      await api.put(`/api/admin/learn/lessons/${id}/status`, { status: next });
      toast.push(
        next === 'PUBLISHED' ? 'Published.' : next === 'DRAFT' ? 'Moved back to drafts.' : 'Archived.',
        'success',
      );
      await reload();
    } catch (cause) {
      toast.push(describeError(cause), 'error');
    }
  };

  return (
    <div className="stack">
      <section className="grid grid--3">
        <Stat label="Lessons shown" value={String(lessons.length)} />
        <Stat label="Waiting to be published" value={String(drafts)} />
        <Stat label="Bands with content" value={String(LEARN_BANDS.filter((value) => bandCount(value) > 0).length)} />
      </section>

      <Card
        title="Generate lessons"
        hint="Uses the provider configured under Settings. Nothing reaches a learner until you publish it."
      >
        <div className="grid grid--3">
          <Field label="Band">
            {(id) => (
              <Select id={id} value={String(genBand)} onChange={(event) => setGenBand(Number(event.target.value) as LearnBand)}>
                {LEARN_BANDS.map((value) => (
                  <option key={value} value={value}>
                    {value.toFixed(1)} · {LEARN_BAND_LABELS[value]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Lesson type">
            {(id) => (
              <Select id={id} value={genKind} onChange={(event) => setGenKind(event.target.value as LessonKind)}>
                {LESSON_KINDS.map((value) => (
                  <option key={value} value={value}>
                    {LESSON_KIND_LABELS[value]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="How many" hint="At most four in one call.">
            {(id) => (
              <Select id={id} value={String(count)} onChange={(event) => setCount(Number(event.target.value))}>
                {[1, 2, 3, 4].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Unit title">
            {(id) => (
              <TextInput id={id} value={unitTitle} onChange={(event) => setUnitTitle(event.target.value)} placeholder="Describing charts" />
            )}
          </Field>
          <Field label="Unit blurb" hint="Optional.">
            {(id) => (
              <TextInput id={id} value={unitBlurb} onChange={(event) => setUnitBlurb(event.target.value)} placeholder="What the unit covers" />
            )}
          </Field>
          <Field label="Publish immediately" hint="Not recommended: read a draft first.">
            {(id) => (
              <label className="check">
                <input id={id} type="checkbox" checked={publish} onChange={(event) => setPublish(event.target.checked)} />
                <span>Skip the draft step</span>
              </label>
            )}
          </Field>
        </div>
        <div className="row">
          <Button variant="primary" loading={busy} onClick={() => void generate()}>
            Generate
          </Button>
        </div>
        {result ? (
          <Notice tone={result.rejected.length > 0 ? 'warning' : 'success'} title={`${result.created} written`}>
            <p className="small">{result.titles.join(' · ')}</p>
            {result.rejected.length > 0 ? <p className="small">Could not be used: {result.rejected.join(' ')}</p> : null}
          </Notice>
        ) : null}
      </Card>

      <Card title="Catalogue">
        <div className="filter-bar">
          <Field label="Band">
            {(id) => (
              <Select id={id} value={band} onChange={(event) => setBand(event.target.value)}>
                <option value="">All</option>
                {LEARN_BANDS.map((value) => (
                  <option key={value} value={value}>
                    {value.toFixed(1)} ({bandCount(value)})
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Status">
            {(id) => (
              <Select id={id} value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="">All</option>
                <option value="DRAFT">Draft</option>
                <option value="PUBLISHED">Published</option>
                <option value="ARCHIVED">Archived</option>
              </Select>
            )}
          </Field>
          <Field label="Type">
            {(id) => (
              <Select id={id} value={kind} onChange={(event) => setKind(event.target.value)}>
                <option value="">All</option>
                {LESSON_KINDS.map((value) => (
                  <option key={value} value={value}>
                    {LESSON_KIND_LABELS[value]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        {loading && !data ? <Loading label="Loading the catalogue…" /> : null}
        {error && !data ? (
          <Notice tone="danger" title="The catalogue could not be loaded">
            {error}
          </Notice>
        ) : null}

        {data && lessons.length === 0 ? (
          <EmptyState title="Nothing here yet">Generate a batch above, or clear the filters.</EmptyState>
        ) : null}

        {lessons.length > 0 ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Lesson</th>
                  <th>Band</th>
                  <th>Type</th>
                  <th>Items</th>
                  <th>Origin</th>
                  <th>Status</th>
                  <th>Updated</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {lessons.map((lesson) => (
                  <tr key={lesson.id}>
                    <td>
                      <b>{lesson.title}</b>
                      <span className="muted tiny">
                        {lesson.unitTitle} · {lesson.preview}
                      </span>
                    </td>
                    <td>{lesson.band.toFixed(1)}</td>
                    <td>{LESSON_KIND_LABELS[lesson.kind]}</td>
                    <td>{lesson.itemCount}</td>
                    <td>
                      <Badge tone={lesson.origin === 'BUILT_IN' ? 'neutral' : 'info'}>
                        {lesson.origin === 'BUILT_IN' ? 'Built in' : lesson.origin === 'ADMIN_AI' ? 'Generated' : 'Personal'}
                      </Badge>
                    </td>
                    <td>
                      <Badge tone={lesson.status === 'PUBLISHED' ? 'success' : lesson.status === 'DRAFT' ? 'warning' : 'neutral'}>
                        {lesson.status.toLowerCase()}
                      </Badge>
                    </td>
                    <td className="muted tiny">{formatDateTime(lesson.updatedAt)}</td>
                    <td>
                      <div className="row">
                        {lesson.status !== 'PUBLISHED' ? (
                          <Button size="sm" variant="primary" onClick={() => void setStatusFor(lesson.id, 'PUBLISHED')}>
                            Publish
                          </Button>
                        ) : (
                          <Button size="sm" onClick={() => void setStatusFor(lesson.id, 'DRAFT')}>
                            Unpublish
                          </Button>
                        )}
                        {lesson.status !== 'ARCHIVED' ? (
                          <Button size="sm" variant="ghost" onClick={() => void setStatusFor(lesson.id, 'ARCHIVED')}>
                            Archive
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
