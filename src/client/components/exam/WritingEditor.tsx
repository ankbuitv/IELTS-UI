import { useMemo, useState } from 'react';
import type { CandidateQuestion, CandidateSection } from '@shared/question-types';
import { countWords } from '../../lib/format';
import { SectionImage } from './SectionImage';

/** A Writing task together with the section (part) it belongs to. */
export interface WritingTaskRef {
  task: CandidateQuestion;
  section: CandidateSection;
}

export function writingTasksOf(sections: CandidateSection[]): WritingTaskRef[] {
  return sections.flatMap((section) => section.writingTasks.map((task) => ({ task, section })));
}

export function writingTaskLabel(item: WritingTaskRef): string {
  return String(item.task.config.note ?? (item.task.number ? `Task ${item.task.number}` : 'Task'));
}

/**
 * The left half of a Writing part: what the candidate is asked to do (and the
 * chart, map or diagram it refers to), kept in view while they write.
 */
export function WritingPrompt({ item }: { item: WritingTaskRef }) {
  const { task, section } = item;
  const minimum = minimumWords(section);
  return (
    <div className="writing-prompt">
      <div className="writing-prompt__head">
        <span className="writing-prompt__task">{section.title || writingTaskLabel(item)}</span>
        {minimum ? <span className="badge badge--neutral">min {minimum} words</span> : null}
      </div>
      {section.instructions || task.prompt ? (
        <p className="writing-prompt__text">{section.instructions || task.prompt}</p>
      ) : null}
      {section.instructions && task.prompt ? <p className="writing-prompt__text writing-prompt__text--strong">{task.prompt}</p> : null}
      {section.image ? (
        <div className="writing-prompt__figure">
          <SectionImage image={section.image} label={section.label || section.title || 'Writing task'} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * The right half: one tab per task when a part has several, a word counter with
 * a progress bar towards the minimum, and a text box that fills the pane.
 */
export function WritingAnswer({
  tasks,
  activeTaskId,
  onPickTask,
  answers,
  onSave,
  readOnly,
}: {
  tasks: WritingTaskRef[];
  activeTaskId: string | null;
  onPickTask: (taskId: string) => void;
  answers: Array<{ questionId: string; text: string; wordCount: number }>;
  onSave: (questionId: string, text: string) => void;
  readOnly?: boolean;
}) {
  const active = useMemo(
    () => tasks.find((item) => item.task.id === activeTaskId) ?? tasks[0] ?? null,
    [tasks, activeTaskId],
  );
  if (!active) return <p className="muted">This part has no Writing tasks.</p>;

  const stored = answers.find((item) => item.questionId === active.task.id)?.text ?? '';
  return (
    <div className="writing-answer">
      {tasks.length > 1 ? (
        <div className="writing-answer__tabs" role="tablist" aria-label="Writing tasks">
          {tasks.map((item) => (
            <button
              key={item.task.id}
              type="button"
              role="tab"
              aria-selected={item.task.id === active.task.id}
              className={`writing-answer__tab ${item.task.id === active.task.id ? 'is-active' : ''}`}
              onClick={() => onPickTask(item.task.id)}
            >
              {writingTaskLabel(item)}
            </button>
          ))}
        </div>
      ) : null}
      <WritingTask
        key={active.task.id}
        initialText={stored}
        minimumWords={minimumWords(active.section)}
        onChange={(text) => onSave(active.task.id, text)}
        readOnly={readOnly}
      />
    </div>
  );
}

/**
 * The text box owns what the candidate types. It adopts the stored text only
 * when it mounts (the task is part of its key): re-adopting it on every change
 * of the stored value is what used to throw typed text back to an older save
 * whenever a poll answered during typing.
 */
function WritingTask({
  initialText,
  minimumWords,
  onChange,
  readOnly,
}: {
  initialText: string;
  minimumWords: number | null;
  onChange: (text: string) => void;
  readOnly?: boolean;
}) {
  const [text, setText] = useState(initialText);
  const words = countWords(text);
  const ratio = minimumWords ? Math.min(1, words / minimumWords) : 1;
  const meetsMinimum = minimumWords === null || words >= minimumWords;

  return (
    <>
      <div className="writing-answer__meta">
        <span className="writing-answer__count">
          <strong>{words}</strong> word{words === 1 ? '' : 's'}
          {minimumWords ? <span className="muted"> / {minimumWords}</span> : null}
        </span>
        {minimumWords ? (
          <span
            className={`writing-answer__meter ${meetsMinimum ? 'is-met' : ''}`}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={minimumWords}
            aria-valuenow={Math.min(words, minimumWords)}
            aria-label="Progress towards the minimum length"
          >
            <span style={{ width: `${Math.round(ratio * 100)}%` }} />
          </span>
        ) : null}
      </div>
      <textarea
        className="writing-answer__box"
        aria-label="Your written response"
        value={text}
        readOnly={readOnly}
        disabled={readOnly}
        spellCheck
        placeholder="Type your answer here. It is saved automatically."
        onChange={(event) => {
          setText(event.target.value);
          onChange(event.target.value);
        }}
      />
    </>
  );
}

function minimumWords(section: CandidateSection): number | null {
  const text = `${section.instructions} ${section.writingTasks.map((task) => task.prompt).join(' ')}`;
  const match = text.match(/at least\s+(\d{3})\s+words/i);
  if (match?.[1]) return Number(match[1]);
  const taskNumber = section.writingTasks[0]?.number;
  if (section.title.toLowerCase().includes('task 1')) return 150;
  if (section.title.toLowerCase().includes('task 2')) return 250;
  return taskNumber ? (taskNumber % 2 === 1 ? 150 : 250) : null;
}
