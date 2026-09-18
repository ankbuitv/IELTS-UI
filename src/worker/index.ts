import type { Env, ImportQueueMessage } from './env';
import { createApp } from './app';
import { pruneRateLimits } from './lib/rate-limit';
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

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        await pruneRateLimits(env);
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
