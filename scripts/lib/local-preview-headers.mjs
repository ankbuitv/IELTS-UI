/**
 * Local-preview header tweak.
 *
 * `src/client/public/_headers` hardens the static bundle, including
 * `x-frame-options: SAMEORIGIN`. That header cannot vary by host, and the
 * sandbox live preview embeds the app in an iframe served from another origin
 * (`*.e2b.app`), where a `SAMEORIGIN` document is refused.
 *
 * `scripts/dev.mjs` therefore strips exactly that line from the local build
 * (`dist/client/_headers`) after `vite build` and before `wrangler dev` starts,
 * which is also why the rule is parsed fresh on every local start. Everything
 * else in the file is left untouched, and the deployed copy keeps the header
 * because nothing here runs during a deploy.
 */

const FRAMING_LINE = /^\s*x-frame-options\s*:/i;

/**
 * Returns `contents` with any `x-frame-options` rule removed.
 * @param {string} contents
 * @returns {string}
 */
export function stripFramingHeader(contents) {
  const lines = contents.split('\n');
  const kept = lines.filter((line) => !FRAMING_LINE.test(line));
  return kept.join('\n');
}

/**
 * Applies the tweak to a `_headers` file on disk.
 * @param {string} path
 * @param {{ readFileSync: Function, writeFileSync: Function, existsSync: Function }} fs
 * @returns {boolean} true when the file changed
 */
export function stripFramingHeaderFile(path, fs) {
  if (!fs.existsSync(path)) return false;
  const before = fs.readFileSync(path, 'utf8');
  const after = stripFramingHeader(before);
  if (after === before) return false;
  fs.writeFileSync(path, after);
  return true;
}
