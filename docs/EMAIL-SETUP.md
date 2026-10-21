# Email setup — magic links, password reset, codes and booking mail

The platform sends four kinds of transactional email:

| Email | Trigger |
|---|---|
| Sign-in link (magic link) | "Email me a sign-in link" on the login page |
| One-time sign-in code | "Sign in with a one-time code instead" |
| Password reset link | `/reset-password` → "Email me a reset link" |
| Booking notifications | New request, confirmation, cancellation (to the other party) |

## How delivery works

Every message is written to the `email_outbox` table **before** any network call.

- **No provider configured** → status `QUEUED`. The message is not delivered, but the
  link/code is stored and visible to admins under **Admin → Settings → Announcements →
  Email delivery** (subject, recipient, status). In development the OTP code is also
  returned by the API (`devCode`) so flows stay testable.
- **Provider configured** → status `SENT`, or `FAILED` with the provider's error.

This means the product works out of the box; email simply stays queued until you
connect a provider.

## Connect Resend (recommended, ~5 minutes)

1. Create an account at <https://resend.com> and add your sending domain
   (**Domains → Add Domain**), then add the DNS records it shows (SPF + DKIM).
   Wait for **Verified**.
2. **API Keys → Create API Key** → permission *Sending access* → copy the key
   (`re_…`).
3. Choose the From address on the verified domain, e.g.
   `AI Eo <no-reply@ielts.ankb.qzz.io>`.
4. Store the secrets on the Worker:

```bash
npx wrangler secret put RESEND_API_KEY     # re_…
npx wrangler secret put EMAIL_FROM         # AI Eo <no-reply@your-domain>
# optional
npx wrangler secret put EMAIL_REPLY_TO     # support@your-domain
```

For local development, put the same names in `.dev.vars`.

Secrets apply immediately to the deployed Worker — no redeploy needed.

> Any provider works: `sendEmail()` in `src/worker/services/email-service.ts` is the
> single place that talks to Resend. Swap the `fetch` for SES/Postmark/Mailgun and
> keep the outbox contract.

## Test the flows

1. Sign in page → **Email me a sign-in link instead** → enter your email.
2. Open the link in the email (or copy it from the outbox when no provider is set).
   The link signs you in once within 15 minutes.
3. `/reset-password` → request a link → set a new password. All other sessions are
   signed out and the old password stops working.

## Security notes

- Links store only a SHA-256 hash of the token; the plaintext exists in the email only.
- One use, short TTL (15 min sign-in, 30 min reset), and issuing a new link invalidates
  the previous unused one.
- Requests are rate limited per IP and per account, and always answer `{ sent: true }`
  so the API cannot be used to discover which addresses have accounts.
- A magic link still asks for the authenticator code when 2FA is enabled. Backup codes
  (generated when 2FA is turned on, shown once) work at that step too.
- The outbox stores the rendered HTML (which contains the link) — treat the table like
  any other credential store and prune it from time to time.
