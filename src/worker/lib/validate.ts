import type { Context } from 'hono';
import type { z } from 'zod';
import { ApiError } from './errors';

/** Parses and validates a JSON request body, returning candidate-safe errors. */
export async function parseBody<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw ApiError.validation('A JSON request body is required.');
  }
  return parseWith(schema, raw);
}

export function parseWith<S extends z.ZodType>(schema: S, raw: unknown): z.infer<S> {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw ApiError.validation('The submitted data is invalid.', {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
      })),
    });
  }
  return result.data;
}

export function parseQuery<S extends z.ZodType>(c: Context, schema: S): z.infer<S> {
  const params = Object.fromEntries(new URL(c.req.url).searchParams.entries());
  return parseWith(schema, params);
}
