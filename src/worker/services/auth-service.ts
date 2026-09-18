import type { Env } from '../env';
import type { AuthSession, AuthUser } from '../lib/auth-types';
import { ApiError } from '../lib/errors';
import { hashPassword, hashSessionToken, randomToken, verifyPassword } from '../lib/crypto';
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
}

async function findUserByEmail(env: Env, email: string): Promise<UserRow | null> {
  return env.DB.prepare(
    `SELECT u.id, u.email, u.role, u.status, u.password_hash, u.password_salt, u.password_iterations,
            u.password_algo, u.created_at, u.last_login_at, u.failed_login_count, u.locked_until,
            p.display_name
       FROM users u
       LEFT JOIN user_profiles p ON p.user_id = u.id
      WHERE u.email = ?`,
  )
    .bind(email)
    .first<UserRow>();
}

export function toAuthUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    status: row.status,
    displayName: row.display_name ?? row.email.split('@')[0] ?? 'User',
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

  const password = await hashPassword(input.password);
  const id = newId('usr');
  const timestamp = nowIso();

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, email, role, status, password_algo, password_hash, password_salt,
                          password_iterations, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      email,
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
    role: input.role,
    status: input.status ?? 'ACTIVE',
    displayName: input.displayName.trim() || email,
    createdAt: timestamp,
    lastLoginAt: null,
  };
}

export interface LoginResult {
  user: AuthUser;
  token: string;
  session: AuthSession;
}

const MAX_FAILED_LOGINS = 8;
const LOCK_MINUTES = 15;

export async function login(
  env: Env,
  credentials: { email: string; password: string },
  context: { ip: string; userAgent: string },
): Promise<LoginResult> {
  const email = normaliseEmail(credentials.email);
  const row = await findUserByEmail(env, email);

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
            u.id, u.email, u.role, u.status, u.created_at, u.last_login_at, p.display_name
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
      last_login_at: string | null;
      display_name: string | null;
    }>();

  if (!row) return null;
  if (row.revoked_at) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) return null;
  if (row.status === 'SUSPENDED') return null;

  return {
    user: {
      id: row.id,
      email: row.email,
      role: row.role,
      status: row.status,
      displayName: row.display_name ?? row.email,
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
  input: { displayName?: string; targetBand?: number | null; timezone?: string | null },
): Promise<void> {
  await env.DB.prepare(
    `UPDATE user_profiles
        SET display_name = COALESCE(?, display_name),
            target_band = ?,
            timezone = COALESCE(?, timezone),
            updated_at = ?
      WHERE user_id = ?`,
  )
    .bind(
      input.displayName ?? null,
      input.targetBand ?? null,
      input.timezone ?? null,
      nowIso(),
      userId,
    )
    .run();
}
