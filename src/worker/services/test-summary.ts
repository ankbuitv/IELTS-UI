import type { Env } from '../env';
import { completeJson } from '../ai/providers';

/**
 * Structural minimum of the import content that a summary needs. Kept local so
 * this module does not care which service's richer `EditableContent` is passed
 * in — both the import pipeline and the editor satisfy it.
 */
interface SummarySection {
  skill: string;
  groups: Array<{ questions: unknown[] }>;
}
interface SummaryContent {
  sections?: SummarySection[];
}

/**
 * A practice-test description that is actually about the test.
 *
 * Imported tests used to carry "Imported from <file>.json" as their summary,
 * which told a learner nothing and looked like a bug. A summary is built in two
 * passes instead:
 *
 *   1. a deterministic one derived from the parsed content — which skills are
 *      present, how many sections and questions each holds — so there is always
 *      a true description even with no AI provider;
 *   2. an optional AI polish that rewrites the facts into a sentence or two a
 *      human would write. It only ever receives the derived facts, never the
 *      filename, and if it fails the derived text stands.
 */

const SKILL_LABEL: Record<string, string> = {
  READING: 'Reading',
  LISTENING: 'Listening',
  WRITING: 'Writing',
  SPEAKING: 'Speaking',
};

const TYPE_LABEL: Record<string, string> = {
  READING: 'Reading',
  LISTENING: 'Listening',
  WRITING: 'Writing',
  SPEAKING: 'Speaking',
  FULL_MOCK: 'full mock',
};

function questionCount(section: SummarySection): number {
  return section.groups.reduce((total, group) => total + group.questions.length, 0);
}

/** The deterministic, always-available description. */
export function deriveTestSummary(title: string, type: string, content: SummaryContent): string {
  const sections = content.sections ?? [];
  const totalQuestions = sections.reduce((total, section) => total + questionCount(section), 0);

  const perSkill = new Map<string, { sections: number; questions: number }>();
  for (const section of sections) {
    const skill = SKILL_LABEL[section.skill] ?? section.skill;
    const entry = perSkill.get(skill) ?? { sections: 0, questions: 0 };
    entry.sections += 1;
    entry.questions += questionCount(section);
    perSkill.set(skill, entry);
  }

  const kind = TYPE_LABEL[type] ?? type;
  const skills = [...perSkill.entries()].map(([skill, entry]) => `${skill} (${entry.questions})`);

  const parts: string[] = [];
  parts.push(`${title} is a ${kind} practice test.`);
  if (sections.length > 0) {
    parts.push(`It has ${sections.length} section${sections.length === 1 ? '' : 's'} and ${totalQuestions} questions.`);
  }
  if (skills.length > 0) parts.push(`Skills: ${skills.join(', ')}.`);
  parts.push('Timed and marked the same way as the real exam screen.');
  return parts.join(' ');
}

/**
 * The description to store: AI-polished when a provider can rewrite the facts,
 * otherwise the derived facts. Neither mentions the source file.
 */
export async function buildTestSummary(env: Env, title: string, type: string, content: SummaryContent): Promise<string> {
  const derived = deriveTestSummary(title, type, content);
  try {
    const { data } = await completeJson<{ summary?: string }>(env, {
      messages: [
        {
          role: 'system',
          content:
            'You write short, factual listing descriptions for IELTS-style practice tests. ' +
            'Use only the facts given. Never mention files, imports or JSON. ' +
            'Return {"summary": "..."} with one or two sentences in English.',
        },
        { role: 'user', content: `Facts: ${derived}\nTitle: ${title}` },
      ],
      maxTokens: 220,
      timeoutMs: 20_000,
      reasoningEffort: 'low',
    });
    const summary = typeof data?.summary === 'string' ? data.summary.trim() : '';
    if (summary && summary.length >= 20 && summary.length <= 400) return summary;
    return derived;
  } catch {
    // No provider, or it misbehaved: the derived facts are still true.
    return derived;
  }
}
