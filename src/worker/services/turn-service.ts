import type { Env } from '../env';
import type { AuthUser } from '../lib/auth-types';
import { assertSessionAccess, getSession } from './mentor-service';

/** Short-lived coturn TURN REST credentials; the shared secret stays on the Worker. */
export async function turnConfig(env: Env, viewer: AuthUser, sessionId: string) {
  const session = await getSession(env, sessionId);
  await assertSessionAccess(env, session, viewer);
  const urls = (env.TURN_URLS ?? '').split(',').map((url) => url.trim()).filter((url) => /^turns?:[^\s]+$/i.test(url));
  if (!urls.length || !env.TURN_SHARED_SECRET) return { iceServers: [], configured: false };
  const username = `${Math.floor(Date.now() / 1000) + 86400}:${viewer.id}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.TURN_SHARED_SECRET), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(username)));
  const credential = btoa(String.fromCharCode(...signature));
  return { iceServers: [{ urls, username, credential }], configured: true };
}
