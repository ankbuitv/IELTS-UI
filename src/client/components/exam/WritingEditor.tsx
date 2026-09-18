import { useEffect, useMemo, useState } from 'react';
import type { CandidateSection } from '@shared/question-types';
import { Tabs } from '../ui';
import { countWords } from '../../lib/format';

export function WritingEditor({
  sections,
  answers,
  onSave,
  readOnly,
}: {
  sections: CandidateSection[];
  answers: Array<{ questionId: string; text: string; wordCount: number }>;
  onSave: (questionId: string, text: string) => void;
  readOnly?: boolean;
}) {
  const tasks = useMemo(
    () => sections.flatMap((section) => section.writingTasks.map((task) => ({ task, section }))),
    [sections],
  );
  const [selectedTaskId, setActiveTaskId] = useState<string | null>(null);
  const activeTaskId = selectedTaskId ?? tasks[0]?.task.id ?? null;

  if (tasks.length === 0) {
    return <p className="muted">This section has no Writing tasks.</p>;
  }

  const active = tasks.find((item) => item.task.id === activeTaskId) ?? tasks[0]!;
  const stored = answers.find((item) => item.questionId === active.task.id)?.text ?? '';

  return (
    <div className="writing-editor">
      {tasks.length > 1 ? (
        <Tabs
          tabs={tasks.map((item) => ({
            id: item.task.id,
            label: `${item.task.config.note ?? (item.task.number ? `Task ${item.task.number}` : 'Task')} · min ${
              minimumWords(item.section) ?? '—'
            } words`,
          }))}
          value={active.task.id}
          onChange={(id) => setActiveTaskId(id)}
        />
      ) : null}

      <div className="writing-prompt">
        <div className="writing-prompt__task">{active.section.title || 'Writing task'}</div>
        <p style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>{active.section.instructions || active.task.prompt}</p>
        {active.task.prompt ? (
          <p style={{ fontWeight: 600, whiteSpace: 'pre-wrap' }}>{active.task.prompt}</p>
        ) : null}
      </div>

      <WritingTask
        key={active.task.id}
        taskId={active.task.id}
        initialText={stored}
        minimumWords={minimumWords(active.section)}
        onChange={(text) => onSave(active.task.id, text)}
        readOnly={readOnly}
      />
    </div>
  );
}

function WritingTask({
  taskId,
  initialText,
  minimumWords,
  onChange,
  readOnly,
}: {
  taskId: string;
  initialText: string;
  minimumWords: number | null;
  onChange: (text: string) => void;
  readOnly?: boolean;
}) {
  const [text, setText] = useState(initialText);
  const words = countWords(text);
  const meetsMinimum = minimumWords === null || words >= minimumWords;

  useEffect(() => {
    setText(initialText);
  }, [taskId, initialText]);

  return (
    <>
      <div className="writing-editor__meta">
        <span>
          <strong>{words}</strong> word{words === 1 ? '' : 's'}
          {minimumWords ? ` · minimum ${minimumWords}` : ''}
        </span>
        {meetsMinimum ? (
          <span className="badge badge--success">Length requirement met</span>
        ) : (
          <span className="badge badge--warning">Below the minimum length</span>
        )}
      </div>
      <textarea
        aria-label="Your written response"
        value={text}
        readOnly={readOnly}
        disabled={readOnly}
        placeholder="Type your answer here. Your work is saved automatically."
        onChange={(event) => {
          setText(event.target.value);
          onChange(event.target.value);
        }}
      />
      <p className="tiny muted" style={{ marginTop: 8 }}>
        Do not close this page. Losing connection is recoverable: your responses are stored on the server and the timer
        continues from the server deadline.
      </p>
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
