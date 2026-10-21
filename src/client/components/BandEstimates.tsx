import { Link } from 'react-router-dom';
import { BAND_BASIS_LABELS, type BandEstimates as Estimates, type EstimateSkill, type SkillEstimate } from '@shared/bands';
import { Icon, type IconName } from './Icon';
import { formatBand } from '../lib/format';

const SKILL_META: Record<EstimateSkill, { label: string; icon: IconName; cls: string; to: string; cta: string }> = {
  LISTENING: { label: 'Nghe', icon: 'headphones', cls: 'skill-listening', to: '/practice?skill=LISTENING', cta: 'Làm bài Nghe' },
  READING: { label: 'Đọc', icon: 'book', cls: 'skill-reading', to: '/practice?skill=READING', cta: 'Làm bài Đọc' },
  WRITING: { label: 'Viết', icon: 'pen', cls: 'skill-writing', to: '/practice?skill=WRITING', cta: 'Làm bài Viết' },
  SPEAKING: { label: 'Nói', icon: 'mic', cls: 'skill-speaking', to: '/speaking', cta: 'Luyện Nói' },
};

function change(entry: SkillEstimate): string | null {
  if (entry.change === null || entry.change === 0) return null;
  return `${entry.change > 0 ? '+' : '−'}${Math.abs(entry.change).toFixed(1)}`;
}

/**
 * Band estimates from every kind of marking: complete papers, short sets scaled
 * to a full paper, the two AI judges and teachers. Each tile says which kind it
 * is, so a number is never mistaken for a more certain one than it is.
 */
export function BandEstimatesPanel({ estimates }: { estimates: Estimates }) {
  const { overall } = estimates;
  return (
    <section className="estimates" aria-label="Ước tính band">
      <div className={`estimates__overall${overall.band === null ? ' is-empty' : ''}`}>
        <span className="estimates__label">Band tổng ước tính</span>
        <span className="estimates__value">{formatBand(overall.band)}</span>
        <span className="estimates__kind">
          {overall.kind === 'COMPLETE'
            ? 'Tính từ cả bốn kỹ năng'
            : overall.kind === 'PROVISIONAL'
              ? `Tạm thời: ${overall.covered.length}/4 kỹ năng`
              : 'Hoàn thành một bài để có ước tính đầu tiên'}
        </span>
        {overall.missing.length > 0 && overall.band !== null ? (
          <span className="estimates__missing">Còn thiếu: {overall.missing.map((skill) => SKILL_META[skill].label).join(', ')}</span>
        ) : null}
      </div>

      <div className="estimates__skills">
        {estimates.skills.map((entry) => {
          const meta = SKILL_META[entry.skill];
          const delta = change(entry);
          return (
            <article key={entry.skill} className={`estimate ${meta.cls}${entry.band === null ? ' is-empty' : ''}`}>
              <header className="estimate__head">
                <span className="estimate__icon">
                  <Icon name={meta.icon} size={17} strokeWidth={2} />
                </span>
                <span>{meta.label}</span>
              </header>
              {entry.band !== null ? (
                <>
                  <p className="estimate__band">
                    {formatBand(entry.band)}
                    {delta ? (
                      <span className={`estimate__delta ${entry.change! > 0 ? 'is-up' : 'is-down'}`} title="So với lần trước">
                        {delta}
                      </span>
                    ) : null}
                  </p>
                  <p className="estimate__basis">
                    {entry.basis ? BAND_BASIS_LABELS[entry.basis] : ''}
                    {entry.samples > 1 ? ` · trung bình ${entry.samples} lần` : ''}
                  </p>
                  {entry.provisional ? <p className="estimate__note">Chỉ là ước tính: xem như gợi ý, không phải kết quả.</p> : null}
                </>
              ) : (
                <>
                  <p className="estimate__band estimate__band--none">—</p>
                  <Link className="estimate__cta" to={meta.to}>
                    {meta.cta} <Icon name="arrowRight" size={12} strokeWidth={2.4} />
                  </Link>
                </>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
