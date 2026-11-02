import {pruneTeacherTasks,pruneTeacherNotes} from './services/teacher-data-controls';
import type { Env, ImportQueueMessage } from './env';
import { createApp } from './app';
import { pruneRateLimits } from './lib/rate-limit';
import {sendWorksheetReminders} from './services/worksheet-reminder-service';
import { sendAssignmentReminders } from './services/assignment-reminder-service';
import { runWeeklyDigests } from './services/digest-service';
import { runImportStage } from './services/import-service';

const app = createApp();

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      return app.fetch(request, env, ctx);
    }
    // Static asset requests are served by the Workers assets layer
    // (`run_worker_first` only covers /api/*), this is a safety net.
    return env.ASSETS.fetch(request);
  },

  async queue(batch: MessageBatch<ImportQueueMessage>, env: Env, _ctx: ExecutionContext): Promise<void> {
    for (const message of batch.messages) {
      try {
        await runImportStage(env, message.body);
        message.ack();
      } catch (error) {
        console.error('import_stage_failed', message.body.importId, (error as Error).message);
        message.retry({ delaySeconds: 15 });
      }
    }
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        await pruneRateLimits(env);
        await pruneTeacherTasks(env,new Date(controller.scheduledTime)).catch(error=>console.error('teacher_retention_failed',(error as Error).message));
        await pruneTeacherNotes(env,new Date(controller.scheduledTime)).catch(error=>console.error('teacher_note_retention_failed',(error as Error).message));
        await sendAssignmentReminders(env,new Date(controller.scheduledTime)).catch((error)=>console.error('assignment_reminders_failed',(error as Error).message));
        await sendWorksheetReminders(env,new Date(controller.scheduledTime)).catch((error)=>console.error('worksheet_reminders_failed',(error as Error).message));
        // Monday 08:00 Vietnam time (01:00 UTC): the weekly recap email.
        if (!controller.cron || controller.cron === '0 1 * * 1') {
          await runWeeklyDigests(env).catch((error) => console.error('digest_failed', (error as Error).message));
        }
        await env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(new Date().toISOString()).run();
        await env.DB.prepare(
          `DELETE FROM login_attempts WHERE created_at < ?`,
        )
          .bind(new Date(Date.now() - 30 * 86_400_000).toISOString())
          .run();
      })(),
    );
  },
};
