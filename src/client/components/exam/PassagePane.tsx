import type { ReactNode } from 'react';
import type { CandidateSection } from '@shared/question-types';
import { AnnotatedText } from './Annotations';
import type { AnnotationsApi } from './useAnnotations';

export function PassagePane({
  sections,
  showInstructions,
  lead,
  annotations,
  children,
}: {
  sections: CandidateSection[];
  showInstructions?: boolean;
  /** Highlighter state; when it is passed the text becomes markable. */
  annotations?: AnnotationsApi | null;
  /** Material that sits above the passage inside the same scroll region (audio, a figure). */
  lead?: ReactNode;
  /**
   * Extra material that belongs with the source text (a listening transcript,
   * for example). It renders inside the same scroll region as the passage so
   * the pane keeps a single scrollbar.
   */
  children?: ReactNode;
}) {
  const withPassages = sections.filter((section) => section.passage);
  if (withPassages.length === 0) {
    return (
      <div className="exam-pane__scroll">
        {lead}
        {children}
      </div>
    );
  }

  return (
    <div className="exam-pane__scroll">
      {lead}
      {withPassages.map((section) => (
        <article key={section.id} id={`passage-${section.id}`} className="passage-article">
          <div className="passage-article__head">
            <h2>{section.passage!.title || section.title}</h2>
            <span className="tiny muted nowrap">{section.passage!.wordCount} words</span>
          </div>
          {section.passage!.subtitle ? <p className="muted small">{section.passage!.subtitle}</p> : null}
          {showInstructions && section.instructions ? (
            <p className="small muted" style={{ whiteSpace: 'pre-wrap' }}>
              {section.instructions}
            </p>
          ) : null}
          <div className="passage">
            {section.passage!.paragraphs.map((paragraph) => (
              <div className="passage__paragraph" key={paragraph.label || paragraph.text.slice(0, 24)}>
                <span className="passage__label">{paragraph.label}</span>
                {annotations ? (
                  <AnnotatedText
                    text={paragraph.text}
                    annotations={annotations.forParagraph(section.id, paragraph.label)}
                    sectionId={section.id}
                    anchor={paragraph.label}
                    interactive={annotations.enabled}
                  />
                ) : (
                  <span className="passage__text">{paragraph.text}</span>
                )}
              </div>
            ))}
          </div>
        </article>
      ))}
      {children}
    </div>
  );
}
