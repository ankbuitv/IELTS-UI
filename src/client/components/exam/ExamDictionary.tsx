import { useEffect, useRef } from 'react';
import { DictionaryPanel } from '../learn/DictionaryPanel';
import { Icon } from '../Icon';

/**
 * A dictionary that opens on top of a practice exam instead of navigating away
 * from it, so a candidate never leaves the test (or loses their place) to look
 * a word up. Only offered in practice mode.
 */
export function ExamDictionary({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (ref.current && target && !ref.current.contains(target) && !target.closest('[data-dictionary-toggle]')) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  return (
    <div className="exam-dict" role="dialog" aria-label="Dictionary" ref={ref}>
      <header className="exam-dict__head">
        <strong>Dictionary</strong>
        <button type="button" className="exam-icon" onClick={onClose} aria-label="Close dictionary">
          <Icon name="close" size={16} />
        </button>
      </header>
      <div className="exam-dict__body">
        <DictionaryPanel compact autoFocus />
      </div>
    </div>
  );
}
