/** Strips any `x-frame-options` rule from a `_headers` file body. */
export function stripFramingHeader(contents: string): string;

/** Applies {@link stripFramingHeader} to a file on disk; true when it changed. */
export function stripFramingHeaderFile(
  path: string,
  fs: { readFileSync: (path: string, encoding: string) => string; writeFileSync: (path: string, data: string) => void; existsSync: (path: string) => boolean },
): boolean;
