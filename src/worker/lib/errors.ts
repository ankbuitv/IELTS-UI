export type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'ATTEMPT_LOCKED'
  | 'ATTEMPT_EXPIRED'
  | 'ACCESS_CODE_REQUIRED'
  | 'AI_UNAVAILABLE'
  | 'STORAGE_UNAVAILABLE'
  | 'INTERNAL';

const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 400,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  ATTEMPT_LOCKED: 409,
  ATTEMPT_EXPIRED: 410,
  ACCESS_CODE_REQUIRED: 403,
  AI_UNAVAILABLE: 503,
  STORAGE_UNAVAILABLE: 503,
  INTERNAL: 500,
};

/**
 * Application error carrying a stable machine-readable code.
 * Messages are candidate-safe: they never include answer material.
 */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = STATUS[code] ?? 500;
    this.details = details;
  }

  static unauthenticated(message = 'You must sign in to continue.') {
    return new ApiError('UNAUTHENTICATED', message);
  }
  static forbidden(message = 'You are not allowed to do that.') {
    return new ApiError('FORBIDDEN', message);
  }
  static notFound(message = 'Not found.') {
    return new ApiError('NOT_FOUND', message);
  }
  static validation(message = 'The submitted data is invalid.', details?: unknown) {
    return new ApiError('VALIDATION_FAILED', message, details);
  }
  static conflict(message = 'That action conflicts with the current state.') {
    return new ApiError('CONFLICT', message);
  }
}
