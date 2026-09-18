import { useState } from 'react';
import { api, describeError } from '../../lib/api';
import { useAsync } from '../../hooks/useAsync';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Loading,
  Modal,
  Notice,
  Select,
  Stat,
  TextArea,
  TextInput,
  useToast,
} from '../../components/ui';
import { formatDateTime, SKILL_LABELS, TEST_TYPE_LABELS } from '../../lib/format';

interface ProfileRow {
  id: string;
  name: string;
  skill: string;
  test_type: string;
  version: number;
  status: string;
  min_questions: number;
  source_notes: string;
  created_at: string;
  updated_at: string;
  range_count: number;
  usage_count: number;
}

export function AdminScoringProfilesPage() {
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const { data, loading, error, reload } = useAsync<{ profiles: ProfileRow[] }>(
    () => api.get('/api/admin/scoring-profiles'),
    [],
  );

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Scoring profiles</h1>
          <p className="page-head__meta">
            Versioned raw-score → band conversion tables. Bands derived from them are practice estimates, labelled
            &ldquo;Estimated band&rdquo; everywhere in the product.
          </p>
        </div>
        <Button variant="primary" onClick={() => setCreating(true)}>
          New profile
        </Button>
      </div>

      <Notice tone="info" title="Only complete, sufficiently long tests receive an estimated band">
        Reading and Listening are the only skills converted automatically. Writing is always marked by a teacher or
        administrator, and the platform never invents a band score for it. Shorter practice sets report raw scores only.
      </Notice>

      {loading ? <Loading /> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}

      <Card flush>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Name</th>
                <th>Skill</th>
                <th>Applies to</th>
                <th className="num">Version</th>
                <th>Status</th>
                <th className="num">Ranges</th>
                <th className="num">Used by</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data?.profiles.map((profile) => (
                <tr key={profile.id}>
                  <td>
                    {profile.name}
                    <div className="tiny muted">
                      min {profile.min_questions} questions · updated {formatDateTime(profile.updated_at)}
                    </div>
                  </td>
                  <td>{SKILL_LABELS[profile.skill] ?? profile.skill}</td>
                  <td>{TEST_TYPE_LABELS[profile.test_type] ?? profile.test_type}</td>
                  <td className="num">v{profile.version}</td>
                  <td>
                    <Badge tone={profile.status === 'ACTIVE' ? 'success' : 'neutral'}>{profile.status.toLowerCase()}</Badge>
                  </td>
                  <td className="num">{profile.range_count}</td>
                  <td className="num">{profile.usage_count}</td>
                  <td className="right">
                    <div className="row" style={{ justifyContent: 'flex-end' }}>
                      <Button size="sm" onClick={() => setSelected(profile.id)}>
                        View
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          try {
                            await api.post(`/api/admin/scoring-profiles/${profile.id}/status`, {
                              status: profile.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
                            });
                            await reload();
                            toast.push(
                              profile.status === 'ACTIVE'
                                ? 'Profile deactivated. Tests using it report raw scores only.'
                                : 'Profile activated.',
                              'success',
                            );
                          } catch (statusError) {
                            toast.push(describeError(statusError), 'error');
                          }
                        }}
                      >
                        {profile.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data && data.profiles.length === 0 ? (
          <EmptyState title="No scoring profiles yet">
            Without an active profile, attempts still receive server-marked raw scores; only band estimation is
            unavailable.
          </EmptyState>
        ) : null}
      </Card>

      <Modal
        open={creating}
        title="New scoring profile"
        wide
        onClose={() => setCreating(false)}
        actions={<Button onClick={() => setCreating(false)}>Close</Button>}
      >
        <CreateProfileForm
          onCreated={async () => {
            await reload();
            setCreating(false);
            toast.push('Scoring profile created.', 'success');
          }}
          onError={(message) => toast.push(message, 'error')}
        />
      </Modal>

      <Modal
        open={Boolean(selected)}
        title="Conversion table"
        wide
        onClose={() => setSelected(null)}
        actions={<Button onClick={() => setSelected(null)}>Close</Button>}
      >
        {selected ? <ProfileDetail profileId={selected} /> : null}
      </Modal>
    </div>
  );
}

function ProfileDetail({ profileId }: { profileId: string }) {
  const { data, loading, error } = useAsync<{
    profile: ProfileRow;
    ranges: Array<{ raw_min: number; raw_max: number; band: number }>;
  }>(() => api.get(`/api/admin/scoring-profiles/${profileId}`), [profileId]);

  if (loading) return <Loading />;
  if (error) return <Notice tone="danger">{error}</Notice>;
  if (!data) return null;

  return (
    <div className="stack">
      <Stat label="Profile" value={`${data.profile.name} v${data.profile.version}`} hint={data.profile.source_notes || undefined} />
      <Card title="Raw score → band" flush>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th className="num">Raw from</th>
                <th className="num">Raw to</th>
                <th className="num">Band</th>
              </tr>
            </thead>
            <tbody>
              {data.ranges.map((range) => (
                <tr key={`${range.raw_min}-${range.raw_max}`}>
                  <td className="num">{range.raw_min}</td>
                  <td className="num">{range.raw_max}</td>
                  <td className="num">{range.band}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function parseRangeLines(text: string): Array<{ rawMin: number; rawMax: number; band: number }> {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const match = line.match(/^(\d+)\s*-\s*(\d+)\s*[=:,]?\s*(\d+(?:\.5)?)$/);
      if (!match) return [];
      return [{ rawMin: Number(match[1]), rawMax: Number(match[2]), band: Number(match[3]) }];
    });
}

function CreateProfileForm({
  onCreated,
  onError,
}: {
  onCreated: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [form, setForm] = useState({
    name: '',
    skill: 'READING',
    testType: 'READING',
    minQuestions: 40,
    sourceNotes: '',
    activate: true,
  });
  const [ranges, setRanges] = useState(
    ['39-40=9', '37-38=8.5', '35-36=8', '33-34=7.5', '30-32=7', '27-29=6.5', '23-26=6', '19-22=5.5', '15-18=5', '13-14=4.5', '10-12=4'].join('\n'),
  );

  const parsed = parseRangeLines(ranges);

  return (
    <div className="stack">
      <Notice tone="info">
        Enter your own conversion table. Raw scores outside the listed ranges are not converted, and the profile is
        refused by the server if the ranges overlap or leave gaps inside the covered span.
      </Notice>

      <div className="grid grid--2">
        <Field label="Profile name" required hint="Reusing a name creates the next version of that profile.">
          {(id) => <TextInput id={id} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />}
        </Field>
        <Field label="Skill" required>
          {(id) => (
            <Select
              id={id}
              value={form.skill}
              onChange={(event) => setForm({ ...form, skill: event.target.value, testType: event.target.value })}
            >
              <option value="READING">Reading</option>
              <option value="LISTENING">Listening</option>
            </Select>
          )}
        </Field>
        <Field label="Applies to test type">
          {(id) => (
            <Select id={id} value={form.testType} onChange={(event) => setForm({ ...form, testType: event.target.value })}>
              <option value="READING">Reading only</option>
              <option value="LISTENING">Listening only</option>
              <option value="FULL_MOCK">Full mock</option>
            </Select>
          )}
        </Field>
        <Field label="Minimum questions for an estimated band" required>
          {(id) => (
            <TextInput
              id={id}
              type="number"
              min={1}
              max={100}
              value={form.minQuestions}
              onChange={(event) => setForm({ ...form, minQuestions: Number(event.target.value) })}
            />
          )}
        </Field>
      </div>

      <Field label="Conversion table" hint="One range per line as `raw min - raw max = band`." required>
        {(id) => <TextArea id={id} rows={10} value={ranges} onChange={(event) => setRanges(event.target.value)} />}
      </Field>
      <p className="tiny muted">{parsed.length} valid range(s) parsed.</p>

      <Field label="Source notes" hint="Where does this conversion table come from? Record your provenance.">
        {(id) => <TextArea id={id} rows={2} value={form.sourceNotes} onChange={(event) => setForm({ ...form, sourceNotes: event.target.value })} />}
      </Field>

      <Button
        variant="primary"
        disabled={!form.name || parsed.length === 0}
        onClick={async () => {
          try {
            await api.post('/api/admin/scoring-profiles', {
              name: form.name,
              skill: form.skill,
              testType: form.testType,
              minQuestions: form.minQuestions,
              sourceNotes: form.sourceNotes || undefined,
              ranges: parsed,
              activate: form.activate,
            });
            await onCreated();
          } catch (createError) {
            onError(describeError(createError));
          }
        }}
      >
        Create profile
      </Button>
    </div>
  );
}
