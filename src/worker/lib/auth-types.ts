import type { Role } from '../../shared/types';

export interface AuthUser {
  id: string;
  email: string;
  /** Public handle (also usable as the sign-in identifier), or null when unset. */
  username: string | null;
  role: Role;
  status: 'ACTIVE' | 'SUSPENDED' | 'INVITED';
  displayName: string;
  /** Cache-busted profile picture URL, or null when the user has no avatar. */
  avatarUrl: string | null;
  createdAt: string;
  lastLoginAt: string | null;
}

/** `/api/files/avatar/:userId?v=…` — the `v` busts caches after a new upload. */
export function avatarUrlFor(userId: string, avatarUpdatedAt: string | null | undefined): string | null {
  if (!avatarUpdatedAt) return null;
  return `/api/files/avatar/${encodeURIComponent(userId)}?v=${encodeURIComponent(avatarUpdatedAt)}`;
}

export interface AuthSession {
  id: string;
  userId: string;
  csrfToken: string;
  expiresAt: string;
}
