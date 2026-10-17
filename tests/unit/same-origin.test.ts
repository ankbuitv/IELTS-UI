import { describe, expect, it } from 'vitest';
import { assertSameOrigin } from '../../src/worker/lib/http';

/** The context only needs the few fields the guard reads. */
function context(init: { method?: string; url: string; headers?: Record<string, string>; base?: string }) {
  const headers = init.headers ?? {};
  const c = {
    req: {
      method: init.method ?? 'POST',
      url: init.url,
      header: (name: string) => headers[name.toLowerCase()] ?? null,
    },
    env: { APP_BASE_URL: init.base ?? '' },
  };
  return c as unknown as Parameters<typeof assertSameOrigin>[0];
}

describe('assertSameOrigin', () => {
  it('lets reads through and demands a token-free match for writes', () => {
    expect(() =>
      assertSameOrigin(context({ method: 'GET', url: 'http://127.0.0.1:8787/x', headers: { origin: 'https://elsewhere.test' } })),
    ).not.toThrow();
  });

  it('accepts a client that contacted the host it names', () => {
    expect(() =>
      assertSameOrigin(context({ url: 'http://127.0.0.1:8787/api/auth/login', headers: { origin: 'http://127.0.0.1:8787' } })),
    ).not.toThrow();
    expect(() =>
      assertSameOrigin(context({ url: 'http://8787-sbx.e2b.app/api/x', headers: { origin: 'http://8787-sbx.e2b.app' } })),
    ).not.toThrow();
  });

  it('accepts an https origin behind a TLS-terminating proxy', () => {
    expect(() =>
      assertSameOrigin(
        context({
          url: 'http://8787-sbx.e2b.app/api/auth/login',
          headers: { origin: 'https://8787-sbx.e2b.app', host: '8787-sbx.e2b.app', 'x-forwarded-proto': 'https' },
        }),
      ),
    ).not.toThrow();
  });

  it('rejects a foreign origin, and an https claim for another host', () => {
    expect(() =>
      assertSameOrigin(
        context({
          url: 'http://8787-sbx.e2b.app/api/auth/login',
          headers: { origin: 'https://evil.test', host: '8787-sbx.e2b.app', 'x-forwarded-proto': 'https' },
        }),
      ),
    ).toThrow(/Cross-origin/);
    expect(() =>
      assertSameOrigin(
        context({
          url: 'http://8787-sbx.e2b.app/api/auth/login',
          headers: { origin: 'https://other-host.test', host: '8787-sbx.e2b.app' },
        }),
      ),
    ).toThrow(/Cross-origin/);
  });

  it('accepts the host a proxy moved into X-Forwarded-Host', () => {
    expect(() =>
      assertSameOrigin(
        context({
          url: 'http://127.0.0.1:8788/api/auth/login',
          headers: {
            origin: 'https://8787-sbx.e2b.app',
            host: '127.0.0.1:8788',
            'x-forwarded-host': '8787-sbx.e2b.app',
            'x-forwarded-proto': 'https',
          },
        }),
      ),
    ).not.toThrow();
    // A forwarded host that does not match the Origin is still rejected.
    expect(() =>
      assertSameOrigin(
        context({
          url: 'http://127.0.0.1:8788/api/auth/login',
          headers: {
            origin: 'https://evil.test',
            host: '127.0.0.1:8788',
            'x-forwarded-host': '8787-sbx.e2b.app',
            'x-forwarded-proto': 'https',
          },
        }),
      ),
    ).toThrow(/Cross-origin/);
  });

  it('accepts the configured public origin', () => {
    expect(() =>
      assertSameOrigin(
        context({
          url: 'http://127.0.0.1:8787/api/x',
          base: 'https://ielts.ankb.qzz.io',
          headers: { origin: 'https://ielts.ankb.qzz.io' },
        }),
      ),
    ).not.toThrow();
  });
});
