/**
 * Exam annotations: the highlighter and the note pad.
 *
 * The real computer-delivered IELTS lets a candidate mark up the reading
 * passage and keep notes. Selection is therefore *not* suppressed in exam mode
 * (copy, cut, paste, drag and the context menu still are) — it is the input for
 * this feature: selecting text on the paper stores the character range, and the
 * marks are re-applied when the attempt is reopened.
 *
 * A mark is anchored to a single paragraph (`sectionId` + `anchor`, the
 * paragraph label such as "B") by character offset into that paragraph's text.
 * That is enough to redraw it reliably because a paragraph renders as one text
 * node, and it survives a content re-version better than any DOM path would.
 */

export const ANNOTATION_COLORS = ['yellow', 'green', 'blue', 'pink'] as const;
export type AnnotationColor = (typeof ANNOTATION_COLORS)[number];

export const ANNOTATION_SCOPES = ['PASSAGE'] as const;
export type AnnotationScope = (typeof ANNOTATION_SCOPES)[number];

/** Candidate-visible label, used in the note list and the teacher's export. */
export const ANNOTATION_COLOR_LABELS: Record<AnnotationColor, string> = {
  yellow: 'Highlight',
  green: 'Key point',
  blue: 'Vocabulary',
  pink: 'Come back',
};

export interface ExamAnnotation {
  id: string;
  scope: AnnotationScope;
  sectionId: string;
  anchor: string;
  startOffset: number;
  endOffset: number;
  excerpt: string;
  color: AnnotationColor;
  note: string | null;
}

export interface ExamAnnotationInput {
  id?: string;
  scope: AnnotationScope;
  sectionId: string;
  anchor: string;
  startOffset: number;
  endOffset: number;
  excerpt: string;
  color: AnnotationColor;
  note?: string | null;
}

/** Where the same text is marked twice, the newer mark wins the colour. */
export function sortAnnotations(annotations: ExamAnnotation[]): ExamAnnotation[] {
  return [...annotations].sort((a, b) => a.startOffset - b.startOffset || a.endOffset - b.endOffset);
}

export type MarkedSegment = { text: string; marks: string[]; colors: AnnotationColor[]; annotationIds: string[] };

/**
 * Split a paragraph into runs, each carrying the marks that cover it.
 *
 * Marks are split at every boundary rather than nested, so the rendering is a
 * flat list of `<mark>` elements and overlapping highlights stay visible
 * (the colour list keeps them; the ids list drives removal).
 */
export function segmentMarkedText(text: string, annotations: ExamAnnotation[]): MarkedSegment[] {
  const boundaries = new Set<number>([0, text.length]);
  for (const annotation of annotations) {
    if (annotation.endOffset <= annotation.startOffset) continue;
    boundaries.add(Math.max(0, Math.min(text.length, annotation.startOffset)));
    boundaries.add(Math.max(0, Math.min(text.length, annotation.endOffset)));
  }
  const points = [...boundaries].sort((a, b) => a - b);

  const segments: MarkedSegment[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]!;
    const end = points[index + 1]!;
    if (end <= start) continue;
    const covering = annotations.filter((annotation) => annotation.startOffset <= start && annotation.endOffset >= end);
    segments.push({
      text: text.slice(start, end),
      marks: covering.map((annotation) => annotation.id),
      colors: covering.map((annotation) => annotation.color),
      annotationIds: covering.map((annotation) => annotation.id),
    });
  }
  return segments;
}

/** Does this selection fall entirely inside one existing mark? (Used by "remove".) */
export function markCovering(
  annotations: ExamAnnotation[],
  startOffset: number,
  endOffset: number,
): ExamAnnotation | null {
  return annotations.find((annotation) => annotation.startOffset <= startOffset && annotation.endOffset >= endOffset) ?? null;
}

/** Clamps a range to the paragraph and refuses empty or absurdly long marks. */
export function normaliseRange(
  text: string,
  startOffset: number,
  endOffset: number,
  maxChars = 600,
): { startOffset: number; endOffset: number; excerpt: string } | null {
  // A selection dragged backwards (or an inverted range from a right-to-left
  // keyboard selection) arrives as (4, 1); order it rather than losing the mark.
  const first = Math.min(startOffset, endOffset);
  const last = Math.max(startOffset, endOffset);
  const start = Math.max(0, Math.min(text.length, Math.trunc(first)));
  const end = Math.max(start, Math.min(text.length, Math.trunc(last)));
  if (end - start < 2) return null;
  const excerpt = text.slice(start, Math.min(end, start + maxChars));
  if (!excerpt.trim()) return null;
  return { startOffset: start, endOffset: start + excerpt.length, excerpt };
}
