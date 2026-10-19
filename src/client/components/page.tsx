import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon, type IconName } from './Icon';

/**
 * Page kit.
 *
 * The building blocks every screen is assembled from, so a page never has to
 * invent its own header, section spacing or list row again. They are deliberately
 * dumb (no data fetching, no context): the layout and the motion live in
 * `styles/app.css` under "19. page kit", and each component only adds the one
 * thing that is hard to get right in CSS — a stable, accessible structure.
 */

/** A number or short label above the title; gives a page a scannable opening line. */
export function PageHead({
  eyebrow,
  title,
  meta,
  actions,
  stickyActions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  /** Keeps the actions on the same line as the title instead of dropping below it. */
  stickyActions?: boolean;
}) {
  return (
    <header className={`ph${stickyActions ? ' ph--tight' : ''}`}>
      <div className="ph__text">
        {eyebrow ? (
          <span className="ph__eyebrow">
            <i aria-hidden="true" />
            {eyebrow}
          </span>
        ) : null}
        <h1>{title}</h1>
        {meta ? <p className="ph__meta">{meta}</p> : null}
      </div>
      {actions ? <div className="ph__actions">{actions}</div> : null}
    </header>
  );
}

/**
 * A titled block of content. `layout` decides the container:
 * `grid` for cards, `list` for rows, `plain` for anything else.
 */
export function Section({
  title,
  hint,
  actions,
  layout = 'plain',
  cols = 2,
  tone,
  id,
  children,
}: {
  title?: ReactNode;
  hint?: ReactNode;
  actions?: ReactNode;
  layout?: 'plain' | 'grid' | 'list' | 'tiles';
  cols?: 2 | 3 | 4;
  tone?: 'brand' | 'info' | 'teal' | 'amber' | 'violet' | 'success';
  id?: string;
  children: ReactNode;
}) {
  const bodyClass =
    layout === 'grid' ? `sec__grid sec__grid--${cols}` : layout === 'tiles' ? 'module-tiles' : layout === 'list' ? 'rowlist' : '';
  return (
    <section className={`sec${tone ? ` sec--${tone}` : ''}`} id={id}>
      {title || actions ? (
        <div className="sec__head">
          <div>
            <h2>{title}</h2>
            {hint ? <p>{hint}</p> : null}
          </div>
          {actions ? <div className="sec__actions">{actions}</div> : null}
        </div>
      ) : null}
      {layout === 'plain' ? children : <div className={bodyClass}>{children}</div>}
    </section>
  );
}

/**
 * Progress ring. The arc is driven by `--pct`, so the CSS animation can draw it
 * on entry and then keep it in sync when the value changes.
 */
export function Ring({
  value,
  max = 100,
  label,
  sub,
  size = 96,
  stroke = 9,
  tone = 'brand',
  display,
}: {
  value: number;
  max?: number;
  label?: ReactNode;
  sub?: ReactNode;
  size?: number;
  stroke?: number;
  tone?: 'brand' | 'info' | 'teal' | 'amber' | 'violet' | 'success';
  /** What to print in the middle; defaults to the rounded value. */
  display?: ReactNode;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <div className={`ring ring--${tone}`} style={{ ['--ring-size' as string]: `${size}px`, ['--ring-stroke' as string]: `${stroke}px` }}>
      <svg viewBox="0 0 36 36" role="img" aria-label={typeof label === 'string' ? `${label}: ${Math.round(pct * 100)}%` : undefined}>
        <circle className="ring__track" cx="18" cy="18" r="15.5" />
        <circle
          className="ring__value"
          cx="18"
          cy="18"
          r="15.5"
          pathLength={100}
          strokeDasharray={`${pct * 100} 100`}
          style={{ ['--pct' as string]: pct * 100 }}
        />
      </svg>
      <span className="ring__text">
        <strong>{display ?? (label ? value : `${Math.round(pct * 100)}%`)}</strong>
        {label ? <span>{label}</span> : null}
        {sub ? <em>{sub}</em> : null}
      </span>
    </div>
  );
}

/** One line in a `Section layout="list"`. Links when `href`, a button when `onClick`. */
export function Row({
  icon,
  tone,
  title,
  meta,
  tags,
  right,
  href,
  onClick,
  chevron,
  index = 0,
}: {
  icon?: IconName;
  tone?: 'brand' | 'info' | 'teal' | 'amber' | 'violet' | 'success' | 'danger';
  title: ReactNode;
  meta?: ReactNode;
  tags?: ReactNode;
  right?: ReactNode;
  href?: string;
  onClick?: () => void;
  chevron?: boolean;
  index?: number;
}) {
  const inner = (
    <>
      {icon ? (
        <span className={`row__glyph${tone ? ` row__glyph--${tone}` : ''}`} aria-hidden="true">
          <Icon name={icon} size={17} />
        </span>
      ) : null}
      <span className="row__body">
        <span className="row__title">{title}</span>
        {meta ? <span className="row__meta">{meta}</span> : null}
        {tags ? <span className="row__tags">{tags}</span> : null}
      </span>
      {right ? <span className="row__right">{right}</span> : null}
      {chevron && !right ? (
        <span className="row__chev" aria-hidden="true">
          <Icon name="chevronRight" size={15} />
        </span>
      ) : null}
    </>
  );

  if (href) {
    return (
      <Link className="row" to={href} style={{ ['--i' as string]: index }}>
        {inner}
      </Link>
    );
  }
  return (
    <button
      type="button"
      className="row"
      onClick={onClick}
      style={{ ['--i' as string]: index }}
    >
      {inner}
    </button>
  );
}

/** Plain wrapper so a list of rows shares one rhythm. */
export function RowList({ children }: { children: ReactNode }) {
  return <div className="rowlist">{children}</div>;
}

/** Label + number, for the inline stat strips a page opens with. */
export function StatPill({ label, value, icon, tone }: { label: ReactNode; value: ReactNode; icon?: IconName; tone?: 'brand' | 'info' | 'teal' | 'amber' | 'violet' | 'success' | 'danger' }) {
  return (
    <span className={`pill-stat${tone ? ` pill-stat--${tone}` : ''}`}>
      {icon ? <Icon name={icon} size={14} /> : null}
      <b>{value}</b>
      <span>{label}</span>
    </span>
  );
}

/** A hero panel: dark, one message, one or two actions, and an optional meter on the right. */
export function Hero({
  kicker,
  title,
  lede,
  actions,
  aside,
  bars,
}: {
  kicker?: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  actions?: ReactNode;
  /** A ring, a chart or a card that sits opposite the text. */
  aside?: ReactNode;
  bars?: boolean;
}) {
  return (
    <section className="hero-panel">
      {bars ? (
        <span className="hero-panel__bars" aria-hidden="true">
          <i /> <i /> <i />
        </span>
      ) : null}
      <div className="hero-panel__text">
        {kicker ? <p className="hero-panel__kicker">{kicker}</p> : null}
        <h1>{title}</h1>
        {lede ? <p className="hero-panel__lede">{lede}</p> : null}
        {actions ? <div className="hero-panel__actions">{actions}</div> : null}
      </div>
      {aside ? <div className="hero-panel__aside">{aside}</div> : null}
    </section>
  );
}
