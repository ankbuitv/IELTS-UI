import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, setCsrfToken, setSessionToken, type ApiUser } from '../lib/api';

interface AuthState {
  user: ApiUser | null;
  loading: boolean;
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

  const refresh = useCallback(async () => {
    try {
      const result = await api.get<{ user: ApiUser | null; csrfToken: string | null; sessionToken?: string | null }>('/api/auth/me');
      setUser(result.user);
      setCsrfToken(result.csrfToken);
      setSessionToken(result.sessionToken ?? null);
    } catch {
      setUser(null);
      setCsrfToken(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const result = await api.post<{ user: ApiUser; csrfToken: string; sessionToken?: string | null }>('/api/auth/login', { email, password });
    setUser(result.user);
    setCsrfToken(result.csrfToken);
    setSessionToken(result.sessionToken ?? null);
    return result.user;
  }, []);

  const register = useCallback(
    async (input: { email: string; password: string; displayName: string; bootstrapAdmin?: boolean }) => {
      const result = await api.post<{ user: ApiUser; csrfToken: string; sessionToken?: string | null }>('/api/auth/register', input);
      setUser(result.user);
      setCsrfToken(result.csrfToken);
      setSessionToken(result.sessionToken ?? null);
      return result.user;
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/api/auth/logout');
    } finally {
      setUser(null);
      setCsrfToken(null);
      setSessionToken(null);
    }
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, loading, refresh, login, register, logout, setUser }),
    [user, loading, refresh, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
