import { Hono } from 'hono';
import type { AppBindings } from './env';
import { ApiError } from './lib/errors';
import { securityHeaders } from './lib/http';
import { attachAuth } from './middleware/auth';
import { newId } from './lib/ids';
import { ensureSchema, isMissingSchemaError, schemaDrift, MISSING_SCHEMA_HINT } from './lib/ensure-schema';

import authRoutes from './routes/auth';
import catalogRoutes from './routes/catalog';
import attemptRoutes from './routes/attempts';
import studentRoutes from './routes/student';
import classroomRoutes from './routes/classrooms';
import teacherRoutes from './routes/teacher';
import adminRoutes from './routes/admin';
import fileRoutes from './routes/files';
import importRoutes from './routes/imports';

export function createApp() {
  const app = new Hono<AppBindings>();

  app.use('*', async (c, next) => {
    const requestId = newId('req', 12);
    c.set('requestId', requestId);
    c.set('user', null);
    c.set('session', null);
    c.header('x-request-id', requestId);
    for (const [key, value] of Object.entries(securityHeaders())) c.header(key, value);
    await next();
  });

  app.use('*', attachAuth);

  // Creates any missing table before the first query touches it, so a database
  // whose migrations were never applied still comes up instead of returning a
  // 500 for every request. One cheap read per isolate, nothing afterwards.
  app.use('/api/*', async (c, next) => {
    await ensureSchema(c.env);
    await next();
  });

  app.get('/api/health', async (c) => {
    // Never let the health probe fail: it reports what it could not read.
    const database = await probeDatabase(c.env);
    return c.json({
      ok: database.reachable,
      service: 'ielts-platform',
      time: new Date().toISOString(),
      environment: c.env.APP_ENV,
      database,
    });
  });

  app.route('/api/auth', authRoutes);
  app.route('/api', catalogRoutes);
  app.route('/api/attempts', attemptRoutes);
  app.route('/api/student', studentRoutes);
  app.route('/api', classroomRoutes);
  app.route('/api/teacher', teacherRoutes);
  app.route('/api/admin', adminRoutes);
  app.route('/api/admin/imports', importRoutes);
  app.route('/api/files', fileRoutes);

  app.notFound((c) => {
    if (c.req.path.startsWith('/api/')) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found.' } }, 404);
    }
    return c.env.ASSETS.fetch(c.req.raw);
  });

  app.onError((error, c) => {
    if (error instanceof ApiError) {
      return c.json(
        { error: { code: error.code, message: error.message, details: error.details } },
        error.status as never,
      );
    }

    const requestId = c.get('requestId');
    const reason = (error as Error)?.message ?? String(error);
    console.error('unhandled_error', requestId, (error as Error)?.stack ?? reason);

    // An un-initialised database is an operator problem, not a candidate one.
    // Say so, with the command that fixes it, instead of a bare 500.
    if (isMissingSchemaError(error)) {
      return c.json(
        {
          error: {
            code: 'STORAGE_UNAVAILABLE',
            message: 'The platform database is not initialised yet, so accounts cannot be created or read.',
            details: { requestId, reason, fix: 'npx wrangler d1 migrations apply DB --remote' },
          },
        },
        503 as never,
      );
    }

    // Outside production the underlying reason is included: it is what turns an
    // undiagnosable "something went wrong" into a one-line fix.
    const verbose = c.env.APP_ENV !== 'production';
    return c.json(
      {
        error: {
          code: 'INTERNAL',
          message: verbose ? `Something went wrong: ${reason}` : 'Something went wrong. Please try again.',
          details: verbose ? { requestId, reason, hint: MISSING_SCHEMA_HINT } : { requestId },
        },
      },
      500,
    );
  });

  return app;
}

interface DatabaseProbe {
  reachable: boolean;
  schemaReady: boolean;
  missingTables?: string[];
  missingColumns?: string[];
  unhealableColumns?: string[];
}

/**
 * Reports whether the bound D1 database answers and whether the application
 * schema is current — tables *and* columns. Never throws: the health probe
 * must stay readable even when the database is the thing that is broken.
 */
async function probeDatabase(env: AppBindings['Bindings']): Promise<DatabaseProbe> {
  try {
    const drift = await schemaDrift(env);
    return {
      reachable: true,
      schemaReady: drift.missingTables.length === 0 && drift.missingColumns.length === 0,
      missingTables: drift.missingTables,
      missingColumns: drift.missingColumns,
      unhealableColumns: drift.unhealableColumns,
    };
  } catch (error) {
    return { reachable: false, schemaReady: false, missingTables: [(error as Error)?.message ?? 'unknown'] };
  }
}

