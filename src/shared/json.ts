/**
 * JSON helpers used by both the Worker (import paste) and the admin UI.
 *
 * Pasted import payloads frequently arrive with a second document, a markdown
 * fence, or trailing commentary after the first object. `JSON.parse` then fails
 * with "Unexpected non-whitespace character after JSON". These helpers take the
 * first complete value and ignore the rest.
 */

export interface LeadingJsonResult {
  value: unknown;
  /** True when characters remain after the first complete JSON value. */
  trailing: boolean;
  /** Slice of the original text that was parsed. */
  source: string;
}

/**
 * Parse a JSON document, or the first complete value if extra text follows.
 * Returns null when the string does not start with a JSON object/array.
 */
export function parseLeadingJson(text: string): LeadingJsonResult | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;

  try {
    return { value: JSON.parse(trimmed) as unknown, trailing: false, source: trimmed };
  } catch {
    const extracted = extractFirstJsonValue(trimmed);
    if (!extracted) return null;
    return extracted;
  }
}

/** Extract the first complete `{…}` or `[…]` value, honouring strings. */
export function extractFirstJsonValue(text: string): LeadingJsonResult | null {
  const start = text.search(/[[{]/);
  if (start < 0) return null;

  const stack: string[] = [];
  let inString = false;
  let escape = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index]!;
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (char === '\\') {
        escape = true;
        continue;
      }
      if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{' || char === '[') {
      stack.push(char);
      continue;
    }
    if (char === '}' || char === ']') {
      const open = stack.pop();
      if (!open) return null;
      if ((char === '}' && open !== '{') || (char === ']' && open !== '[')) return null;
      if (stack.length === 0) {
        const source = text.slice(start, index + 1);
        try {
          const rest = text.slice(index + 1).trim();
          return {
            value: JSON.parse(source) as unknown,
            trailing: rest.length > 0,
            source,
          };
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
