import { unzipSync } from 'fflate';
import { extractPdfText } from './pdf';

export interface ExtractionResult {
  text: string;
  kind: 'PDF' | 'DOCX' | 'TEXT' | 'UNSUPPORTED';
  pageCount?: number;
  hasTextLayer?: boolean;
  warning?: string;
}

export const ALLOWED_IMPORT_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'image/png',
  'image/jpeg',
  'image/webp',
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'audio/x-wav',
  'audio/webm',
  'audio/ogg',
];

export function kindForMime(mime: string, filename: string): 'PDF' | 'DOC' | 'IMAGE' | 'AUDIO' | 'OTHER' {
  const lower = filename.toLowerCase();
  if (mime === 'application/pdf' || lower.endsWith('.pdf')) return 'PDF';
  if (
    mime.includes('wordprocessingml') ||
    mime === 'application/msword' ||
    lower.endsWith('.docx') ||
    lower.endsWith('.doc')
  ) {
    return 'DOC';
  }
  if (mime.startsWith('image/')) return 'IMAGE';
  if (mime.startsWith('audio/')) return 'AUDIO';
  return 'OTHER';
}

export function extractText(bytes: Uint8Array, mime: string, filename: string): ExtractionResult {
  const lower = filename.toLowerCase();

  if (mime === 'application/pdf' || lower.endsWith('.pdf')) {
    const result = extractPdfText(bytes);
    return {
      text: result.text,
      kind: 'PDF',
      pageCount: result.pageCount,
      hasTextLayer: result.hasTextLayer,
      ...(result.hasTextLayer
        ? {}
        : {
            warning:
              'This PDF has no extractable text layer (it is probably a scan). Upload page images to use the vision path, or paste the text manually.',
          }),
    };
  }

  if (mime.includes('wordprocessingml') || lower.endsWith('.docx')) {
    try {
      const text = extractDocxText(bytes);
      return { text, kind: 'DOCX' };
    } catch (error) {
      return {
        text: '',
        kind: 'DOCX',
        warning: `Could not read the DOCX package: ${(error as Error).message}`,
      };
    }
  }

  if (mime.startsWith('audio/')) {
    return {
      text: '',
      kind: 'UNSUPPORTED',
      warning:
        'Audio cannot be converted to text locally. Attach the audio to the Listening section; AI transcription runs only when an OpenAI key is configured.',
    };
  }

  if (mime.startsWith('image/')) {
    return {
      text: '',
      kind: 'UNSUPPORTED',
      warning:
        'Images are processed by the AI vision path when an OpenAI key is configured; otherwise attach them manually as assets.',
    };
  }

  if (
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    ['.txt', '.md', '.csv', '.json', '.text'].some((extension) => lower.endsWith(extension))
  ) {
    return { text: new TextDecoder('utf-8').decode(bytes), kind: 'TEXT' };
  }

  return {
    text: '',
    kind: 'UNSUPPORTED',
    warning: `Unsupported import type: ${mime || 'unknown'}. Supported: PDF (with a text layer), DOCX, plain text, images and audio.`,
  };
}

/** WordprocessingML reader: paragraphs, list markers and simple tables. */
export function extractDocxText(bytes: Uint8Array): string {
  const files = unzipSync(bytes);
  const document = files['word/document.xml'];
  if (!document) throw new Error('word/document.xml is missing from the archive');

  const xml = new TextDecoder('utf-8').decode(document);
  const blocks: string[] = [];

  // Tables first (they carry note/table completion tasks), then paragraphs.
  const bodyRegex = /<w:(p|tbl)\b[\s\S]*?<\/w:\1>/g;
  const matches = xml.match(bodyRegex) ?? [];

  for (const block of matches) {
    if (block.startsWith('<w:tbl')) {
      const rows = block.match(/<w:tr\b[\s\S]*?<\/w:tr>/g) ?? [];
      const rendered = rows
        .map((row) => {
          const cells = row.match(/<w:tc\b[\s\S]*?<\/w:tc>/g) ?? [];
          return cells.map((cell) => textOfRuns(cell)).join(' | ');
        })
        .filter((row) => row.trim().length > 0);
      if (rendered.length > 0) blocks.push(rendered.join('\n'));
      continue;
    }
    const text = textOfRuns(block);
    if (text.trim().length > 0) blocks.push(text);
    else blocks.push('');
  }

  const text = blocks.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (text.length < 20) throw new Error('The document contains no readable text');
  return text;
}

function textOfRuns(xml: string): string {
  const runs = xml.match(/<w:t\b[^>]*>[\s\S]*?<\/w:t>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>/g) ?? [];
  return runs
    .map((run) => {
      if (run.startsWith('<w:tab')) return '\t';
      if (run.startsWith('<w:br')) return '\n';
      const inner = run.replace(/^<w:t\b[^>]*>/, '').replace(/<\/w:t>$/, '');
      return decodeXmlEntities(inner);
    })
    .join('');
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
