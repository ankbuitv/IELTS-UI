import { Hono } from 'hono';
import { z } from 'zod';
import type { AppBindings } from '../env';
import { currentUser, requireAuth } from '../middleware/auth';
import { assertCsrf, assertSameOrigin } from '../lib/http';
import { parseBody } from '../lib/validate';
import { ApiError } from '../lib/errors';
import { validateLogo } from '../services/school-service';
import { nowIso } from '../lib/ids';

const router = new Hono<AppBindings>();
router.use('*', requireAuth, async (c,next) => { assertSameOrigin(c); if (c.req.method !== 'GET') assertCsrf(c,c.get('session')?.csrfToken ?? null); await next(); });
router.use('/:type/:id', async (c,next) => {
  if (!['teacher','mentor'].includes(c.req.param('type'))) throw ApiError.notFound();
  const user=currentUser(c), id=c.req.param('id');
  const teacher=c.req.param('type')==='teacher';
  const klass=await c.env.DB.prepare(teacher?'SELECT teacher_id AS owner FROM classrooms WHERE id=?':'SELECT mentor_id AS owner FROM mentor_classes WHERE id=?').bind(id).first<{owner:string}>();
  if (!klass) throw ApiError.notFound('Không tìm thấy lớp.');
  const owner=klass.owner===user.id || user.role==='ADMIN';
  if (c.req.method !== 'GET' && !owner) throw ApiError.forbidden('Chỉ chủ lớp hoặc quản trị viên được thay logo.');
  if (c.req.method === 'GET' && teacher && !owner) {
    const member=await c.env.DB.prepare("SELECT 1 AS ok FROM classroom_members WHERE classroom_id=? AND user_id=? AND status='ACTIVE'").bind(id,user.id).first();
    const schoolOwner=await c.env.DB.prepare(`SELECT 1 AS ok FROM classroom_call_rooms r JOIN school_call_brand b ON b.session_id=r.session_id JOIN schools s ON s.id=b.school_id JOIN school_members sm ON sm.school_id=s.id AND sm.user_id=b.selected_by AND sm.status='ACTIVE' WHERE r.classroom_id=? AND s.owner_user_id=? AND s.status='APPROVED'`).bind(id,user.id).first();
    if (!member && !(schoolOwner && ['TEACHER','MENTOR'].includes(user.role))) throw ApiError.forbidden();
  }
  await next();
});
router.get('/:type/:id',async c=>{
  const row=await c.env.DB.prepare('SELECT mime,data_b64 FROM class_logos WHERE class_type=? AND class_id=?').bind(c.req.param('type').toUpperCase(),c.req.param('id')).first();
  c.header('Cache-Control','private, no-store'); return c.json({logo:row});
});
router.post('/:type/:id',async c=>{
  const body=await parseBody(c,z.object({mime:z.enum(['image/png','image/jpeg','image/webp']),base64:z.string().min(1).max(140000)}));
  validateLogo(body.mime,body.base64);
  await c.env.DB.prepare(`INSERT INTO class_logos(class_type,class_id,mime,data_b64,updated_at) VALUES(?,?,?,?,?)
    ON CONFLICT(class_type,class_id) DO UPDATE SET mime=excluded.mime,data_b64=excluded.data_b64,updated_at=excluded.updated_at`)
    .bind(c.req.param('type').toUpperCase(),c.req.param('id'),body.mime,body.base64,nowIso()).run();
  return c.json({ok:true});
});
router.delete('/:type/:id',async c=>{
  await c.env.DB.prepare('DELETE FROM class_logos WHERE class_type=? AND class_id=?').bind(c.req.param('type').toUpperCase(),c.req.param('id')).run();
  return c.json({ok:true});
});
export default router;
