import { useState } from 'react';
import { api, describeError, queryString } from '../../lib/api';
import { useAsync } from '../../hooks/useAsync';
import { Badge, Button, Card, EmptyState, Field, Loading, Modal, Notice, Select, TextInput, useToast } from '../../components/ui';
import { formatDateTime } from '../../lib/format';

interface AdminUserRow {
  id: string;
  email: string;
  role: string;
  status: string;
  created_at: string;
  last_login_at: string | null;
  display_name: string | null;
  attempts: number;
  classrooms: number;
}

export function AdminUsersPage() {
  const toast = useToast();
  const [role, setRole] = useState('');
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<AdminUserRow | null>(null);

  const query = queryString({ role: role || undefined, search: search || undefined });
  const { data, loading, error, reload } = useAsync<{ users: AdminUserRow[] }>(
    () => api.get(`/api/admin/users${query}`),
    [query],
  );

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Users</h1>
          <p className="page-head__meta">Roles are enforced on the server. Public sign-up always creates students.</p>
        </div>
        <Button variant="primary" onClick={() => setCreateOpen(true)}>
          Create user
        </Button>
      </div>

      <Card>
        <div className="filter-bar">
          <label className="field">
            <span className="field__label">Role</span>
            <select value={role} onChange={(event) => setRole(event.target.value)}>
              <option value="">All roles</option>
              <option value="STUDENT">Student</option>
              <option value="TEACHER">Teacher</option>
              <option value="ADMIN">Administrator</option>
            </select>
          </label>
          <label className="field" style={{ minWidth: 260 }}>
            <span className="field__label">Search</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="email or name" />
          </label>
        </div>
      </Card>

      {loading ? <Loading /> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}

      <Card flush>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Status</th>
                <th className="num">Attempts</th>
                <th className="num">Classrooms</th>
                <th>Last sign-in</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data?.users.map((user) => (
                <tr key={user.id}>
                  <td>
                    {user.display_name ?? user.email}
                    <div className="tiny muted">{user.email}</div>
                  </td>
                  <td>
                    <Badge tone={user.role === 'ADMIN' ? 'accent' : user.role === 'TEACHER' ? 'info' : 'neutral'}>
                      {user.role.toLowerCase()}
                    </Badge>
                  </td>
                  <td>
                    <Badge tone={user.status === 'ACTIVE' ? 'success' : 'warning'}>{user.status.toLowerCase()}</Badge>
                  </td>
                  <td className="num">{user.attempts}</td>
                  <td className="num">{user.classrooms}</td>
                  <td className="nowrap">{user.last_login_at ? formatDateTime(user.last_login_at) : 'never'}</td>
                  <td className="right">
                    <Button size="sm" onClick={() => setEditing(user)}>
                      Manage
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data && data.users.length === 0 ? <EmptyState title="No users match" /> : null}
      </Card>

      <Modal
        open={createOpen}
        title="Create a user"
        onClose={() => setCreateOpen(false)}
        actions={<Button onClick={() => setCreateOpen(false)}>Close</Button>}
      >
        <CreateUserForm
          onCreated={async () => {
            await reload();
            setCreateOpen(false);
            toast.push('User created.', 'success');
          }}
        />
      </Modal>

      <Modal
        open={Boolean(editing)}
        title={editing ? `Manage ${editing.display_name ?? editing.email}` : ''}
        onClose={() => setEditing(null)}
        actions={<Button onClick={() => setEditing(null)}>Close</Button>}
      >
        {editing ? (
          <ManageUserForm
            user={editing}
            onDone={async (message) => {
              await reload();
              setEditing(null);
              toast.push(message, 'success');
            }}
            onError={(message) => toast.push(message, 'error')}
          />
        ) : null}
      </Modal>
    </div>
  );
}

function CreateUserForm({ onCreated }: { onCreated: () => Promise<void> }) {
  const [form, setForm] = useState({ email: '', displayName: '', role: 'STUDENT', password: '' });
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Field label="Email" required>
        {(id) => <TextInput id={id} type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />}
      </Field>
      <Field label="Display name" required>
        {(id) => (
          <TextInput id={id} value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} />
        )}
      </Field>
      <Field label="Role" required>
        {(id) => (
          <Select id={id} value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>
            <option value="STUDENT">Student</option>
            <option value="TEACHER">Teacher</option>
            <option value="ADMIN">Administrator</option>
          </Select>
        )}
      </Field>
      <Field
        label="Initial password"
        required
        hint="Share it through a secure channel and ask the user to change it. It is stored only as a salted hash."
      >
        {(id) => (
          <TextInput id={id} type="text" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
        )}
      </Field>
      <Button
        variant="primary"
        onClick={async () => {
          try {
            await api.post('/api/admin/users', form);
            await onCreated();
          } catch (createError) {
            setError(describeError(createError));
          }
        }}
      >
        Create user
      </Button>
    </div>
  );
}

function ManageUserForm({
  user,
  onDone,
  onError,
}: {
  user: AdminUserRow;
  onDone: (message: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [role, setRole] = useState(user.role);
  const [status, setStatus] = useState(user.status);
  const [resetPassword, setResetPassword] = useState('');

  return (
    <div className="stack">
      <Field label="Role">
        {(id) => (
          <Select id={id} value={role} onChange={(event) => setRole(event.target.value)}>
            <option value="STUDENT">Student</option>
            <option value="TEACHER">Teacher</option>
            <option value="ADMIN">Administrator</option>
          </Select>
        )}
      </Field>
      <Field label="Status">
        {(id) => (
          <Select id={id} value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="ACTIVE">Active</option>
            <option value="SUSPENDED">Suspended</option>
          </Select>
        )}
      </Field>
      <Field label="Set a new password (optional)" hint="Resetting a password signs the user out of all sessions.">
        {(id) => (
          <TextInput
            id={id}
            type="text"
            value={resetPassword}
            onChange={(event) => setResetPassword(event.target.value)}
            placeholder="Leave empty to keep the current password"
          />
        )}
      </Field>
      <p className="tiny muted">
        Every change here is written to the administrative audit log together with your account and IP address.
      </p>
      <Button
        variant="primary"
        onClick={async () => {
          try {
            await api.patch(`/api/admin/users/${user.id}`, {
              role,
              status,
              ...(resetPassword ? { resetPassword } : {}),
            });
            await onDone('User updated.');
          } catch (updateError) {
            onError(describeError(updateError));
          }
        }}
      >
        Save changes
      </Button>
    </div>
  );
}
