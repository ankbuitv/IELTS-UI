import type { Role } from '../../shared/types';

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  status: 'ACTIVE' | 'SUSPENDED' | 'INVITED';
  displayName: string;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface AuthSession {
  id: string;
  userId: string;
  csrfToken: string;
  expiresAt: string;
}
