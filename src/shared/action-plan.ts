/**
 * The weekly action plan shown on the student dashboard.
 *
 * It is deliberately rule-based: the plan is derived from the marks the learner
 * already has (weakest rubric criterion, words due, recent attempts). No model
 * is asked to invent homework, so the same week always produces the same plan
 * and nothing is fabricated when there is no data yet.
 */
export type ActionPlanSkill = 'READING' | 'LISTENING' | 'WRITING' | 'SPEAKING' | 'VOCABULARY' | 'MIXED';

export interface ActionPlanTask {
  id: string;
  title: string;
  detail: string;
  href: string;
  skill: ActionPlanSkill;
  minutes: number;
  done: boolean;
}

export interface ActionPlanFocus {
  criterion: string;
  label: string;
  skill: 'WRITING' | 'SPEAKING';
  band: number | null;
}

export interface ActionPlan {
  weekStart: string;
  tasks: ActionPlanTask[];
  focus: ActionPlanFocus | null;
  summary: string;
  generatedAt: string;
  completed: number;
  source: 'RULES';
}

/** Monday 00:00 UTC of the week that contains `date`, as `YYYY-MM-DD`. */
export function planWeekStart(date: Date): string {
  const copy = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = copy.getUTCDay();
  copy.setUTCDate(copy.getUTCDate() - (day === 0 ? 6 : day - 1));
  return copy.toISOString().slice(0, 10);
}
