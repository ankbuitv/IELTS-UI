/**
 * Email-link entry points.
 *
 *   /auth/magic?token=…      consumes a sign-in link (issued by the login page)
 *   /reset-password          asks for a reset link
 *   /reset-password?token=…  sets the new password
 *
 * The token is single-use, so the magic page guards its request with a ref:
 * React's development double-mount must not burn the link twice.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { describeError } from '../../lib/api';
import { Button, Field, Notice, TextInput } from '../../components/ui';
import { AuthScreen, PasswordPolicy } from './PublicPages';

const POINTS = [
  {
    title: 'One link, fifteen minutes',
    detail: 'The link signs you in once and then stops working — nothing to remember, nothing to leak.',
  },
  {
    title: 'Your account stays protected',
    detail: 'If two-factor is on, the link still asks for your authenticator code.',
  },
  {
    title: 'Works on any device',
    detail: 'Open the email where you want to study — phone, tablet or the computer in class.',
  },
];

function homeFor(role: string): string {
  if (role === 'ADMIN') return '/admin';
  if (role === 'TEACHER') return '/teacher';
  if (role === 'MENTOR') return '/mentor';
  return '/dashboard';
}

export function MagicLinkPage() {
  const { consumeMagicLink, verifyTwoFactor } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const next = params.get('next');
  const started = useRef(false);

  const [state, setState] = useState<'working' | 'code' | 'error'>('working');
  const [ticket, setTicket] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!token) {
      setState('error');
      setError('This sign-in link is missing its token. Request a new link from the sign-in page.');
      return;
    }
    void (async () => {
      try {
        const result = await consumeMagicLink(token);
        if ('twoFactorRequired' in result) {
          setTicket(result.ticket);
          setState('code');
          return;
        }
        navigate(next ?? homeFor(result.role), { replace: true });
      } catch (cause) {
        setState('error');
        setError(describeError(cause));
      }
    })();
  }, [consumeMagicLink, navigate, next, token]);

  const submitCode = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!ticket) return;
    setBusy(true);
    setError(null);
    try {
      const user = await verifyTwoFactor(ticket, code.trim());
      navigate(next ?? homeFor(user.role), { replace: true });
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthScreen
      eyebrow="Email sign-in"
      title="Check your email, then you're in."
      lede="Passwordless sign-in keeps the classroom link simple for students and staff alike."
      points={POINTS}
      formTitle={state === 'code' ? 'Authenticator code' : 'Signing you in'}
      formIntro={
        state === 'code'
          ? 'Your account has two-factor authentication. Enter the current code from your app (or a backup code).'
          : undefined
      }
      footer={
        <p className="auth__alt">
          Trouble with the link? <Link to="/login">Request a new one</Link>.
        </p>
      }
    >
      {error ? <Notice tone="danger">{error}</Notice> : null}

      {state === 'working' ? <p className="muted">Checking your link…</p> : null}

      {state === 'code' ? (
        <form onSubmit={submitCode}>
          <Field label="Authenticator or backup code" required>
            {(id) => (
              <TextInput
                id={id}
                autoFocus
                inputMode="text"
                autoComplete="one-time-code"
                required
                placeholder="123456"
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            )}
          </Field>
          <Button type="submit" variant="primary" size="lg" block loading={busy}>
            Verify and sign in
          </Button>
        </form>
      ) : null}

      {state === 'error' ? (
        <Link className="btn btn--primary btn--lg btn--block" to="/login">
          Back to sign in
        </Link>
      ) : null}
    </AuthScreen>
  );
}

export function ResetPasswordPage() {
  const { requestPasswordReset, resetPassword } = useAuth();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [sent, setSent] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const requestLink = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await requestPasswordReset(email.trim());
      setSent(true);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  const submitNewPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await resetPassword(token, password);
      setDone(true);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  const title = token ? 'Set a new password' : 'Reset your password';
  return (
    <AuthScreen
      eyebrow="Account recovery"
      title={token ? 'A fresh start for your password.' : 'Get back into your study plan.'}
      lede="Reset links are single-use and expire after thirty minutes. Every other signed-in device is logged out for you."
      points={[
        { title: 'Emailed privately', detail: 'The link goes only to the address on the account.' },
        { title: 'Single use', detail: 'Once the password changes, the link stops working.' },
        { title: 'Sessions cleared', detail: 'Any other device is signed out with the old password.' },
      ]}
      formTitle={done ? 'Password updated' : title}
      footer={
        <p className="auth__alt">
          Remembered it? <Link to="/login">Back to sign in</Link>.
        </p>
      }
    >
      {error ? <Notice tone="danger">{error}</Notice> : null}

      {done ? (
        <>
          <Notice tone="success" title="All set">
            Your password has been changed and old sessions were signed out.
          </Notice>
          <div style={{ height: 12 }} />
          <Link className="btn btn--primary btn--lg btn--block" to="/login">
            Sign in with the new password
          </Link>
        </>
      ) : token ? (
        <form onSubmit={submitNewPassword}>
          <Field label="New password" required>
            {(id) => (
              <TextInput
                id={id}
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            )}
          </Field>
          <PasswordPolicy password={password} email={email} />
          <Field label="Repeat the new password" required>
            {(id) => (
              <TextInput
                id={id}
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
              />
            )}
          </Field>
          <Button type="submit" variant="primary" size="lg" block loading={busy}>
            Save the new password
          </Button>
        </form>
      ) : sent ? (
        <>
          <Notice tone="success" title="Check your inbox">
            If an account uses that address, a reset link is on its way. It expires in 30 minutes.
          </Notice>
          <div style={{ height: 12 }} />
          <Button variant="ghost" size="sm" block onClick={() => setSent(false)}>
            Use a different email
          </Button>
        </>
      ) : (
        <form onSubmit={requestLink}>
          <Field label="Email or username" required>
            {(id) => (
              <TextInput
                id={id}
                type="text"
                autoComplete="username"
                required
                placeholder="you@school.edu"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            )}
          </Field>
          <Button type="submit" variant="primary" size="lg" block loading={busy}>
            Email me a reset link
          </Button>
        </form>
      )}
    </AuthScreen>
  );
}
