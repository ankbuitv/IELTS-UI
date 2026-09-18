import { Hono } from 'hono';
import { z } from 'zod';
import type { AppBindings } from '../env';
import { requireAuth } from '../middleware/auth';
import { currentUser } from '../middleware/auth';
import { parseQuery } from '../lib/validate';
import {
  getStudentDashboard,
  getTaskTypePerformance,
  getTrends,
  listAttempts,
  listStudentAssignments,
} from '../services/analytics-service';
import { SKILLS, TEST_TYPES } from '../../shared/types';

const router = new Hono<AppBindings>();

router.use('*', requireAuth);

const filterSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  skill: z.enum(SKILLS).optional(),
  testType: z.enum(TEST_TYPES).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

router.get('/dashboard', async (c) => {
  const user = currentUser(c);
  const filters = parseQuery(c, filterSchema);
  const dashboard = await getStudentDashboard(c.env, user.id, {
    from: filters.from ?? null,
    to: filters.to ?? null,
    skill: filters.skill ?? null,
    testType: filters.testType ?? null,
    limit: filters.limit ?? 60,
  });
  return c.json(dashboard);
});

router.get('/attempts', async (c) => {
  const user = currentUser(c);
  const filters = parseQuery(c, filterSchema);
  const attempts = await listAttempts(c.env, user.id, {
    from: filters.from ?? null,
    to: filters.to ?? null,
    skill: filters.skill ?? null,
    testType: filters.testType ?? null,
    limit: filters.limit ?? 60,
  });
  return c.json({ attempts });
});

router.get('/assignments', async (c) => {
  const user = currentUser(c);
  const assignments = await listStudentAssignments(c.env, user.id);
  return c.json({ assignments });
});

router.get('/analytics', async (c) => {
  const user = currentUser(c);
  const filters = parseQuery(c, filterSchema);
  const [trends, taskTypes] = await Promise.all([
    getTrends(c.env, { ...filters, skill: filters.skill ?? null, testType: filters.testType ?? null }, user.id),
    getTaskTypePerformance(c.env, { ...filters, skill: filters.skill ?? null, testType: filters.testType ?? null }, user.id),
  ]);
  return c.json({ trends, taskTypes });
});

export default router;
