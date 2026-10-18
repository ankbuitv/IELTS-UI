import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, setCsrfToken, setSessionToken, type ApiUser } from '../lib/api';

/** A password (or OTP) was accepted; the account still wants its authenticator code. */
export interface TwoFactorChallenge {
  twoFactorRequired: true;
  ticket: string;
}

interface AuthState {
  user: ApiUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  /** Sign in with email OR username. Resolves to a challenge when 2FA is on. */
  login: (identifier: string, password: string) => Promise<ApiUser | TwoFactorChallenge>;
  /** Completes a 2FA sign-in with the six-digit authenticator code. */
  verifyTwoFactor: (ticket: string, code: string) => Promise<ApiUser>;
  /** Sends a one-time sign-in code (development responses carry `devCode`). */
  requestOtp: (identifier: string) => Promise<{ sent: true; devCode?: string }>;
  /** Sign in with the one-time code instead of a password. */
  loginWithOtp: (identifier: string, code: string) => Promise<ApiUser | TwoFactorChallenge>;
  register: (input: {
    email: string;
    password: string;
    displayName: string;
    username?: string;
    bootstrapAdmin?: boolean;
  }) => Promise<ApiUser>;
  logout: () => Promise<void>;
  setUser: (user: ApiUser | null) => void;
}

const AuthContext = createContext<AuthState | null>(null);

interface LoginResponse {
  user: ApiUser;
  csrfToken: string;
  sessionToken?: string | null;
}

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

  const finishLogin = useCallback((result: LoginResponse) => {
    setUser(result.user);
    setCsrfToken(result.csrfToken);
    setSessionToken(result.sessionToken ?? null);
    return result.user;
  }, []);

  const login = useCallback(
    async (identifier: string, password: string) => {
      const result = await api.post<LoginResponse | { twoFactorRequired: true; ticket: string }>('/api/auth/login', {
        email: identifier,
        password,
      });
      if ('twoFactorRequired' in result) return { twoFactorRequired: true, ticket: result.ticket } as const;
      return finishLogin(result);
    },
    [finishLogin],
  );

  const verifyTwoFactor = useCallback(
    async (ticket: string, code: string) => {
      const result = await api.post<LoginResponse>('/api/auth/2fa/verify', { ticket, code });
      return finishLogin(result);
    },
    [finishLogin],
  );

  const requestOtp = useCallback(async (identifier: string) => {
    return api.post<{ sent: true; devCode?: string }>('/api/auth/otp/request', { identifier });
  }, []);

  const loginWithOtp = useCallback(
    async (identifier: string, code: string) => {
      const result = await api.post<LoginResponse | { twoFactorRequired: true; ticket: string }>('/api/auth/otp/login', {
        identifier,
        code,
      });
      if ('twoFactorRequired' in result) return { twoFactorRequired: true, ticket: result.ticket } as const;
      return finishLogin(result);
    },
    [finishLogin],
  );

  const register = useCallback(
    async (input: { email: string; password: string; displayName: string; username?: string; bootstrapAdmin?: boolean }) => {
      const result = await api.post<LoginResponse>('/api/auth/register', input);
      return finishLogin(result);
    },
    [finishLogin],
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
    () => ({ user, loading, refresh, login, verifyTwoFactor, requestOtp, loginWithOtp, register, logout, setUser }),
    [user, loading, refresh, login, verifyTwoFactor, requestOtp, loginWithOtp, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
