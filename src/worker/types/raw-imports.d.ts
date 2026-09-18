/**
 * Text-file imports.
 *
 * The Worker ships the generated runtime schema as a string: Workers have no
 * filesystem, so runtime-schema.sql is inlined at build time by the esbuild
 * Text rule declared under `rules` in wrangler.jsonc.
 */
declare module '*.sql' {
  const content: string;
  export default content;
}
