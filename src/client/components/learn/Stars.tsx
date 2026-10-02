/** One to three stars drawn as SVG, so they render the same on every device (no font glyphs). */
export function Stars({ value, max = 3, size = 14 }: { value: number; max?: number; size?: number }) {
  return (
    <span className="stars" role="img" aria-label={`${value} of ${max} stars`}>
      {Array.from({ length: max }, (_, index) => (
        <svg key={index} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={index < value ? 'stars__on' : 'stars__off'}>
          <path d="M12 2.6l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.2 1.2-6.5L2.5 9.5l6.6-.9z" fill="currentColor" />
        </svg>
      ))}
    </span>
  );
}
