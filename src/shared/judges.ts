/**
 * The AI "judging panel" as candidates see it.
 *
 * Writing and Speaking are marked by two independent AI judges. Candidates (and
 * teachers) only ever see the anonymous labels below: which model sits behind a
 * label is configuration and never leaves the Worker (see
 * `src/worker/ai/judges.ts`). The browser bundle imports this file, so it must
 * stay free of anything that names a vendor or a model.
 */

export const JUDGE_LABELS = ['Judge01', 'Judge02'] as const;
export type JudgeLabel = (typeof JUDGE_LABELS)[number];

export interface JudgeCriterion {
  key: string;
  label: string;
  /** null = "not assessed" (for example pronunciation from a transcript). */
  band: number | null;
  comment: string;
}

export interface JudgeCorrection {
  original: string;
  suggestion: string;
  reason: string;
  /**
   * False when the original is grammatically acceptable and the suggestion is
   * only a stylistic alternative. Such items are shown as "Suggestions", never
   * as grammar errors, so learners are not taught a rule that does not exist.
   * Absent (older scores) is treated as a genuine error.
   */
  isActualError?: boolean;
  /** GRAMMAR | VOCABULARY | STYLE | PUNCTUATION | SPELLING (best effort). */
  category?: string;
  /** 0..1 self-reported confidence; low-confidence items read as suggestions. */
  confidence?: number;
}

/** A word the judge suggests learning, pitched at the candidate's own level. */
export interface JudgeVocabulary {
  term: string;
  pos: string;
  meaning: string;
  meaningVi: string;
  example: string;
}

/** What ONE judge said about ONE response. */
export interface JudgeOpinion {
  judge: JudgeLabel;
  band: number | null;
  criteria: JudgeCriterion[];
  feedback: string;
  /** A one- or two-sentence summary in Vietnamese ('' when the judge gave none). */
  feedbackVi: string;
  strengths: string[];
  improvements: string[];
  corrections: JudgeCorrection[];
  notes: string[];
}

/** The panel's combined verdict, as stored and returned by the API. */
export interface AiMarkView {
  /** DONE = every judge answered, PARTIAL = at least one judge was unavailable. */
  status: 'DONE' | 'PARTIAL';
  /** Mean of the judges' bands, rounded to the nearest half band. */
  band: number | null;
  /** Per-criterion mean of the judges' bands. */
  criteria: JudgeCriterion[];
  feedback: string;
  feedbackVi: string;
  strengths: string[];
  improvements: string[];
  corrections: JudgeCorrection[];
  notes: string[];
  judges: JudgeOpinion[];
  /** Highest minus lowest judge band (null with fewer than two bands). */
  spread: number | null;
  /**
   * Set when the judges split by a band or more and a third examiner settled the
   * final band. `band` above is then the adjudicated band, not the plain mean.
   */
  adjudication?: { band: number | null; rationale: string } | null;
  /** Judges that could not answer, by label. */
  unavailable: JudgeLabel[];
  createdAt: string;
}

/** Judges whose bands differ by this much or more are flagged as "split". */
export const JUDGE_SPLIT_THRESHOLD = 1;

export function judgesAgree(view: Pick<AiMarkView, 'spread'>): boolean {
  return view.spread === null || view.spread < JUDGE_SPLIT_THRESHOLD;
}
