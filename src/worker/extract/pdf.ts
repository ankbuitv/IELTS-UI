import { inflateSync } from 'fflate';

/**
 * Best-effort PDF text-layer extraction.
 *
 * This is deliberately dependency-light (runs inside a Worker): it inflates
 * FlateDecode content streams and reconstructs text from Tj/TJ/'/" operators.
 * PDFs that contain only scanned images have no text layer; those must be
 * uploaded as images (OCR/vision path) instead. The admin import UI states this
 * explicitly and the result reports `hasTextLayer` so nothing is silently lost.
 */
export interface PdfExtractionResult {
  text: string;
  pageCount: number;
  hasTextLayer: boolean;
}

export function extractPdfText(bytes: Uint8Array): PdfExtractionResult {
  const latin = bytesToLatin1(bytes);
  const pageCount = Math.max(1, (latin.match(/\/Type\s*\/Page[^s]/g) ?? []).length);

  const streams = collectContentStreams(latin, bytes);
  const chunks: string[] = [];

  for (const stream of streams) {
    chunks.push(textFromContentStream(stream));
  }

  const text = normaliseWhitespace(chunks.join('\n\n'));
  return {
    text,
    pageCount,
    hasTextLayer: text.replace(/\s+/g, '').length > 40,
  };
}

function bytesToLatin1(bytes: Uint8Array): string {
  let out = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)) as number[]);
  }
  return out;
}

/** Finds `stream ... endstream` blocks, inflating FlateDecode ones. */
function collectContentStreams(latin: string, bytes: Uint8Array): string[] {
  const results: string[] = [];
  const streamRegex = /stream\r?\n?/g;
  let match: RegExpExecArray | null;

  while ((match = streamRegex.exec(latin)) !== null) {
    const start = match.index + match[0].length;
    const end = latin.indexOf('endstream', start);
    if (end === -1) break;

    const raw = bytes.subarray(start, end);
    const dictionaryStart = latin.lastIndexOf('<<', match.index);
    const dictionary = dictionaryStart >= 0 ? latin.slice(dictionaryStart, match.index) : '';

    if (/FlateDecode/.test(dictionary)) {
      try {
        const inflated = inflateSync(raw);
        const decoded = new TextDecoder('latin1').decode(inflated);
        if (/(Tj|TJ|Td|TD|BT)/.test(decoded)) results.push(decoded);
      } catch {
        // Not a content stream, or uses an unsupported filter.
      }
    } else if (/(Tj|TJ|BT)/.test(latin.slice(start, Math.min(end, start + 4000)))) {
      results.push(new TextDecoder('latin1').decode(raw));
    }
    streamRegex.lastIndex = end;
  }

  return results;
}

/** Reconstructs readable text from a PDF content stream. */
function textFromContentStream(stream: string): string {
  const lines: string[] = [];
  let current = '';

  const tokens = stream.match(/\((?:\\\\.|[^\\()])*\)|\[[^\]]*\]|Tj|TJ|T\*|Td|TD|ET|BT|'|"/g) ?? [];

  for (const token of tokens) {
    if (token.startsWith('(')) {
      current += decodePdfString(token.slice(1, -1));
      continue;
    }
    if (token.startsWith('[')) {
      const parts = token.match(/\((?:\\\\.|[^\\()])*\)|-?\d+(\.\d+)?/g) ?? [];
      let line = '';
      for (const part of parts) {
        if (part.startsWith('(')) line += decodePdfString(part.slice(1, -1));
        else if (Number(part) < -180) line += ' ';
      }
      current += line;
      continue;
    }
    if (token === 'Tj' || token === "'" || token === '"') {
      lines.push(current);
      current = '';
      continue;
    }
    if (token === 'T*' || token === 'Td' || token === 'TD' || token === 'ET') {
      if (current.trim()) lines.push(current);
      current = '';
    }
  }
  if (current.trim()) lines.push(current);

  return lines.join('\n');
}

function decodePdfString(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i]!;
    if (char !== '\\') {
      out += char;
      continue;
    }
    const next = value[i + 1];
    switch (next) {
      case 'n': out += '\n'; i += 1; break;
      case 'r': out += '\r'; i += 1; break;
      case 't': out += '\t'; i += 1; break;
      case 'b': i += 1; break;
      case 'f': i += 1; break;
      case '(': out += '('; i += 1; break;
      case ')': out += ')'; i += 1; break;
      case '\\': out += '\\'; i += 1; break;
      default: {
        const octal = value.slice(i + 1, i + 4).match(/^[0-7]{1,3}/);
        if (octal) {
          out += String.fromCharCode(parseInt(octal[0], 8));
          i += octal[0].length;
        }
      }
    }
  }
  // Map common Windows-1252 quotes/dashes to Unicode.
  return out
    .replace(/\u0091|\u0092/g, "'")
    .replace(/\u0093|\u0094/g, '"')
    .replace(/\u0096|\u0097/g, '—')
    .replace(/\u0085/g, '…');
}

function normaliseWhitespace(input: string): string {
  return input
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
