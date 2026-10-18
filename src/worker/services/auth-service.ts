import type { Env } from '../env';
import { avatarUrlFor, type AuthSession, type AuthUser } from '../lib/auth-types';
import { ApiError } from '../lib/errors';
import { hashPassword, hashSessionToken, randomToken, verifyPassword } from '../lib/crypto';
import { generateOtpCode, generateTotpSecret, totpAuthUrl, verifyTotp } from '../lib/totp';
import { newId, nowIso } from '../lib/ids';
import type { Role } from '../../shared/types';

const MIN_PASSWORD_LENGTH = 10;
/** Small denylist of trivially guessable passwords - not a substitute for entropy. */
const COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  'password123',
  '1234567890',
  'qwertyuiop',
  'letmein123',
  'iloveyou1',
  'admin12345',
  'changeme123',
  'welcome1234',
  'passw0rd123',
]);

export interface PasswordPolicyResult {
  ok: boolean;
  problems: string[];
}

export function checkPasswordPolicy(password: string, email?: string): PasswordPolicyResult {
  const problems: string[] = [];
  if (password.length < MIN_PASSWORD_LENGTH) {
    problems.push(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    problems.push('Password must include lower-case, upper-case and numeric characters.');
  }
  const lowered = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lowered)) {
    problems.push('Password is too common.');
  }
  if (email) {
    const localPart = email.split('@')[0]?.toLowerCase() ?? '';
    if (localPart.length >= 4 && lowered.includes(localPart)) {
      problems.push('Password must not contain your email address.');
    }
  }
  return { ok: problems.length === 0, problems };
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

interface UserRow {
  id: string;
  email: string;
  username: string | null;
  role: Role;
  status: 'ACTIVE' | 'SUSPENDED' | 'INVITED';
  password_hash: string | null;
  password_salt: string | null;
  password_iterations: number | null;
  password_algo: string | null;
  created_at: string;
  last_login_at: string | null;
  failed_login_count: number;
  locked_until: string | null;
  display_name: string | null;
  avatar_updated_at: string | null;
}

interface UserRowAuth extends UserRow {
  totp_secret: string | null;
  totp_enabled: number;
}

/** Sign in with either the email address or the public username. */
async function findUserByIdentifier(env: Env, email: string): Promise<UserRowAuth | null> {
  return env.DB.prepare(
    `SELECT u.id, u.email, u.role, u.status, u.password_hash, u.password_salt, u.password_iterations,
            u.password_algo, u.created_at, u.last_login_at, u.failed_login_count, u.locked_until,
            u.username, p.display_name, p.avatar_updated_at, p.totp_secret, p.totp_enabled
       FROM users u
       LEFT JOIN user_profiles p ON p.user_id = u.id
      WHERE u.email = ? OR (u.username IS NOT NULL AND LOWER(u.username) = LOWER(?))`,
  )
    .bind(email, email)
    .first<UserRowAuth>();
}

export function toAuthUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    role: row.role,
    status: row.status,
    displayName: row.display_name ?? row.username ?? row.email.split('@')[0] ?? 'User',
    avatarUrl: avatarUrlFor(row.id, row.avatar_updated_at),
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}

export interface CreateUserInput {
  email: string;
  password: string;
  displayName: string;
  role: Role;
  createdBy?: string | null;
  status?: 'ACTIVE' | 'INVITED';
  username?: string | null;
}

export function normaliseUsername(username: string): string {
  return username.trim().toLowerCase().replace(/^@/, '');
}

const USERNAME_RE = /^[a-z0-9][a-z0-9_.]{2,23}$/;

export async function ensureUsernameAvailable(env: Env, username: string, exceptUserId?: string): Promise<void> {
  const clean = normaliseUsername(username);
  if (!USERNAME_RE.test(clean)) {
    throw ApiError.validation('Username must be 3–24 characters: letters, numbers, dot, underscore.');
  }
  const existing = await env.DB.prepare('SELECT id FROM users WHERE LOWER(username) = ?')
    .bind(clean)
    .first<{ id: string }>();
  if (existing && existing.id !== exceptUserId) throw ApiError.conflict('That username is already taken.');
}

export async function createUser(env: Env, input: CreateUserInput): Promise<AuthUser> {
  const email = normaliseEmail(input.email);
  const policy = checkPasswordPolicy(input.password, email);
  if (!policy.ok) {
    throw ApiError.validation('The password does not meet the security policy.', { problems: policy.problems });
  }

  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<{ id: string }>();
  if (existing) {
    throw ApiError.conflict('An account with that email already exists.');
  }

  let username: string | null = null;
  if (input.username) {
    await ensureUsernameAvailable(env, input.username);
    username = normaliseUsername(input.username);
  }

  const password = await hashPassword(input.password);
  const id = newId('usr');
  const timestamp = nowIso();

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, email, username, role, status, password_algo, password_hash, password_salt,
                          password_iterations, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      email,
      username,
      input.role,
      input.status ?? 'ACTIVE',
      password.algo,
      password.hash,
      password.salt,
      password.iterations,
      input.createdBy ?? null,
      timestamp,
      timestamp,
    ),
    env.DB.prepare(
      `INSERT INTO user_profiles (user_id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
    ).bind(id, input.displayName.trim().slice(0, 120) || email.split('@')[0] || 'User', timestamp, timestamp),
  ]);

  return {
    id,
    email,
    username,
    role: input.role,
    status: input.status ?? 'ACTIVE',
    displayName: input.displayName.trim() || username || email,
    avatarUrl: null,
    createdAt: timestamp,
    lastLoginAt: null,
  };
}

export interface LoginResult {
  user: AuthUser;
  token: string;
  session: AuthSession;
}

/** Returned when the password is right but an authenticator code is still due. */
export interface TwoFactorPending {
  twoFactorRequired: true;
  ticket: string;
  expiresAt: string;
}

const MAX_FAILED_LOGINS = 8;
const LOCK_MINUTES = 15;

export async function login(
  env: Env,
  credentials: { email: string; password: string },
  context: { ip: string; userAgent: string },
): Promise<LoginResult | TwoFactorPending> {
  // "email" also accepts the username — the field is the identifier.
  const email = credentials.email.trim().toLowerCase();
  const row = await findUserByIdentifier(env, email);

  const logAttempt = async (success: boolean, reason: string) => {
    await env.DB.prepare(
      'INSERT INTO login_attempts (id, email, ip, success, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
      .bind(newId('lga'), email, context.ip, success ? 1 : 0, reason, nowIso())
      .run();
  };

  if (!row || !row.password_hash || !row.password_salt) {
    // Perform a dummy derivation so response timing does not disclose account existence.
    await hashPassword(credentials.password, { salt: 'AAAAAAAAAAAAAAAAAAAAAA' });
    await logAttempt(false, 'NO_ACCOUNT');
    throw ApiError.unauthenticated('Incorrect email or password.');
  }

  if (row.status === 'SUSPENDED') {
    await logAttempt(false, 'SUSPENDED');
    throw ApiError.forbidden('This account is suspended. Contact an administrator.');
  }

  if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
    await logAttempt(false, 'LOCKED');
    throw new ApiError('RATE_LIMITED', 'Too many failed attempts. Try again later.', {
      lockedUntil: row.locked_until,
    });
  }

  const valid = await verifyPassword(credentials.password, {
    hash: row.password_hash,
    salt: row.password_salt,
    iterations: row.password_iterations ?? 100_000,
    algo: row.password_algo ?? 'PBKDF2-SHA256',
  });

  if (!valid) {
    const failedCount = row.failed_login_count + 1;
    const lockedUntil =
      failedCount >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null;
    await env.DB.prepare('UPDATE users SET failed_login_count = ?, locked_until = ?, updated_at = ? WHERE id = ?')
      .bind(failedCount, lockedUntil, nowIso(), row.id)
      .run();
    await logAttempt(false, 'BAD_PASSWORD');
    throw ApiError.unauthenticated('Incorrect email or password.');
  }

  // 2FA: the password alone is not enough when the account has an authenticator.
  if (row.totp_enabled === 1 && row.totp_secret) {
    const ticket = await issueOtpRow(env, row.id, 'LOGIN', randomToken(24), 5 * 60_000);
    await logAttempt(true, 'PASSWORD_OK_2FA_PENDING');
    return {
      twoFactorRequired: true,
      ticket: ticket.code,
      expiresAt: ticket.expiresAt,
    };
  }

  await env.DB.prepare(
    'UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = ?, updated_at = ? WHERE id = ?',
  )
    .bind(nowIso(), nowIso(), row.id)
    .run();
  await logAttempt(true, 'OK');

  const session = await createSession(env, row.id, context);
  return { user: toAuthUser({ ...row, failed_login_count: 0, locked_until: null }), ...session };
}

export async function createSession(
  env: Env,
  userId: string,
  context: { ip: string; userAgent: string },
): Promise<{ token: string; session: AuthSession }> {
  const ttlHours = Number(env.SESSION_TTL_HOURS || 12);
  const token = randomToken(32);
  const id = await hashSessionToken(token, env.SESSION_SECRET ?? 'dev-pepper');
  const csrfToken = randomToken(24);
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + ttlHours * 3_600_000).toISOString();

  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, csrf_token, created_at, expires_at, last_seen_at, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, userId, csrfToken, createdAt, expiresAt, createdAt, context.ip, context.userAgent)
    .run();

  return { token, session: { id, userId, csrfToken, expiresAt } };
}

export interface ResolvedSession {
  user: AuthUser;
  session: AuthSession;
}

export async function resolveSession(env: Env, token: string): Promise<ResolvedSession | null> {
  const id = await hashSessionToken(token, env.SESSION_SECRET ?? 'dev-pepper');
  const row = await env.DB.prepare(
    `SELECT s.id AS session_id, s.csrf_token, s.expires_at, s.revoked_at,
            u.id, u.email, u.username, u.role, u.status, u.created_at, u.last_login_at, p.display_name, p.avatar_updated_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN user_profiles p ON p.user_id = u.id
      WHERE s.id = ?`,
  )
    .bind(id)
    .first<{
      session_id: string;
      csrf_token: string;
      expires_at: string;
      revoked_at: string | null;
      id: string;
      email: string;
      role: Role;
      status: 'ACTIVE' | 'SUSPENDED' | 'INVITED';
      created_at: string;
      username: string | null;
      last_login_at: string | null;
      display_name: string | null;
      avatar_updated_at: string | null;
    }>();

  if (!row) return null;
  if (row.revoked_at) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) return null;
  if (row.status === 'SUSPENDED') return null;

  return {
    user: {
      id: row.id,
      email: row.email,
      username: row.username,
      role: row.role,
      status: row.status,
      displayName: row.display_name ?? row.username ?? row.email,
      avatarUrl: avatarUrlFor(row.id, row.avatar_updated_at),
      createdAt: row.created_at,
      lastLoginAt: row.last_login_at,
    },
    session: {
      id: row.session_id,
      userId: row.id,
      csrfToken: row.csrf_token,
      expiresAt: row.expires_at,
    },
  };
}

export async function touchSession(env: Env, sessionId: string): Promise<void> {
  await env.DB.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').bind(nowIso(), sessionId).run();
}

export async function revokeSession(env: Env, sessionId: string): Promise<void> {
  await env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?').bind(nowIso(), sessionId).run();
}

export async function revokeAllSessions(env: Env, userId: string): Promise<void> {
  await env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
    .bind(nowIso(), userId)
    .run();
}

export async function changePassword(
  env: Env,
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const row = await env.DB.prepare(
    'SELECT id, email, password_hash, password_salt, password_iterations FROM users WHERE id = ?',
  )
    .bind(userId)
    .first<{
      id: string;
      email: string;
      password_hash: string | null;
      password_salt: string | null;
      password_iterations: number | null;
    }>();
  if (!row || !row.password_hash || !row.password_salt) throw ApiError.notFound('Account not found.');

  const valid = await verifyPassword(currentPassword, {
    hash: row.password_hash,
    salt: row.password_salt,
    iterations: row.password_iterations ?? 100_000,
    algo: 'PBKDF2-SHA256',
  });
  if (!valid) throw ApiError.validation('The current password is incorrect.');

  const policy = checkPasswordPolicy(newPassword, row.email);
  if (!policy.ok) {
    throw ApiError.validation('The new password does not meet the security policy.', { problems: policy.problems });
  }

  const hashed = await hashPassword(newPassword);
  await env.DB.prepare(
    `UPDATE users SET password_hash = ?, password_salt = ?, password_iterations = ?, password_algo = ?, updated_at = ?
      WHERE id = ?`,
  )
    .bind(hashed.hash, hashed.salt, hashed.iterations, hashed.algo, nowIso(), userId)
    .run();

  // Invalidate every other session after a credential change.
  await revokeAllSessions(env, userId);
}

export async function hasAnyUserWithRole(env: Env, role: Role): Promise<boolean> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS count FROM users WHERE role = ?').bind(role).first<{ count: number }>();
  return (row?.count ?? 0) > 0;
}

export async function updateProfile(
  env: Env,
  userId: string,
  input: {
    displayName?: string;
    targetBand?: number | null;
    timezone?: string | null;
    bio?: string;
    links?: Array<{ label: string; url: string }>;
  },
): Promise<void> {
  await env.DB.prepare(
    `UPDATE user_profiles
        SET display_name = COALESCE(?, display_name),
            target_band = ?,
            timezone = COALESCE(?, timezone),
            bio = COALESCE(?, bio),
            links_json = COALESCE(?, links_json),
            updated_at = ?
      WHERE user_id = ?`,
  )
    .bind(
      input.displayName ?? null,
      input.targetBand ?? null,
      input.timezone ?? null,
      input.bio ?? null,
      input.links ? JSON.stringify(input.links.slice(0, 5)) : null,
      nowIso(),
      userId,
    )
    .run();
}


// --------------------------------------------------------------------- 2FA / OTP

interface IssuedOtp {
  /** The plaintext code/ticket — shown once, never stored. */
  code: string;
  expiresAt: string;
}

/** Hashes and stores a single-use code (login OTP, 2FA ticket or backup code). */
async function issueOtpRow(
  env: Env,
  userId: string,
  purpose: 'LOGIN' | 'BACKUP',
  code: string,
  ttlMs: number,
): Promise<IssuedOtp> {
  const hashed = await hashPassword(code, { iterations: 5_000 });
  const timestamp = nowIso();
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  await env.DB.prepare(
    `INSERT INTO login_otp_codes (id, user_id, purpose, code_hash, code_salt, code_iterations, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(newId('otp'), userId, purpose, hashed.hash, hashed.salt, hashed.iterations, expiresAt, timestamp)
    .run();
  return { code, expiresAt };
}

async function consumeOtpRow(env: Env, userId: string, purpose: 'LOGIN' | 'BACKUP', code: string): Promise<boolean> {
  const rows = await env.DB.prepare(
    `SELECT id, code_hash, code_salt, code_iterations, expires_at FROM login_otp_codes
      WHERE user_id = ? AND purpose = ? AND used_at IS NULL AND expires_at > ?
      ORDER BY created_at DESC LIMIT 5`,
  )
    .bind(userId, purpose, nowIso())
    .all<{ id: string; code_hash: string; code_salt: string; code_iterations: number; expires_at: string }>();
  for (const row of rows.results ?? []) {
    const valid = await verifyPassword(code, {
      hash: row.code_hash,
      salt: row.code_salt,
      iterations: row.code_iterations,
      algo: 'PBKDF2-SHA256',
    });
    if (valid) {
      await env.DB.prepare('UPDATE login_otp_codes SET used_at = ? WHERE id = ?').bind(nowIso(), row.id).run();
      return true;
    }
  }
  return false;
}

/** Second step of a 2FA login: the ticket from the password step + a TOTP code. */
export async function verifyTwoFactor(
  env: Env,
  input: { ticket: string; code: string },
  context: { ip: string; userAgent: string },
): Promise<LoginResult> {
  // The ticket is stored hashed like a password; find its row by verifying
  // against the newest unused LOGIN codes.
  const candidates = await env.DB.prepare(
    `SELECT id, user_id, code_hash, code_salt, code_iterations FROM login_otp_codes
      WHERE purpose = 'LOGIN' AND used_at IS NULL AND expires_at > ?
      ORDER BY created_at DESC LIMIT 20`,
  )
    .bind(nowIso())
    .all<{ id: string; user_id: string; code_hash: string; code_salt: string; code_iterations: number }>();

  let matched: { id: string; user_id: string } | null = null;
  for (const row of candidates.results ?? []) {
    const valid = await verifyPassword(input.ticket, {
      hash: row.code_hash,
      salt: row.code_salt,
      iterations: row.code_iterations,
      algo: 'PBKDF2-SHA256',
    });
    if (valid) {
      matched = { id: row.id, user_id: row.user_id };
      break;
    }
  }
  if (!matched) throw ApiError.unauthenticated('That sign-in request expired. Start again.');

  const profile = await env.DB.prepare('SELECT totp_secret, totp_enabled FROM user_profiles WHERE user_id = ?')
    .bind(matched.user_id)
    .first<{ totp_secret: string | null; totp_enabled: number }>();
  if (!profile?.totp_secret || profile.totp_enabled !== 1) {
    throw ApiError.unauthenticated('Two-factor authentication is not active on that account.');
  }
  const ok = await verifyTotp(profile.totp_secret, input.code);
  if (!ok) throw ApiError.unauthenticated('That authenticator code is not correct.');

  await env.DB.prepare('UPDATE login_otp_codes SET used_at = ? WHERE id = ?').bind(nowIso(), matched.id).run();

  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.username, u.role, u.status, u.password_hash, u.password_salt, u.password_iterations,
            u.password_algo, u.created_at, u.last_login_at, u.failed_login_count, u.locked_until,
            u.username, p.display_name, p.avatar_updated_at, p.totp_secret, p.totp_enabled
       FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id WHERE u.id = ?`,
  )
    .bind(matched.user_id)
    .first<UserRowAuth>();
  if (!row) throw ApiError.unauthenticated('That account no longer exists.');

  await env.DB.prepare(
    'UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = ?, updated_at = ? WHERE id = ?',
  )
    .bind(nowIso(), nowIso(), row.id)
    .run();

  const session = await createSession(env, row.id, context);
  return { user: toAuthUser({ ...row, failed_login_count: 0, locked_until: null }), ...session };
}

/** Emails (or, in development, hands back) a one-time sign-in code. */
export async function requestLoginOtp(
  env: Env,
  identifier: string,
): Promise<{ sent: true; devCode?: string; expiresAt: string }> {
  const row = await findUserByIdentifier(env, identifier.trim().toLowerCase());
  // Never disclose whether the account exists.
  if (!row) return { sent: true, expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() };
  if (row.status === 'SUSPENDED') throw ApiError.forbidden('This account is suspended. Contact an administrator.');

  const issued = await issueOtpRow(env, row.id, 'LOGIN', generateOtpCode(), 10 * 60_000);
  // Delivery: an email provider can be wired in here. In development the code
  // is returned to the caller so the flow is testable end to end.
  const dev = (env.APP_ENV ?? '').toLowerCase() !== 'production';
  console.info('login_otp', row.id, dev ? `(dev code ${issued.code})` : '(sent)');
  return { sent: true, ...(dev ? { devCode: issued.code } : {}), expiresAt: issued.expiresAt };
}

/** Signs a user in with the one-time code instead of a password. */
export async function loginWithOtp(
  env: Env,
  input: { identifier: string; code: string },
  context: { ip: string; userAgent: string },
): Promise<LoginResult | TwoFactorPending> {
  const row = await findUserByIdentifier(env, input.identifier.trim().toLowerCase());
  if (!row) throw ApiError.unauthenticated('That code is not correct.');
  const ok = await consumeOtpRow(env, row.id, 'LOGIN', input.code.trim().toUpperCase());
  if (!ok) throw ApiError.unauthenticated('That code is not correct.');
  if (row.status === 'SUSPENDED') throw ApiError.forbidden('This account is suspended. Contact an administrator.');

  // A second factor still applies when the account has one.
  if (row.totp_enabled === 1 && row.totp_secret) {
    const ticket = await issueOtpRow(env, row.id, 'LOGIN', randomToken(24), 5 * 60_000);
    return { twoFactorRequired: true, ticket: ticket.code, expiresAt: ticket.expiresAt };
  }

  await env.DB.prepare(
    'UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = ?, updated_at = ? WHERE id = ?',
  )
    .bind(nowIso(), nowIso(), row.id)
    .run();
  const session = await createSession(env, row.id, context);
  return { user: toAuthUser({ ...row, failed_login_count: 0, locked_until: null }), ...session };
}

/** Starts authenticator-app setup: the secret + otpauth link (not active yet). */
export async function setupTotp(
  env: Env,
  user: AuthUser,
): Promise<{ secret: string; authUrl: string }> {
  const secret = generateTotpSecret();
  await env.DB.prepare('UPDATE user_profiles SET totp_secret = ?, totp_enabled = 0 WHERE user_id = ?')
    .bind(secret, user.id)
    .run();
  return { secret, authUrl: totpAuthUrl(user.email, 'Ai eo', secret) };
}

/** Turns 2FA on once the user proves they have the authenticator. */
export async function enableTotp(env: Env, user: AuthUser, code: string): Promise<{ enabled: true }> {
  const profile = await env.DB.prepare('SELECT totp_secret FROM user_profiles WHERE user_id = ?')
    .bind(user.id)
    .first<{ totp_secret: string | null }>();
  if (!profile?.totp_secret) throw ApiError.validation('Start the setup step first.');
  const ok = await verifyTotp(profile.totp_secret, code);
  if (!ok) throw ApiError.validation('That authenticator code is not correct — check your app and try again.');
  await env.DB.prepare('UPDATE user_profiles SET totp_enabled = 1 WHERE user_id = ?').bind(user.id).run();
  return { enabled: true };
}

export async function disableTotp(env: Env, user: AuthUser, code: string): Promise<{ enabled: false }> {
  const profile = await env.DB.prepare('SELECT totp_secret, totp_enabled FROM user_profiles WHERE user_id = ?')
    .bind(user.id)
    .first<{ totp_secret: string | null; totp_enabled: number }>();
  if (profile?.totp_enabled === 1 && profile.totp_secret) {
    const ok = await verifyTotp(profile.totp_secret, code);
    if (!ok) throw ApiError.validation('Enter a current authenticator code to turn 2FA off.');
  }
  await env.DB.prepare('UPDATE user_profiles SET totp_secret = NULL, totp_enabled = 0 WHERE user_id = ?')
    .bind(user.id)
    .run();
  return { enabled: false };
}


/**
 * Federated sign-in (SSO): the provider already proved the email belongs to
 * the user, so no password is checked. The platform account must already exist.
 */
export async function loginFederated(
  env: Env,
  email: string,
  context: { ip: string; userAgent: string },
): Promise<LoginResult> {
  const row = await findUserByIdentifier(env, normaliseEmail(email));
  if (!row) throw ApiError.unauthenticated('No account matches that provider email.');
  if (row.status === 'SUSPENDED') throw ApiError.forbidden('This account is suspended. Contact an administrator.');
  await env.DB.prepare(
    'UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = ?, updated_at = ? WHERE id = ?',
  )
    .bind(nowIso(), nowIso(), row.id)
    .run();
  const session = await createSession(env, row.id, context);
  return { user: toAuthUser({ ...row, failed_login_count: 0, locked_until: null }), ...session };
}
