import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import type { CandidateImage } from '@shared/question-types';
import { Icon } from '../Icon';

/**
 * Content image of a section (a Task 1 chart, a map for a Listening part, a
 * diagram next to a passage).
 *
 * The figure never grows past its pane: it fills the available width, is
 * capped at a fraction of the viewport height and letterboxes the picture
 * inside that box (`object-fit: contain`), so a tall or very large upload no
 * longer stretches the passage column, breaks the split layout or spawns a
 * second scrollbar. Clicking (or Enter / Space) opens the same picture in a
 * full-screen lightbox for reading small print; Esc or a click closes it.
 * Dependency-free: plain state, a portal and inline layout styles.
 */
export function SectionImage({ image, label }: { image: CandidateImage; label: string }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLImageElement | null>(null);
  const alt = image.altText?.trim() || `Image for ${label}`;

  const close = useCallback(() => {
    setOpen(false);
    // Hand focus back to the picture so keyboard users continue where they were.
    triggerRef.current?.focus({ preventScroll: true });
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLImageElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setOpen(true);
    }
  };

  return (
    <>
      <div className="exam-figure" style={FIGURE_STYLE}>
        <img
          ref={triggerRef}
          className="exam-figure__img"
          src={image.url}
          alt={alt}
          style={IMAGE_STYLE}
          role="button"
          tabIndex={0}
          title="Open the image full screen"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(true)}
          onKeyDown={onKeyDown}
          draggable={false}
        />
        <span className="exam-figure__hint" aria-hidden="true">
          <Icon name="expand" size={12} strokeWidth={2.2} />
          Enlarge
        </span>
      </div>
      {open ? <ImageLightbox src={image.url} alt={alt} onClose={close} /> : null}
    </>
  );
}

const FIGURE_STYLE: CSSProperties = {
  position: 'relative',
  width: '100%',
  maxHeight: '46vh',
  overflow: 'hidden',
  borderRadius: 10,
  background: 'var(--ink-50)',
  border: '1px solid var(--ink-200)',
};

const IMAGE_STYLE: CSSProperties = {
  width: '100%',
  height: '100%',
  // The wrapper has no fixed height, so cap the picture itself as well:
  // this is what turns "crop to 46vh" into "fit inside 46vh".
  maxHeight: '46vh',
  objectFit: 'contain',
  display: 'block',
  borderRadius: 10,
  cursor: 'zoom-in',
};

/** Full-screen overlay; rendered into <body> so pane overflow/stacking cannot clip it. */
export function ImageLightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    closeRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="exam-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 120,
        background: 'rgba(2, 6, 23, 0.82)',
        backdropFilter: 'blur(3px)',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        cursor: 'zoom-out',
      }}
    >
      <img
        src={src}
        alt={alt}
        draggable={false}
        style={{
          maxWidth: 'calc(100vw - 48px)',
          maxHeight: 'calc(100dvh - 48px)',
          width: 'auto',
          height: 'auto',
          objectFit: 'contain',
          borderRadius: 12,
          background: 'var(--paper)',
          boxShadow: 'var(--shadow-lg)',
        }}
      />
      <button
        ref={closeRef}
        type="button"
        className="exam-lightbox__close"
        aria-label="Close image"
        title="Close (Esc)"
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
      >
        <Icon name="close" size={18} />
      </button>
      <span className="exam-lightbox__hint" aria-hidden="true">
        Click anywhere or press Esc to close
      </span>
    </div>,
    document.body,
  );
}
