import { Hono } from 'hono';
import type { AppBindings } from './env';
import { ApiError } from './lib/errors';
import { securityHeaders } from './lib/http';
import { attachAuth } from './middleware/auth';
import { newId } from './lib/ids';

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

  app.get('/api/health', (c) =>
    c.json({ ok: true, service: 'ielts-platform', time: new Date().toISOString(), environment: c.env.APP_ENV }),
  );

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
    console.error('unhandled_error', requestId, error?.stack ?? String(error));
    return c.json(
      {
        error: {
          code: 'INTERNAL',
          message: 'Something went wrong. Please try again.',
          details: { requestId },
        },
      },
      500,
    );
  });

  return app;
}
