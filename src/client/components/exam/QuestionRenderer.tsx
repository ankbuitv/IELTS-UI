import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react';
import { QUESTION_TYPE_META } from '@shared/question-types';
import type { CandidateQuestion, CandidateQuestionGroup, SharedOption } from '@shared/question-types';
import type { CandidateResponse } from '@shared/answer-key';
import { Button } from '../ui';
import { Icon } from '../Icon';

/**
 * The True/False/Not Given and Yes/No/Not Given choices.
 *
 * They are defined once here rather than inline in the control: the label is a
 * display string, never the stored value, so the internal `NOT_GIVEN` token can
 * not leak into the interface and the option text is never printed twice.
 */
const TFNG_OPTIONS: SharedOption[] = [
  { id: 'TRUE', text: 'TRUE' },
  { id: 'FALSE', text: 'FALSE' },
  { id: 'NOT_GIVEN', text: 'NOT GIVEN' },
];

const YNN_OPTIONS: SharedOption[] = [
  { id: 'YES', text: 'YES' },
  { id: 'NO', text: 'NO' },
  { id: 'NOT_GIVEN', text: 'NOT GIVEN' },
];

/**
 * Display label for a stored choice value (`NOT_GIVEN` → `NOT GIVEN`). Used
 * when a value has to be shown somewhere other than the option list itself,
 * such as the released result view.
 */
export function choiceLabel(value: string): string {
  return value.replace(/_/g, ' ').trim();
}

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

  // Completion tasks carry their own text with `[[n]]` placeholders. When the
  // placeholder for *this* question is present, the answer box belongs inside
  // that text (the layout every published exam paper uses) instead of below it.
  const inlineBodyKind = question.body?.kind;
  const inlineText = question.body?.text ?? '';
  const hasInlineBody =
    (inlineBodyKind === 'SUMMARY' || inlineBodyKind === 'NOTES') && inlineText.includes(`[[${question.number}]]`);
  const hasInlineTable =
    question.body?.kind === 'TABLE' && (question.body.rows ?? []).some((row) => row.some((cell) => cell.includes(`[[${question.number}]]`)));
  const answerInsideText = hasInlineBody || hasInlineTable;

  const answerControl =
    control === 'TEXT' ? (
      <TextControl
        value={asValues(response)[0] ?? ''}
        onChange={(value) => onAnswer(question.id, value.trim() ? { value } : null)}
        readOnly={readOnly}
        ariaLabel={`Answer for question ${question.number}`}
        correctness={correctness}
        inline={answerInsideText}
      />
    ) : null;

  return (
    <div className={classes} id={`q-${question.number}`} onFocus={() => onFocusQuestion(question.id)}>
      {answerInsideText ? null : (
        <div className="question__number" aria-hidden="true">
          {question.number}
        </div>
      )}
      <div className="question__content">
        <div className="question__prompt">
          {renderPrompt(question, group, answerInsideText ? answerControl : null)}
        </div>
        <div className="question__controls">
          {control === 'TFNG' || control === 'YNN' ? (
            <ChoiceControl
              options={control === 'TFNG' ? TFNG_OPTIONS : YNN_OPTIONS}
              selected={asValues(response)}
              onSelect={(value) => onAnswer(question.id, { value })}
              readOnly={readOnly}
              name={`q-${question.id}`}
              variant="pills"
            />
          ) : null}

          {control === 'RADIO' ? (
            <ChoiceControl
              options={question.options}
              selected={asValues(response)}
              onSelect={(value) => onAnswer(question.id, { value })}
              readOnly={readOnly}
              name={`q-${question.id}`}
              variant="list"
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

          {control === 'TEXT' && !answerInsideText ? answerControl : null}

          {control === 'ESSAY' ? (
            <EssayControl
              value={asValues(response)[0] ?? ''}
              onChange={(value) => onAnswer(question.id, value.trim() ? { value } : null)}
              readOnly={readOnly}
              ariaLabel={`Writing response for question ${question.number}`}
            />
          ) : null}

          {!readOnly ? (
            <button
              type="button"
              className={`question__flag ${flagged ? 'question__flag--on' : ''}`}
              onClick={() => onToggleFlag(question.id)}
              aria-pressed={flagged}
            >
              <Icon name="flag" size={14} />
              {flagged ? 'Flagged for review' : 'Flag for review'}
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
                  Accepted answer: <strong>{choiceLabel(correctness.correctAnswer)}</strong>
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function renderPrompt(question: CandidateQuestion, group: CandidateQuestionGroup, inlineAnswer: ReactNode) {
  if (question.body?.kind === 'SUMMARY' && question.body.text) {
    return <InlineBody text={question.body.text} questionNumber={question.number} inlineAnswer={inlineAnswer} />;
  }
  if (question.body?.kind === 'NOTES' && question.body.text) {
    return question.body.text.includes(`[[${question.number}]]`) ? (
      <InlineBody text={question.body.text} questionNumber={question.number} inlineAnswer={inlineAnswer} />
    ) : (
      <p style={{ whiteSpace: 'pre-wrap' }}>{question.body.text}</p>
    );
  }
  if (question.body?.kind === 'TABLE' && question.body.rows) {
    return (
      <div className="table-wrap" style={{ marginBottom: 8 }}>
        <table className="data question-table">
          <tbody>
            {question.body.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}>
                    <InlineText text={cell} questionNumber={question.number} inlineAnswer={inlineAnswer} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  void group;
  return <p>{question.prompt}</p>;
}

/**
 * Renders completion text with `[[12]]` placeholders.
 *
 * The placeholder for this question becomes the answer box itself, with its
 * number beside it; every other placeholder stays visible as a muted number so
 * the running order of the paper is preserved.
 */
function InlineBody({
  text,
  questionNumber,
  inlineAnswer,
}: {
  text: string;
  questionNumber: number;
  inlineAnswer: ReactNode;
}) {
  return (
    <p className="q-body">
      <InlineText text={text} questionNumber={questionNumber} inlineAnswer={inlineAnswer} />
    </p>
  );
}

function InlineText({
  text,
  questionNumber,
  inlineAnswer,
}: {
  text: string;
  questionNumber: number;
  inlineAnswer: ReactNode;
}) {
  const parts = text.split(/(\[\[\d+\]\])/g);
  return (
    <>
      {parts.map((part, index) => {
        const match = part.match(/^\[\[(\d+)\]\]$/);
        if (!match) return <span key={index}>{part}</span>;
        const number = Number(match[1]);
        if (number === questionNumber && inlineAnswer) {
          return (
            <span key={index} className="q-inline">
              <span className="q-inline__number" aria-hidden="true">
                {number}
              </span>
              {inlineAnswer}
            </span>
          );
        }
        return (
          <span key={index} className="q-inline__ghost" aria-label={`Question ${number}`}>
            {number}
          </span>
        );
      })}
    </>
  );
}

function asValues(response: CandidateResponse | null): string[] {
  if (!response) return [];
  if ('values' in response) return response.values;
  if ('value' in response) return [response.value];
  return [];
}

/**
 * Single-choice control.
 *
 * `variant="pills"` is used by True/False/Not Given and Yes/No/Not Given: three
 * short, fixed choices that read as a segmented control, with the display label
 * taken from the option text only (a stored value such as `NOT_GIVEN` is never
 * printed). `variant="list"` is the multiple-choice layout, where the option
 * letter sits in its own badge beside the option text.
 */
function ChoiceControl({
  options,
  selected,
  onSelect,
  readOnly,
  name,
  variant = 'list',
}: {
  options: SharedOption[];
  selected: string[];
  onSelect: (value: string) => void;
  readOnly?: boolean;
  name: string;
  variant?: 'pills' | 'list';
}) {
  if (variant === 'pills') {
    return (
      <div className="choice-pills" role="radiogroup">
        {options.map((option) => {
          const isSelected = selected.includes(option.id);
          return (
            <label
              key={option.id}
              className={`choice-pill ${isSelected ? 'choice-pill--on' : ''} ${readOnly ? 'choice-pill--readonly' : ''}`}
            >
              <input
                type="radio"
                name={name}
                value={option.id}
                checked={isSelected}
                disabled={readOnly}
                onChange={() => onSelect(option.id)}
              />
              <span>{choiceLabel(option.text || option.id)}</span>
            </label>
          );
        })}
      </div>
    );
  }

  return (
    <div className="option-list" role="radiogroup">
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
            <span className="option-row__id" aria-hidden="true">
              {option.id}
            </span>
            <span className="option-row__text">{option.text}</span>
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
      <div className="tiny muted" style={{ marginBottom: 6 }}>
        Select exactly {selectCount}. Chosen: {selected.length}/{selectCount}
      </div>
      <div className="option-list">
        {options.map((option) => {
          const isSelected = selected.includes(option.id);
          return (
            <label key={option.id} className={`option-row ${isSelected ? 'option-row--selected' : ''}`}>
              <input type="checkbox" checked={isSelected} disabled={readOnly} onChange={() => toggle(option.id)} />
              <span className="option-row__id" aria-hidden="true">
                {option.id}
              </span>
              <span className="option-row__text">{option.text}</span>
            </label>
          );
        })}
      </div>
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
  inline,
}: {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  ariaLabel: string;
  correctness?: { isCorrect: boolean | null };
  /** Rendered inside completion text, where the box grows with the answer. */
  inline?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);

  // Keep the cursor stable while the parent re-renders on autosave.
  useEffect(() => {
    if (ref.current && ref.current.value !== value) ref.current.value = value;
  }, [value]);

  const handle = useCallback((next: string) => onChange(next), [onChange]);

  const className = [
    'answer-input',
    inline ? 'answer-input--inline' : '',
    correctness && correctness.isCorrect !== null
      ? correctness.isCorrect
        ? 'answer-input--correct'
        : 'answer-input--wrong'
      : '',
  ]
    .filter(Boolean)
    .join(' ');

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
      style={inline ? { width: `${Math.max(9, (value?.length ?? 0) + 3)}ch` } : undefined}
      onChange={(event) => handle(event.target.value)}
    />
  );
}

function EssayControl({
  value,
  onChange,
  readOnly,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  ariaLabel: string;
}) {
  return (
    <textarea
      aria-label={ariaLabel}
      value={value}
      readOnly={readOnly}
      disabled={readOnly}
      rows={12}
      placeholder="Type your answer here. Your work is saved automatically."
      style={{ width: '100%', minHeight: 220, resize: 'vertical' }}
      onChange={(event) => onChange(event.target.value)}
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
      <span className="nav-strip__legend" aria-hidden="true">
        <span>
          <span className="nav-strip__item" style={{ display: 'inline-grid', width: 20, height: 20, marginRight: 4 }}>1</span>
          unanswered
        </span>
        <span>
          <span
            className="nav-strip__item nav-strip__item--answered"
            style={{ display: 'inline-grid', width: 20, height: 20, marginRight: 4 }}
          >
            2
          </span>
          answered
        </span>
        <span>
          <span
            className="nav-strip__item nav-strip__item--flagged"
            style={{ display: 'inline-grid', width: 20, height: 20, marginRight: 4 }}
          >
            3
          </span>
          flagged
        </span>
      </span>
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

/**
 * The instruction banner that opens every question group.
 *
 * It states the question range and the requirement in one line, the way a
 * printed paper does ("Questions 1–5 · Do the following statements agree…"), and
 * doubles as the jump target for the group.
 */
export function QuestionGroupHeader({
  group,
  onJump,
}: {
  group: CandidateQuestionGroup;
  onJump?: () => void;
}) {
  const range =
    group.rangeFrom && group.rangeTo
      ? group.rangeFrom === group.rangeTo
        ? `Question ${group.rangeFrom}`
        : `Questions ${group.rangeFrom}–${group.rangeTo}`
      : null;

  return (
    <div className="q-banner">
      <span className="q-banner__badge" aria-hidden="true">
        <Icon name="list" size={16} />
      </span>
      <div className="q-banner__body">
        <p className="q-banner__text">
          {range ? (
            <>
              <button type="button" className="q-banner__range" onClick={onJump}>
                {range}
              </button>{' '}
            </>
          ) : null}
          <span className="q-banner__type">{typeLabel(group.type)}</span>{' '}
          {group.instructions || QUESTION_TYPE_META[group.type]?.defaultInstructions}
        </p>
      </div>
    </div>
  );
}

export function GroupOptionBank({ options, numbering }: { options: SharedOption[]; numbering?: string }) {
  if (options.length === 0) return null;
  return (
    <div className="question-group__options">
      <div className="question-group__options-title">
        {numbering === 'roman' ? 'List of headings' : 'Choose from'}
      </div>
      <div className="option-bank">
        {options.map((option) => (
          <div className="option-bank__item" key={option.id}>
            <span className="option-bank__id">{option.id}</span>
            <span>{option.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Human label for a question type, from the shared registry (single source). */
function typeLabel(type: string): string {
  const meta = QUESTION_TYPE_META[type as keyof typeof QUESTION_TYPE_META];
  if (meta?.label) return meta.label;
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
