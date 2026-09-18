import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react';
import { QUESTION_TYPE_META } from '@shared/question-types';
import type { CandidateQuestion, CandidateQuestionGroup, SharedOption } from '@shared/question-types';
import type { CandidateResponse } from '@shared/answer-key';
import { Button } from '../ui';

export interface QuestionRendererProps {
  group: CandidateQuestionGroup;
  question: CandidateQuestion;
  response: CandidateResponse | null;
  flagged: boolean;
  active: boolean;
  onAnswer: (questionId: string, response: CandidateResponse | null) => void;
  onToggleFlag: (questionId: string) => void;
  onFocusQuestion: (questionId: string) => void;
  /** Manual-review mode (result view): disables editing and marks correctness. */
  readOnly?: boolean;
  correctness?: { isCorrect: boolean | null; correctAnswer: string | null; candidateAnswer: CandidateResponse | null };
}

export function QuestionRenderer({
  group,
  question,
  response,
  flagged,
  active,
  onAnswer,
  onToggleFlag,
  onFocusQuestion,
  readOnly,
  correctness,
}: QuestionRendererProps) {
  const control = QUESTION_TYPE_META[group.type]?.control ?? 'TEXT';

  const answered =
    response !== null &&
    (('value' in response && String(response.value ?? '').trim().length > 0) ||
      ('values' in response && response.values.some((value) => String(value ?? '').trim().length > 0)));

  const classes = [
    'question',
    active ? 'question--active' : '',
    flagged ? 'question--flagged' : '',
    answered ? 'question--answered' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes} id={`q-${question.number}`} onFocus={() => onFocusQuestion(question.id)}>
      <div className="question__number" aria-hidden="true">
        {question.number}
      </div>
      <div className="question__content">
        <div className="question__prompt">{renderPrompt(question, group)}</div>
        <div className="question__controls">
          {control === 'TFNG' || control === 'YNN' ? (
            <ChoiceControl
              options={(control === 'TFNG'
                ? [
                    { id: 'TRUE', text: 'TRUE' },
                    { id: 'FALSE', text: 'FALSE' },
                    { id: 'NOT_GIVEN', text: 'NOT GIVEN' },
                  ]
                : [
                    { id: 'YES', text: 'YES' },
                    { id: 'NO', text: 'NO' },
                    { id: 'NOT_GIVEN', text: 'NOT GIVEN' },
                  ]) as SharedOption[]}
              selected={asValues(response)}
              onSelect={(value) => onAnswer(question.id, { value })}
              readOnly={readOnly}
              name={`q-${question.id}`}
            />
          ) : null}

          {control === 'RADIO' ? (
            <ChoiceControl
              options={question.options}
              selected={asValues(response)}
              onSelect={(value) => onAnswer(question.id, { value })}
              readOnly={readOnly}
              name={`q-${question.id}`}
            />
          ) : null}

          {control === 'CHECKBOX' ? (
            <MultiSelectControl
              options={question.options}
              selected={asValues(response)}
              selectCount={question.config.selectCount ?? question.options.length}
              onChange={(values) => onAnswer(question.id, values.length > 0 ? { values } : null)}
              readOnly={readOnly}
            />
          ) : null}

          {control === 'MATCH_SELECT' ? (
            <MatchControl
              options={group.sharedOptions}
              selected={asValues(response)[0] ?? ''}
              onSelect={(value) => onAnswer(question.id, value ? { value } : null)}
              readOnly={readOnly}
            />
          ) : null}

          {control === 'TEXT' ? (
            <TextControl
              value={asValues(response)[0] ?? ''}
              onChange={(value) => onAnswer(question.id, value.trim() ? { value } : null)}
              readOnly={readOnly}
              ariaLabel={`Answer for question ${question.number}`}
              correctness={correctness}
            />
          ) : null}

          {control === 'ESSAY' ? (
            <p className="small muted">This task is answered in the Writing editor.</p>
          ) : null}

          {!readOnly ? (
            <button
              type="button"
              className={`question__flag ${flagged ? 'question__flag--on' : ''}`}
              onClick={() => onToggleFlag(question.id)}
              aria-pressed={flagged}
            >
              {flagged ? '★ Flagged for review' : '☆ Flag for review'}
            </button>
          ) : null}

          {readOnly && correctness ? (
            <div className="row" style={{ gap: 12 }}>
              <span
                className={`badge ${correctness.isCorrect ? 'badge--success' : 'badge--danger'}`}
              >
                {correctness.isCorrect === null ? 'Not marked' : correctness.isCorrect ? 'Correct' : 'Incorrect'}
              </span>
              {correctness.correctAnswer ? (
                <span className="small muted">
                  Accepted answer: <strong>{correctness.correctAnswer}</strong>
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function renderPrompt(question: CandidateQuestion, group: CandidateQuestionGroup) {
  if (question.body?.kind === 'SUMMARY' && question.body.text) {
    return <InlineSummary text={question.body.text} questionNumber={question.number} />;
  }
  if (question.body?.kind === 'NOTES' && question.body.text) {
    return <InlineSummary text={question.body.text} questionNumber={question.number} prefixOnly />;
  }
  if (question.body?.kind === 'TABLE' && question.body.rows) {
    return (
      <table className="data" style={{ marginBottom: 8 }}>
        <tbody>
          {question.body.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  void group;
  return <p>{question.prompt}</p>;
}

/**
 * Renders completion text with `[[12]]` placeholders. The placeholder for this
 * question is replaced by an inline answer box; other placeholders stay visible
 * as their numbers so the layout matches the source.
 */
function InlineSummary({ text, questionNumber, prefixOnly }: { text: string; questionNumber: number; prefixOnly?: boolean }) {
  if (prefixOnly) return <p style={{ whiteSpace: 'pre-wrap' }}>{text}</p>;
  const parts = text.split(/(\[\[\d+\]\])/g);
  return (
    <p style={{ whiteSpace: 'pre-wrap' }}>
      {parts.map((part, index) => {
        const match = part.match(/^\[\[(\d+)\]\]$/);
        if (!match) return <span key={index}>{part}</span>;
        const number = Number(match[1]);
        if (number === questionNumber) {
          return (
            <span key={index} className="inline-box">
              <span className="inline-box__label">{number}</span>
              <span className="muted tiny">↳ answer box below</span>
            </span>
          );
        }
        return (
          <span key={index} className="muted">
            {number}
          </span>
        );
      })}
    </p>
  );
}

function asValues(response: CandidateResponse | null): string[] {
  if (!response) return [];
  if ('values' in response) return response.values;
  if ('value' in response) return [response.value];
  return [];
}

function ChoiceControl({
  options,
  selected,
  onSelect,
  readOnly,
  name,
}: {
  options: SharedOption[];
  selected: string[];
  onSelect: (value: string) => void;
  readOnly?: boolean;
  name: string;
}) {
  return (
    <div role="radiogroup">
      {options.map((option) => {
        const isSelected = selected.includes(option.id);
        return (
          <label key={option.id} className={`option-row ${isSelected ? 'option-row--selected' : ''}`}>
            <input
              type="radio"
              name={name}
              value={option.id}
              checked={isSelected}
              disabled={readOnly}
              onChange={() => onSelect(option.id)}
            />
            <span>
              <strong style={{ marginRight: 6 }}>{option.id}</strong>
              {option.text}
            </span>
          </label>
        );
      })}
    </div>
  );
}

function MultiSelectControl({
  options,
  selected,
  selectCount,
  onChange,
  readOnly,
}: {
  options: SharedOption[];
  selected: string[];
  selectCount: number;
  onChange: (values: string[]) => void;
  readOnly?: boolean;
}) {
  const toggle = (id: string) => {
    if (selected.includes(id)) {
      onChange(selected.filter((value) => value !== id));
      return;
    }
    if (selected.length >= selectCount) {
      // Replace the oldest selection instead of silently ignoring the click.
      onChange([...selected.slice(1), id]);
      return;
    }
    onChange([...selected, id]);
  };

  return (
    <div>
      <div className="tiny muted" style={{ marginBottom: 4 }}>
        Select exactly {selectCount}. Chosen: {selected.length}/{selectCount}
      </div>
      {options.map((option) => {
        const isSelected = selected.includes(option.id);
        return (
          <label key={option.id} className={`option-row ${isSelected ? 'option-row--selected' : ''}`}>
            <input type="checkbox" checked={isSelected} disabled={readOnly} onChange={() => toggle(option.id)} />
            <span>
              <strong style={{ marginRight: 6 }}>{option.id}</strong>
              {option.text}
            </span>
          </label>
        );
      })}
    </div>
  );
}

function MatchControl({
  options,
  selected,
  onSelect,
  readOnly,
}: {
  options: SharedOption[];
  selected: string;
  onSelect: (value: string) => void;
  readOnly?: boolean;
}) {
  const generatedId = useId();
  const listId = `match-${generatedId.replace(/[^a-zA-Z0-9-]/g, '')}`;
  return (
    <div className="row" style={{ gap: 8, alignItems: 'center' }}>
      <select
        aria-label="Select an option"
        value={selected}
        disabled={readOnly}
        onChange={(event) => onSelect(event.target.value)}
        style={{ maxWidth: 320 }}
      >
        <option value="">Choose…</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.id} — {option.text.slice(0, 90)}
          </option>
        ))}
      </select>
      <span className="tiny muted" id={listId}>
        {options.length} options
      </span>
    </div>
  );
}

function TextControl({
  value,
  onChange,
  readOnly,
  ariaLabel,
  correctness,
}: {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  ariaLabel: string;
  correctness?: { isCorrect: boolean | null };
}) {
  const ref = useRef<HTMLInputElement>(null);

  // Keep the cursor stable while the parent re-renders on autosave.
  useEffect(() => {
    if (ref.current && ref.current.value !== value) ref.current.value = value;
  }, [value]);

  const handle = useCallback((next: string) => onChange(next), [onChange]);

  const className =
    correctness && correctness.isCorrect !== null
      ? `answer-input ${correctness.isCorrect ? 'answer-input--correct' : 'answer-input--wrong'}`
      : 'answer-input';

  return (
    <input
      ref={ref}
      type="text"
      className={className}
      aria-label={ariaLabel}
      defaultValue={value}
      readOnly={readOnly}
      disabled={readOnly}
      autoComplete="off"
      spellCheck={false}
      onChange={(event) => handle(event.target.value)}
    />
  );
}

/** Bottom navigation strip (answered / flagged / current). */
export function QuestionNavStrip({
  numbers,
  answeredNumbers,
  flaggedNumbers,
  currentNumber,
  onSelect,
  extra,
}: {
  numbers: number[];
  answeredNumbers: Set<number>;
  flaggedNumbers: Set<number>;
  currentNumber: number | null;
  onSelect: (number: number) => void;
  extra?: ReactNode;
}) {
  return (
    <div className="exam-footer">
      <div className="nav-strip" role="list" aria-label="Question navigation">
        {numbers.map((number) => (
          <button
            key={number}
            type="button"
            role="listitem"
            className={[
              'nav-strip__item',
              answeredNumbers.has(number) ? 'nav-strip__item--answered' : '',
              flaggedNumbers.has(number) ? 'nav-strip__item--flagged' : '',
              currentNumber === number ? 'nav-strip__item--current' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={() => onSelect(number)}
            aria-label={`Question ${number}${answeredNumbers.has(number) ? ', answered' : ', unanswered'}${
              flaggedNumbers.has(number) ? ', flagged' : ''
            }`}
          >
            {number}
          </button>
        ))}
      </div>
      {extra}
    </div>
  );
}

export function QuestionGroupHeader({
  group,
  onJump,
}: {
  group: CandidateQuestionGroup;
  onJump?: () => void;
}) {
  return (
    <div className="question-group__head">
      <div className="row row--between">
        <span className="question-group__type">{typeLabel(group.type)}</span>
        {group.rangeFrom && group.rangeTo ? (
          <button type="button" className="btn btn--sm btn--ghost" onClick={onJump}>
            Questions {group.rangeFrom}–{group.rangeTo}
          </button>
        ) : null}
      </div>
      <p className="question-group__instructions">{group.instructions}</p>
    </div>
  );
}

export function GroupOptionBank({ options, numbering }: { options: SharedOption[]; numbering?: string }) {
  if (options.length === 0) return null;
  return (
    <div className="question-group__options">
      <div className="tiny muted" style={{ marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {numbering === 'roman' ? 'List of headings' : 'Options'}
      </div>
      {options.map((option) => (
        <div className="question-group__option" key={option.id}>
          <span className="question-group__option-id">{option.id}</span>
          <span>{option.text}</span>
        </div>
      ))}
    </div>
  );
}

function typeLabel(type: string): string {
  return type
    .toLowerCase()
    .split('_')
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(' ');
}

export function CompletionHelpers({ maxWords }: { maxWords?: number }) {
  if (!maxWords) return null;
  return (
    <p className="tiny muted">
      Word limit: no more than {maxWords} word{maxWords === 1 ? '' : 's'}.
    </p>
  );
}

export function UnansweredWarning({
  count,
  onConfirm,
  onCancel,
}: {
  count: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="stack">
      <p>
        You still have <strong>{count}</strong> unanswered question{count === 1 ? '' : 's'}. Unanswered questions score
        zero and answers cannot be changed after submission.
      </p>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <Button onClick={onCancel}>Keep working</Button>
        <Button variant="primary" onClick={onConfirm}>
          Submit anyway
        </Button>
      </div>
    </div>
  );
}
