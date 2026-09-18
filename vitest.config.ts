import { defineConfig, type Plugin } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * The Worker inlines `runtime-schema.sql` as a string via the esbuild `Text`
 * rule in wrangler.jsonc. This mirrors that behaviour under Vitest so the unit
 * tests can assert against the exact text the Worker ships.
 */
function sqlAsText(): Plugin {
  return {
    name: 'sql-as-text',
    transform(code, id) {
      if (!id.endsWith('.sql')) return null;
      return { code: `export default ${JSON.stringify(code)};`, map: null };
    },
  };
}

export default defineConfig({
  plugins: [sqlAsText()],
  resolve: {
    alias: {
      '@shared': r('./src/shared'),
      '@worker': r('./src/worker'),
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    reporters: ['default'],
  },
});
