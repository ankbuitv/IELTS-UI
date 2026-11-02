import {Hono} from 'hono';import type {AppBindings} from '../env';import {clientIp} from '../lib/http';import {enforceRateLimit} from '../lib/rate-limit';import {readCalendarSubscription} from '../services/teacher-calendar-subscription';
const router=new Hono<AppBindings>();
router.get('/:token',async c=>{await enforceRateLimit(c.env,{bucket:`calendar-feed:${clientIp(c)}`,windowSeconds:60,limit:60},'Too many requests.');const calendar=await readCalendarSubscription(c.env,c.req.param('token').replace(/\.ics$/,''));return new Response(calendar,{headers:{'Content-Type':'text/calendar; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});});
export default router;
