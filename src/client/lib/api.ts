/**
 * Thin API client. Cookies carry the session (HttpOnly) and every mutating
 * request sends the per-session CSRF token in `X-CSRF-Token`.
 */
import type { Role } from '@shared/types';

let csrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

export function getCsrfToken(): string | null {
  return csrfToken;
}

export interface ApiErrorShape {
  code: string;
  message: string;
  details?: unknown;
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface ApiUser {
  id: string;
  email: string;
  role: Role;
  status: string;
  displayName: string;
  createdAt: string;
  lastLoginAt: string | null;
}

async function request<T>(path: string, options: RequestInit & { json?: unknown } = {}): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase();
  const headers = new Headers(options.headers);

  let body = options.body;
  if (options.json !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(options.json);
  }
  if (method !== 'GET' && method !== 'HEAD' && csrfToken) {
    headers.set('x-csrf-token', csrfToken);
  }

  const response = await fetch(path, {
    ...options,
    method,
    headers,
    body,
    credentials: 'same-origin',
  });

  if (response.status === 204) return undefined as T;

  let payload: unknown = null;
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    payload = await response.json().catch(() => null);
  }

  if (!response.ok) {
    const error = (payload as { error?: ApiErrorShape } | null)?.error;
    throw new ApiRequestError(
      response.status,
      error?.code ?? 'INTERNAL',
      error?.message ?? `Request failed with status ${response.status}.`,
      error?.details,
    );
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, json?: unknown) => request<T>(path, { method: 'POST', json }),
  patch: <T>(path: string, json?: unknown) => request<T>(path, { method: 'PATCH', json }),
  put: <T>(path: string, json?: unknown) => request<T>(path, { method: 'PUT', json }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, form: FormData, method: 'POST' | 'PATCH' = 'POST') =>
    request<T>(path, { method, body: form }),
};

export function describeError(error: unknown): string {
  if (error instanceof ApiRequestError) {
    const details = error.details as { problems?: string[]; issues?: Array<{ message: string }> } | undefined;
    if (details?.problems?.length) return `${error.message} ${details.problems.join(' ')}`;
    if (details?.issues?.length) return `${error.message} ${details.issues.map((i) => i.message).join(' ')}`;
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}

export function queryString(params: Record<string, string | number | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const out = search.toString();
  return out ? `?${out}` : '';
}
