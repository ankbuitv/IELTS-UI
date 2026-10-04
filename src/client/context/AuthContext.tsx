import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, setCsrfToken, setSessionToken, type ApiUser } from '../lib/api';
import { EMPTY_AVATAR, type AvatarState } from '@shared/avatar';

interface AuthState {
  user: ApiUser | null;
  loading: boolean;
  /**
   * The signed-in person's avatar, fetched beside the session.
   *
   * It lives here rather than in a query on each page because the top bar shows
   * it on every screen: fetching it per page would repaint the corner of the
   * shell as you navigate. `EMPTY_AVATAR` (no picture, draw initials) is the
   * state until the fetch answers and whenever it fails, so a broken avatar
   * endpoint degrades to the initials that were there before.
   */
  avatar: AvatarState;
  setAvatar: (avatar: AvatarState) => void;
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<ApiUser>;
  register: (input: { email: string; password: string; displayName: string; bootstrapAdmin?: boolean }) => Promise<ApiUser>;
  logout: () => Promise<void>;
  setUser: (user: ApiUser | null) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<ApiUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [avatar, setAvatarState] = useState<AvatarState>(EMPTY_AVATAR);

  const loadAvatar = useCallback(async () => {
    try {
      const result = await api.get<{ avatar: AvatarState }>('/api/auth/avatar');
      setAvatarState(result.avatar ?? EMPTY_AVATAR);
    } catch {
      setAvatarState(EMPTY_AVATAR);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const result = await api.get<{ user: ApiUser | null; csrfToken: string | null; sessionToken?: string | null }>('/api/auth/me');
      setUser(result.user);
      setCsrfToken(result.csrfToken);
      setSessionToken(result.sessionToken ?? null);
      if (result.user) void loadAvatar();
      else setAvatarState(EMPTY_AVATAR);
    } catch {
      setUser(null);
      setCsrfToken(null);
      setAvatarState(EMPTY_AVATAR);
    } finally {
      setLoading(false);
    }
  }, [loadAvatar]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(
    async (email: string, password: string) => {
      const result = await api.post<{ user: ApiUser; csrfToken: string; sessionToken?: string | null }>('/api/auth/login', { email, password });
      setUser(result.user);
      setCsrfToken(result.csrfToken);
      setSessionToken(result.sessionToken ?? null);
      void loadAvatar();
      return result.user;
    },
    [loadAvatar],
  );

  const register = useCallback(
    async (input: { email: string; password: string; displayName: string; bootstrapAdmin?: boolean }) => {
      const result = await api.post<{ user: ApiUser; csrfToken: string; sessionToken?: string | null }>('/api/auth/register', input);
      setUser(result.user);
      setCsrfToken(result.csrfToken);
      setSessionToken(result.sessionToken ?? null);
      void loadAvatar();
      return result.user;
    },
    [loadAvatar],
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/api/auth/logout');
    } finally {
      setUser(null);
      setCsrfToken(null);
      setSessionToken(null);
      setAvatarState(EMPTY_AVATAR);
    }
  }, []);

  const setAvatar = useCallback((next: AvatarState) => setAvatarState(next ?? EMPTY_AVATAR), []);

  const value = useMemo<AuthState>(
    () => ({ user, avatar, setAvatar, loading, refresh, login, register, logout, setUser }),
    [user, avatar, setAvatar, loading, refresh, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
