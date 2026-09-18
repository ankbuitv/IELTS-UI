import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------
type ButtonVariant = 'default' | 'primary' | 'secondary' | 'success' | 'danger' | 'ghost';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg' | 'icon';
  block?: boolean;
  loading?: boolean;
}

export function Button({
  variant = 'default',
  size = 'md',
  block,
  loading,
  children,
  className = '',
  disabled,
  ...rest
}: ButtonProps) {
  const classes = [
    'btn',
    variant !== 'default' ? `btn--${variant}` : '',
    size !== 'md' ? `btn--${size}` : '',
    block ? 'btn--block' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button className={classes} disabled={disabled || loading} {...rest}>
      {loading ? <span className="spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Form fields
// ---------------------------------------------------------------------------
interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  children: (id: string) => ReactNode;
  required?: boolean;
}

export function Field({ label, hint, error, children, required }: FieldProps) {
  const id = useId();
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
        {required ? ' *' : ''}
      </label>
      {children(id)}
      {hint && !error ? <span className="field__hint">{hint}</span> : null}
      {error ? (
        <span className="field__hint" style={{ color: 'var(--danger)' }}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} />;
}

/**
 * Password input with an inline reveal toggle. The toggle is a real button so it
 * is keyboard reachable, and the input keeps `autoComplete` semantics for
 * password managers.
 */
export function PasswordInput({
  id,
  value,
  onChange,
  autoComplete = 'current-password',
  placeholder,
  required,
  name,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  placeholder?: string;
  required?: boolean;
  name?: string;
}) {
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="field--password">
      <input
        id={id}
        name={name}
        type={revealed ? 'text' : 'password'}
        value={value}
        required={required}
        placeholder={placeholder}
        autoComplete={autoComplete}
        onChange={(event) => onChange(event.target.value)}
      />
      <button
        type="button"
        className="password-toggle"
        aria-pressed={revealed}
        aria-label={revealed ? 'Hide password' : 'Show password'}
        onClick={() => setRevealed((current) => !current)}
      >
        {revealed ? 'Hide' : 'Show'}
      </button>
    </div>
  );
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} />;
}

export function Checkbox({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className="checkbox">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function Radio({
  name,
  value,
  checked,
  onChange,
  label,
  disabled,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: (value: string) => void;
  label: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className="radio">
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={() => onChange(value)}
      />
      <span>{label}</span>
    </label>
  );
}

export function IconButton({
  label,
  children,
  size = 'md',
  variant = 'default',
  ...rest
}: ButtonProps & { label: string }) {
  return (
    <Button variant={variant} size={size === 'lg' ? 'md' : size} aria-label={label} title={label} {...rest}>
      <span aria-hidden="true">{children}</span>
    </Button>
  );
}

/** Accessible hover/focus hint; never the only carrier of important text. */
export function Tooltip({ text, children }: { text: string; children: ReactNode }) {
  return (
    <span className="tooltip">
      {children}
      <span className="tooltip__bubble" role="tooltip">
        {text}
      </span>
    </span>
  );
}

export function Skeleton({ height = 16, width = '100%', radius }: { height?: number | string; width?: number | string; radius?: number }) {
  return (
    <div
      className="skeleton"
      style={{ height, width, borderRadius: radius !== undefined ? radius : undefined }}
      aria-hidden="true"
    />
  );
}

export function Pagination({
  page,
  pageCount,
  onPage,
  totalLabel,
}: {
  page: number;
  pageCount: number;
  onPage: (page: number) => void;
  totalLabel?: string;
}) {
  if (pageCount <= 1) return null;
  return (
    <nav className="pagination" aria-label="Pagination">
      <span className="pagination__status">{totalLabel ?? `Page ${page} of ${pageCount}`}</span>
      <Button size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </Button>
      <Button size="sm" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>
        Next
      </Button>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------
export function Card({
  title,
  hint,
  actions,
  children,
  flush,
  interactive,
  className = '',
}: {
  title?: ReactNode;
  hint?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  /** Adds the hover lift used for cards that link somewhere. */
  interactive?: boolean;
  className?: string;
}) {
  return (
    <section className={`card ${flush ? 'card--flush' : ''} ${interactive ? 'card--link' : ''} ${className}`}>
      {(title || actions) && (
        <header className="card__header" style={flush ? { padding: '16px 18px 0' } : undefined}>
          <div>
            {title ? <h2 className="card__title">{title}</h2> : null}
            {hint ? <div className="card__hint">{hint}</div> : null}
          </div>
          {actions ? <div className="row">{actions}</div> : null}
        </header>
      )}
      {children}
    </section>
  );
}

/**
 * Stat card.
 *
 * `accent` exists so a dashboard row can use several accessible colours at
 * once (Reading cyan, Listening violet, Writing amber, Full mock emerald)
 * without turning the whole page one hue. `tone` on ProgressBar/Bar matches.
 */
export function Stat({
  label,
  value,
  hint,
  icon,
  accent = 'brand',
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  accent?: 'brand' | 'emerald' | 'violet' | 'amber' | 'blue' | 'rose' | 'slate';
}) {
  return (
    <div className={`stat accent--${accent}`}>
      {icon ? (
        <div className="stat__icon" aria-hidden="true">
          {icon}
        </div>
      ) : null}
      <div className="stat__body">
        <div className="stat__label">{label}</div>
        <div className="stat__value">{value}</div>
        {hint ? <div className="stat__hint">{hint}</div> : null}
      </div>
    </div>
  );
}

export function Badge({
  children,
  tone = 'neutral',
  title,
  plain,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'violet' | 'dim';
  title?: string;
  /** Hide the leading status dot (for purely decorative labels). */
  plain?: boolean;
}) {
  return (
    <span className={`badge badge--${tone}${plain ? ' badge--plain' : ''}`} title={title}>
      {children}
    </span>
  );
}

export function Notice({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'warning' | 'danger' | 'success';
  title?: ReactNode;
  children?: ReactNode;
}) {
  const icon = tone === 'danger' ? '!' : tone === 'warning' ? '!' : tone === 'success' ? '✓' : 'i';
  return (
    <div className={`notice notice--${tone}`} role={tone === 'danger' ? 'alert' : undefined}>
      <span className="notice__icon" aria-hidden="true">
        {icon}
      </span>
      <div className="notice__body">
        {title ? <strong>{title}</strong> : null}
        {title && children ? <br /> : null}
        {children}
      </div>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty__title">{title}</div>
      {children}
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="loading-block" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function ProgressBar({ value, max, tone }: { value: number; max: number; tone?: 'success' | 'warning' | 'danger' | 'violet' }) {
  const percent = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className={`bar ${tone ? `bar--${tone}` : ''}`} role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
      <div className="bar__fill" style={{ width: `${percent}%` }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------
export function Modal({
  open,
  title,
  onClose,
  children,
  actions,
  wide,
}: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    ref.current?.focus();
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div
        className={`modal ${wide ? 'modal--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : 'Dialog'}
        tabIndex={-1}
        ref={ref}
      >
        <h2 className="modal__title">{title}</h2>
        {children}
        {actions ? <div className="modal__actions">{actions}</div> : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: Array<{ id: T; label: ReactNode }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          type="button"
          aria-selected={value === tab.id}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------
type ToastTone = 'info' | 'success' | 'error' | 'warning';
interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

const ToastContext = createContext<{ push: (message: string, tone?: ToastTone) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const counter = useRef(0);
  const timers = useRef<Map<number, number>>(new Map());

  const push = useCallback((message: string, tone: ToastTone = 'info') => {
    counter.current += 1;
    const id = counter.current;
    setToasts((current) => [...current, { id, message, tone }]);
    const timer = window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
      timers.current.delete(id);
    }, tone === 'error' ? 8000 : 4200);
    timers.current.set(id, timer);
  }, []);

  useEffect(
    () => () => {
      timers.current.forEach((timer) => window.clearTimeout(timer));
    },
    [],
  );

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.tone !== 'info' ? `toast--${toast.tone}` : ''}`}>
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside ToastProvider');
  return context;
}

// ---------------------------------------------------------------------------
// Small data helpers
// ---------------------------------------------------------------------------
export function KeyValue({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="kv">
      {items.map(([key, value]) => (
        <div key={key} style={{ display: 'contents' }}>
          <dt>{key}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ConfirmButton({
  onConfirm,
  children,
  confirmLabel = 'Confirm',
  title,
  body,
  variant = 'danger',
  size,
}: {
  onConfirm: () => void | Promise<void>;
  children: ReactNode;
  confirmLabel?: string;
  title: string;
  body?: ReactNode;
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)}>
        {children}
      </Button>
      <Modal
        open={open}
        title={title}
        onClose={() => setOpen(false)}
        actions={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              variant={variant}
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onConfirm();
                  setOpen(false);
                } catch {
                  // Keep the dialog open so the operator can retry after a toast.
                } finally {
                  setBusy(false);
                }
              }}
            >
              {confirmLabel}
            </Button>
          </>
        }
      >
        {body}
      </Modal>
    </>
  );
}
