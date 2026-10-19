import { describe, expect, it } from 'vitest';
import type { Env } from '../../src/worker/env';
import type { AuthUser } from '../../src/worker/lib/auth-types';
import { createOcrImport } from '../../src/worker/services/import-service';

const admin = { id: 'usr_test', role: 'ADMIN' } as AuthUser;

describe('createOcrImport validation', () => {
  it('rejects an empty page list before touching the database or the model', async () => {
    await expect(createOcrImport({} as Env, admin, { pages: [] })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('rejects formats the vision path cannot read', async () => {
    await expect(
      createOcrImport({} as Env, admin, {
        pages: [{ bytes: new Uint8Array([1, 2, 3]), mime: 'image/gif', filename: 'scan.gif' }],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('rejects more than eight pages', async () => {
    const page = { bytes: new Uint8Array([1, 2, 3]), mime: 'image/png', filename: 'p.png' };
    await expect(
      createOcrImport({} as Env, admin, { pages: Array.from({ length: 9 }, () => page) }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});
