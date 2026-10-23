import type { ReactNode } from 'react';

/**
 * The Markdown the tutor writes (and blog posts render) — headings, tables,
 * fenced code, lists, emphasis, inline code and links — built as React
 * elements rather than HTML, so untrusted text can never inject markup.
 *
 * The parser is a small line scanner: fenced blocks and tables hold their
 * rows together across single newlines (a blank line is the only paragraph
 * break), which a plain split-on-blank-lines would tear apart.
 */
type RichBlock =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'code'; lines: string[] }
  | { kind: 'table'; rows: string[][] }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'paragraph'; text: string };

const HEADING_RE = /^(#{1,4})\s+(.*)$/;
const BULLET_RE = /^\s*[-•*]\s+(.*)$/;
const ORDERED_RE = /^\s*\d+[.)]\s+(.*)$/;
const FENCE_RE = /^\s*```/;
const QUOTE_RE = /^\s*>\s?(.*)$/;
const SEPARATOR_CELL_RE = /^:?-{3,}:?$/;

const splitTableRow = (line: string): string[] =>
  line.trim().replace(/^\|/, '').replace(/\|\s*$/, '').split('|').map((cell) => cell.trim());

function parseRich(text: string): RichBlock[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: RichBlock[] = [];
  let code: string[] | null = null;
  let table: string[][] | null = null;
  let list: { ordered: boolean; items: string[] } | null = null;
  let quote: string[] | null = null;
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ kind: 'paragraph', text: paragraph.join('\n') });
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push({ kind: 'list', ordered: list.ordered, items: list.items });
    list = null;
  };
  const flushTable = () => {
    if (table) blocks.push({ kind: 'table', rows: table });
    table = null;
  };
  const flushQuote = () => {
    if (quote) blocks.push({ kind: 'quote', lines: quote });
    quote = null;
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
    flushTable();
    flushQuote();
  };

  for (const line of lines) {
    if (code) {
      if (FENCE_RE.test(line)) {
        blocks.push({ kind: 'code', lines: code });
        code = null;
      } else code.push(line);
      continue;
    }
    if (FENCE_RE.test(line)) {
      flushAll();
      code = [];
      continue;
    }
    if (/^\s*\|/.test(line)) {
      flushParagraph();
      flushList();
      const cells = splitTableRow(line);
      if (cells.every((cell) => SEPARATOR_CELL_RE.test(cell))) continue;
      (table ??= []).push(cells);
      continue;
    }
    flushTable();

    const quoteLine = QUOTE_RE.exec(line);
    if (quoteLine) {
      flushParagraph();
      flushList();
      (quote ??= []).push(quoteLine[1]!);
      continue;
    }
    flushQuote();

    const heading = HEADING_RE.exec(line);
    if (heading) {
      flushAll();
      blocks.push({ kind: 'heading', level: Math.min(heading[1]!.length, 3), text: heading[2]! });
      continue;
    }

    const bullet = BULLET_RE.exec(line);
    if (bullet) {
      flushParagraph();
      if (list && !list.ordered) list.items.push(bullet[1]!);
      else {
        flushList();
        list = { ordered: false, items: [bullet[1]!] };
      }
      continue;
    }
    const ordered = ORDERED_RE.exec(line);
    if (ordered) {
      flushParagraph();
      if (list && list.ordered) list.items.push(ordered[1]!);
      else {
        flushList();
        list = { ordered: true, items: [ordered[1]!] };
      }
      continue;
    }
    flushList();
    if (!line.trim()) flushParagraph();
    else paragraph.push(line);
  }
  if (code) blocks.push({ kind: 'code', lines: code });
  flushAll();
  return blocks;
}

/** Emphasis, `code` and links, split out of one line of plain text. */
const INLINE_RE = /(`[^`]+`|\*\*[^*\n]+\*\*|\[[^\]]+\]\([^)]+\)|\*[^*\n]+\*|_[^_\n]+_)/g;

const inline = (text: string): ReactNode[] =>
  text.split(INLINE_RE).map((part, index) => {
    if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith('**') && part.endsWith('**') && part.slice(2, -2).trim()) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (link) {
      const href = link[2]!;
      // Only real destinations: untrusted text does not get to run script.
      if (/^https?:\/\//i.test(href) || href.startsWith('/')) {
        return (
          <a key={index} href={href} target="_blank" rel="noreferrer noopener">
            {inline(link[1]!)}
          </a>
        );
      }
      return <span key={index}>{part}</span>;
    }
    if (part.length > 2 && (part[0] === '*' || part[0] === '_') && part[0] === part[part.length - 1]) {
      const inner = part.slice(1, -1);
      // "2 * 3 * 4" is arithmetic and snake_case is an identifier — italics need
      // tight delimiters, and "_" only separates words (never inside one).
      const tight = inner.trim() && !inner.startsWith(' ') && !inner.endsWith(' ');
      if (tight && (part[0] === '*' || inner.includes(' '))) return <em key={index}>{inner}</em>;
    }
    return <span key={index}>{part}</span>;
  });

/**
 * Renders Markdown as React elements — never innerHTML.
 * `chat` sizes headings for a message bubble; `article` for a full page.
 */
export function RichText({ text, variant = 'chat' }: { text: string; variant?: 'chat' | 'article' }) {
  const tags = variant === 'article' ? (['h2', 'h3', 'h4'] as const) : (['h4', 'h5', 'h6'] as const);
  return (
    <div className={variant === 'article' ? 'tutor-rich tutor-rich--article' : 'tutor-rich'}>
      {parseRich(text).map((block, index) => {
        switch (block.kind) {
          case 'heading': {
            const Tag = tags[Math.min(block.level, 3) - 1]!;
            return <Tag key={index}>{inline(block.text)}</Tag>;
          }
          case 'code':
            return (
              <pre key={index} className="tutor-rich__pre">
                <code>{block.lines.join('\n')}</code>
              </pre>
            );
          case 'table': {
            const [header = [], ...body] = block.rows;
            return (
              <div key={index} className="tutor-rich__scroll">
                <table className="tutor-rich__table">
                  <thead>
                    <tr>{header.map((cell, cellIndex) => <th key={cellIndex}>{inline(cell)}</th>)}</tr>
                  </thead>
                  <tbody>
                    {body.map((row, rowIndex) => (
                      <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{inline(cell)}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }
          case 'list':
            return block.ordered ? (
              <ol key={index}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{inline(item)}</li>)}</ol>
            ) : (
              <ul key={index}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{inline(item)}</li>)}</ul>
            );
          case 'quote':
            return <blockquote key={index} className="tutor-rich__quote">{inline(block.lines.join('\n'))}</blockquote>;
          case 'paragraph':
            return <p key={index}>{inline(block.text)}</p>;
        }
      })}
    </div>
  );
}
