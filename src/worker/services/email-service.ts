/**
 * Transactional email.
 *
 * Every message is written to `email_outbox` before any network call, which
 * gives us three things for free:
 *
 *   1. the flow works with no provider configured (status QUEUED, preview in
 *      the admin email log and the dev console),
 *   2. production sends are auditable (SENT / FAILED with the provider error),
 *   3. a retry can simply re-send rows that are still QUEUED.
 *
 * The provider is Resend (https://resend.com) because it needs one HTTPS call
 * and no SDK. Set `RESEND_API_KEY` + `EMAIL_FROM` to turn delivery on.
 */
import type { Env } from '../env';
import { newId, nowIso } from '../lib/ids';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface EmailResult {
  id: string;
  status: 'QUEUED' | 'SENT' | 'FAILED' | 'SKIPPED';
  delivered: boolean;
  error?: string;
}

/** Absolute URL in the public app, honouring the configured base URL. */
export function appUrl(env: Env, path: string): string {
  const base = (env.APP_BASE_URL || '').replace(/\/+$/, '');
  if (base) return `${base}${path.startsWith('/') ? path : `/${path}`}`;
  return path;
}

/** Minimal HTML layout shared by every transactional message. */
export function emailLayout(options: { heading: string; body: string; cta?: { label: string; href: string }; footnote?: string }): string {
  const cta = options.cta
    ? `<p style="margin:28px 0"><a href="${escapeHtml(options.cta.href)}" style="display:inline-block;padding:13px 22px;border-radius:12px;background:#5b4bdb;color:#ffffff;font-weight:600;text-decoration:none">${escapeHtml(options.cta.label)}</a></p>
       <p style="color:#6b6b7b;font-size:13px;word-break:break-all">Hoặc mở liên kết này: ${escapeHtml(options.cta.href)}</p>`
    : '';
  return `<!doctype html>
<html><body style="margin:0;padding:32px 16px;background:#f4f2fb;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#242031">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;margin:0 auto">
    <tr><td style="background:#ffffff;border-radius:18px;padding:32px;border:1px solid #e7e3f4">
      <p style="margin:0 0 6px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#7767e0;font-weight:700">AI Eo · IELTS</p>
      <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3">${escapeHtml(options.heading)}</h1>
      <div style="font-size:15px;line-height:1.65;color:#3a3548">${options.body}</div>
      ${cta}
      <p style="margin:28px 0 0;padding-top:18px;border-top:1px solid #eee9fa;font-size:12px;line-height:1.6;color:#8a8699">
        ${escapeHtml(options.footnote ?? 'Nếu bạn không yêu cầu email này, hãy bỏ qua nó — tài khoản vẫn an toàn.')}
      </p>
    </td></tr>
  </table>
</body></html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Sends (or queues) one message. Never throws: a failed email must not fail the
 * request that triggered it — the outbox row keeps the error.
 */
export async function sendEmail(env: Env, message: EmailMessage): Promise<EmailResult> {
  const id = newId('mail', 16);
  const createdAt = nowIso();
  await env.DB.prepare(
    `INSERT INTO email_outbox (id, to_email, subject, html, text, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'QUEUED', ?)`,
  )
    .bind(id, message.to, message.subject, message.html, message.text ?? null, createdAt)
    .run();

  const apiKey = env.RESEND_API_KEY;
  const from = env.EMAIL_FROM;
  if (!apiKey || !from) {
    // Development (and self-hosted installs without a provider): the message is
    // stored and logged so the link can be copied out of the terminal.
    console.info('email_queued', id, message.to, message.subject);
    return { id, status: 'QUEUED', delivered: false };
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        ...(message.text ? { text: message.text } : {}),
        ...(env.EMAIL_REPLY_TO ? { reply_to: env.EMAIL_REPLY_TO } : {}),
      }),
    });

    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 500);
      await markEmail(env, id, 'FAILED', 'resend', detail || `HTTP ${response.status}`);
      console.error('email_failed', id, response.status, detail);
      return { id, status: 'FAILED', delivered: false, error: detail || `HTTP ${response.status}` };
    }

    await markEmail(env, id, 'SENT', 'resend');
    return { id, status: 'SENT', delivered: true };
  } catch (error) {
    const messageText = (error as Error).message;
    await markEmail(env, id, 'FAILED', 'resend', messageText);
    console.error('email_failed', id, messageText);
    return { id, status: 'FAILED', delivered: false, error: messageText };
  }
}

async function markEmail(
  env: Env,
  id: string,
  status: 'SENT' | 'FAILED',
  provider: string,
  error?: string,
): Promise<void> {
  await env.DB.prepare(
    'UPDATE email_outbox SET status = ?, provider = ?, error = ?, sent_at = ? WHERE id = ?',
  )
    .bind(status, provider, error ?? null, nowIso(), id)
    .run();
}

// ------------------------------------------------------------------ templates

export function magicLinkEmail(env: Env, token: string): EmailMessage & { url: string } {
  const url = appUrl(env, `/auth/magic?token=${encodeURIComponent(token)}`);
  return {
    to: '',
    subject: 'Đăng nhập AI Eo bằng liên kết này',
    url,
    html: emailLayout({
      heading: 'Đăng nhập bằng một cú nhấp',
      body: '<p>Liên kết này đăng nhập vào tài khoản AI Eo của bạn và hết hạn sau <b>15 phút</b>. Nó chỉ dùng được một lần.</p>',
      cta: { label: 'Đăng nhập ngay', href: url },
      footnote: 'Nếu bạn không yêu cầu liên kết này, hãy bỏ qua email. Không ai đăng nhập được nếu không có liên kết.',
    }),
    text: `Đăng nhập AI Eo: ${url} (hết hạn sau 15 phút, dùng một lần)`,
  };
}

export function passwordResetEmail(env: Env, token: string): EmailMessage & { url: string } {
  const url = appUrl(env, `/reset-password?token=${encodeURIComponent(token)}`);
  return {
    to: '',
    subject: 'Đặt lại mật khẩu AI Eo',
    url,
    html: emailLayout({
      heading: 'Đặt lại mật khẩu',
      body: '<p>Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn. Liên kết có hiệu lực <b>30 phút</b> và chỉ dùng một lần.</p><p>Sau khi đổi mật khẩu, mọi phiên đăng nhập khác sẽ bị đăng xuất.</p>',
      cta: { label: 'Đặt mật khẩu mới', href: url },
      footnote: 'Nếu bạn không yêu cầu, hãy bỏ qua email — mật khẩu hiện tại vẫn giữ nguyên.',
    }),
    text: `Đặt lại mật khẩu AI Eo: ${url} (hết hạn sau 30 phút)`,
  };
}

export function loginOtpEmail(env: Env, code: string): EmailMessage {
  return {
    to: '',
    subject: `Mã đăng nhập AI Eo: ${code}`,
    html: emailLayout({
      heading: 'Mã đăng nhập của bạn',
      body: `<p>Nhập mã này để đăng nhập. Mã hết hạn sau <b>10 phút</b>.</p>
        <p style="margin:22px 0;font-size:34px;letter-spacing:.28em;font-weight:700;color:#241f38">${escapeHtml(code)}</p>`,
      footnote: 'Không chia sẻ mã này với bất kỳ ai, kể cả người tự nhận là hỗ trợ viên.',
    }),
    text: `Mã đăng nhập AI Eo: ${code} (hết hạn sau 10 phút)`,
  };
}

export function notificationEmail(env: Env, title: string, body: string, href?: string | null): EmailMessage & { url?: string } {
  const url = href ? appUrl(env, href) : undefined;
  return {
    to: '',
    subject: title,
    url,
    html: emailLayout({
      heading: title,
      body: `<p>${escapeHtml(body)}</p>`,
      ...(url ? { cta: { label: 'Mở AI Eo', href: url } } : {}),
    }),
    text: url ? `${title}\n\n${body}\n\n${url}` : `${title}\n\n${body}`,
  };
}

/** Monday recap: what moved this week and what is next. */
export function digestEmail(
  env: Env,
  digest: {
    name: string;
    attempts: number;
    band: number | null;
    previousBand: number | null;
    skills: Array<{ skill: string; count: number; averageBand: number | null }>;
    sessionsAttended: number;
    upcomingSessions: Array<{ title: string; startsAt: string }>;
    streakDays: number;
  },
  url: string,
): EmailMessage {
  const delta =
    digest.band !== null && digest.previousBand !== null
      ? Math.round((digest.band - digest.previousBand) * 10) / 10
      : null;
  const deltaLine =
    delta === null
      ? ''
      : `<p style="margin:8px 0 0;color:${delta >= 0 ? '#1f7a4d' : '#a33a2c'};font-weight:600">${delta >= 0 ? '+' : ''}${delta.toFixed(1)} band so với tuần trước</p>`;
  const skills = digest.skills
    .filter((row) => row.averageBand !== null)
    .map(
      (row) =>
        `<tr><td style="padding:6px 0;color:#5a5568">${escapeHtml(row.skill)}</td><td style="padding:6px 0;text-align:right;font-weight:600">${row.averageBand!.toFixed(1)}</td><td style="padding:6px 0;text-align:right;color:#8b8698">${row.count} bài</td></tr>`,
    )
    .join('');
  const next = digest.upcomingSessions.length
    ? `<p style="margin:18px 0 6px"><b>Sắp tới</b></p><ul style="margin:0;padding-left:18px;color:#5a5568">${digest.upcomingSessions
        .map(
          (session) =>
            `<li>${escapeHtml(session.title)} — ${escapeHtml(new Date(session.startsAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }))}</li>`,
        )
        .join('')}</ul>`
    : '';
  return {
    to: '',
    subject: digest.band !== null ? `Tuần này của ${digest.name}: band ${digest.band.toFixed(1)}` : `Tổng kết tuần của ${digest.name}`,
    html: emailLayout({
      heading: `Tuần này của bạn${digest.band !== null ? ` — band ${digest.band.toFixed(1)}` : ''}`,
      body: `<p>Chào ${escapeHtml(digest.name)},</p>
        <p>Bạn đã luyện <b>${digest.attempts}</b> phần thi trong tuần qua${digest.sessionsAttended ? `, tham gia <b>${digest.sessionsAttended}</b> buổi học trực tiếp` : ''}. Chuỗi học hiện tại: <b>${digest.streakDays} ngày</b>.</p>
        ${deltaLine}
        ${skills ? `<p style="margin:20px 0 6px"><b>Band theo kỹ năng</b></p><table role="presentation" width="100%" style="font-size:14px">${skills}</table>` : ''}
        ${next}
        <p style="margin:22px 0 0">Một tuần mới là một cơ hội mới. Bắt đầu với 15 phút hôm nay nhé.</p>`,
      cta: { label: 'Xem tiến bộ của tôi', href: url },
      footnote: 'Bạn nhận email này vì đã học trên AI Eo trong tuần qua.',
    }),
    text: `Tổng kết tuần AI Eo của ${digest.name}: ${digest.attempts} phần thi${digest.band !== null ? `, band ${digest.band.toFixed(1)}` : ''}, chuỗi ${digest.streakDays} ngày. Xem chi tiết: ${url}`,
  };
}
