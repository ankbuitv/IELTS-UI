import type { CandidateSection } from '@shared/question-types';

export function PassagePane({
  sections,
  activeSectionId,
  showInstructions,
}: {
  sections: CandidateSection[];
  activeSectionId?: string | null;
  showInstructions?: boolean;
}) {
  const withPassages = sections.filter((section) => section.passage);
  if (withPassages.length === 0) {
    return (
      <div className="exam-pane__scroll">
        <p className="muted">
          This part does not include a reading passage. Use the questions on the right; the audio and instructions for
          each part are shown above the questions.
        </p>
      </div>
    );
  }

  return (
    <div className="exam-pane__scroll">
      {withPassages.map((section) => (
        <article key={section.id} id={`passage-${section.id}`} style={{ marginBottom: 40 }}>
          <div className="row row--between" style={{ marginBottom: 6 }}>
            <h2 style={{ margin: 0 }}>{section.passage!.title || section.title}</h2>
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
                <span className="passage__text">{paragraph.text}</span>
              </div>
            ))}
          </div>
          {activeSectionId === section.id ? <span className="tiny muted">Currently answering questions from this passage.</span> : null}
        </article>
      ))}
    </div>
  );
}
