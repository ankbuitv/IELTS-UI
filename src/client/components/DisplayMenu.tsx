import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import {
  DEFAULT_PREFS,
  FONT_SCALE_LABELS,
  FONT_SCALES,
  applyPrefs,
  loadPrefs,
  savePrefs,
  sanitisePrefs,
  watchSystemTheme,
  type DisplayPrefs,
  type FontScale,
} from '../lib/display';

/**
 * One small "Aa" control that changes text size, reading size, spacing and
 * theme. It lives in the app top bar and inside the exam, because those are the
 * two places a candidate may need it: while reading a long passage on a phone,
 * and while working through a question list.
 *
 * The exam shell mounts it in a compact variant so it never fights the timer
 * for space.
 */
export function DisplayMenu({ compact = false, label = 'Display' }: { compact?: boolean; label?: string }) {
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState<DisplayPrefs>(() =>
    typeof window === 'undefined' ? { ...DEFAULT_PREFS } : loadPrefs(),
  );
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    applyPrefs(prefs);
    savePrefs(prefs);
  }, [prefs]);

  useEffect(() => {
    if (prefs.theme !== 'system') return;
    return watchSystemTheme((theme) => {
      document.documentElement.dataset.theme = theme;
    });
  }, [prefs.theme]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // applyPrefs() (called by the effect above) is the only writer of the <html>
  // attributes, so there is exactly one place that can drift.
  const update = (patch: Partial<DisplayPrefs>) => {
    setPrefs((current) => sanitisePrefs({ ...current, ...patch }));
  };

  return (
    <div className="display-menu" ref={containerRef}>
      <button
        type="button"
        className={compact ? 'exam-topbar__icon display-menu__trigger' : 'btn btn--sm display-menu__trigger'}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Text size, spacing and theme"
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true" className="display-menu__aa">
          Aa
        </span>
        {compact ? null : <span className="display-menu__label">{label}</span>}
      </button>

      {open ? (
        <div className="display-menu__panel" role="dialog" aria-label="Display settings">
          <div className="display-menu__group">
            <span className="display-menu__title">Cỡ chữ chung</span>
            <div className="display-menu__row">
              {FONT_SCALES.map((scale) => (
                <button
                  key={scale}
                  type="button"
                  className={`display-menu__chip ${prefs.fontScale === scale ? 'is-active' : ''}`}
                  onClick={() => update({ fontScale: scale })}
                >
                  <span style={{ fontSize: chipSize(scale) }}>A</span>
                  <span className="display-menu__chip-label">{FONT_SCALE_LABELS[scale]}</span>
                </button>
              ))}
            </div>
          </div>

          <Slider
            label="Cỡ chữ bài đọc"
            value={prefs.readingScale}
            min={0.85}
            max={1.8}
            step={0.05}
            format={(value) => `${Math.round(value * 100)}%`}
            onChange={(value) => update({ readingScale: value })}
          />
          <Slider
            label="Giãn dòng"
            value={prefs.readingLeading}
            min={1.4}
            max={2.4}
            step={0.05}
            format={(value) => value.toFixed(2)}
            onChange={(value) => update({ readingLeading: value })}
          />
          <Slider
            label="Giãn chữ"
            value={prefs.readingSpacing}
            min={0}
            max={0.08}
            step={0.005}
            format={(value) => (value === 0 ? 'Tắt' : `${(value * 100).toFixed(1)}%`)}
            onChange={(value) => update({ readingSpacing: value })}
          />

          <div className="display-menu__group">
            <span className="display-menu__title">Chế độ màu</span>
            <div className="display-menu__row">
              {(
                [
                  ['system', 'Theo máy'],
                  ['light', 'Sáng'],
                  ['dark', 'Tối'],
                ] as const
              ).map(([value, text]) => (
                <button
                  key={value}
                  type="button"
                  className={`display-menu__chip display-menu__chip--text ${prefs.theme === value ? 'is-active' : ''}`}
                  onClick={() => update({ theme: value })}
                >
                  {text}
                </button>
              ))}
            </div>
          </div>

          <label className="display-menu__toggle">
            <input
              type="checkbox"
              checked={prefs.wideReading}
              onChange={(event) => update({ wideReading: event.target.checked })}
            />
            <span>Cột đọc rộng (màn hình lớn)</span>
          </label>
          <label className="display-menu__toggle">
            <input
              type="checkbox"
              checked={prefs.reduceMotion}
              onChange={(event) => update({ reduceMotion: event.target.checked })}
            />
            <span>Giảm hiệu ứng chuyển động</span>
          </label>

          <div className="display-menu__footer">
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setPrefs({ ...DEFAULT_PREFS })}
            >
              <Icon name="rotate" size={14} /> Đặt lại
            </button>
            <span className="tiny muted">Lưu trên thiết bị này</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="display-menu__slider">
      <span className="display-menu__slider-head">
        <span>{label}</span>
        <span className="muted tiny">{format(value)}</span>
      </span>
      <span className="display-menu__slider-controls">
        <button type="button" className="display-menu__step" onClick={() => onChange(Math.max(min, round(value - step)))} aria-label={`Giảm ${label}`}>
          −
        </button>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <button type="button" className="display-menu__step" onClick={() => onChange(Math.min(max, round(value + step)))} aria-label={`Tăng ${label}`}>
          +
        </button>
      </span>
    </label>
  );
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function chipSize(scale: FontScale): string {
  return scale === 'compact' ? '0.75rem' : scale === 'normal' ? '0.9rem' : scale === 'large' ? '1.05rem' : '1.2rem';
}

/**
 * Phone-in-portrait hint shown during Reading/Listening.
 *
 * Two columns (passage + questions) are genuinely easier in landscape on a
 * phone, and the candidate controls pane layout themselves — this only advises,
 * never forces, and stays dismissed for the rest of the attempt.
 */
export function OrientationHint({ skill, storageKey = 'exam.orientationHint' }: { skill: string; storageKey?: string }) {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return window.sessionStorage.getItem(storageKey) === 'dismissed';
    } catch {
      return false;
    }
  });
  const [portrait, setPortrait] = useState(() =>
    typeof window === 'undefined' ? false : window.innerHeight > window.innerWidth && window.innerWidth < 900,
  );

  useEffect(() => {
    const update = () => setPortrait(window.innerHeight > window.innerWidth && window.innerWidth < 900);
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  if (dismissed || !portrait) return null;

  return (
    <div className="orientation-hint" role="status">
      <Icon name="rotate" size={16} />
      <span>
        <strong>Xoay ngang màn hình</strong> để đọc {skill === 'LISTENING' ? 'đề nghe' : 'bài đọc'} và câu hỏi cạnh nhau
        — dễ hơn nhiều trên điện thoại.
      </span>
      <button
        type="button"
        className="orientation-hint__close"
        aria-label="Đã hiểu"
        onClick={() => {
          setDismissed(true);
          try {
            window.sessionStorage.setItem(storageKey, 'dismissed');
          } catch {
            // Ignore: hidden for this render only.
          }
        }}
      >
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}
