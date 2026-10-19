import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { mentorApi } from '../../lib/mentor-api';
import { useAsync } from '../../hooks/useAsync';
import { Badge, Button, Loading, Notice } from '../../components/ui';
import { Icon } from '../../components/Icon';
import type { MentorEarningRow } from '@shared/live';

type Preset = '30d' | 'month' | 'year' | 'all';

const PRESETS: Array<{ id: Preset; label: string }> = [
  { id: '30d', label: 'Last 30 days' },
  { id: 'month', label: 'This month' },
  { id: 'year', label: 'This year' },
  { id: 'all', label: 'All time' },
];

/** Date boundaries for the preset, computed at click time (not during render). */
function boundsFor(preset: Preset): { from?: string; to?: string } {
  const now = new Date();
  if (preset === 'all') return {};
  if (preset === 'month') {
    return {
      from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
      to: new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString(),
    };
  }
  if (preset === 'year') {
    return {
      from: new Date(now.getFullYear(), 0, 1).toISOString(),
      to: new Date(now.getFullYear() + 1, 0, 1).toISOString(),
    };
  }
  return { from: new Date(now.getTime() - 30 * 86_400_000).toISOString(), to: new Date(now.getTime() + 90 * 86_400_000).toISOString() };
}

function monthLabel(month: string): string {
  const [year, index] = month.split('-');
  const date = new Date(Number(year), Number(index) - 1, 1);
  return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusLabel(status: string): { label: string; tone: 'success' | 'warning' | 'neutral' } {
  if (status === 'COMPLETED') return { label: 'Paid', tone: 'success' };
  if (status === 'ACTIVE') return { label: 'In progress', tone: 'warning' };
  return { label: 'Scheduled', tone: 'neutral' };
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function EarningsPage() {
  const [preset, setPreset] = useState<Preset>('30d');
  const [bounds, setBounds] = useState<{ from?: string; to?: string }>(() => boundsFor('30d'));
  const [invoiceBusy, setInvoiceBusy] = useState<string | null>(null);
  const [invoiceError, setInvoiceError] = useState<string | null>(null);

  const earnings = useAsync(
    () => mentorApi.earnings(bounds.from, bounds.to),
    [bounds.from, bounds.to],
  );

  const data = earnings.data;
  const maxMonth = useMemo(() => Math.max(1, ...(data?.byMonth.map((row) => row.coins) ?? [1])), [data]);

  const choose = (next: Preset) => {
    setPreset(next);
    setBounds(boundsFor(next));
  };

  const exportCsv = () => {
    if (!data) return;
    const header = ['Date', 'Student', 'Topic', 'Minutes', 'Status', 'Coins', 'Invoice'];
    const lines = data.rows.map((row) =>
      [when(row.startsAt), row.studentName, row.topic, row.minutes, row.status, row.coins, row.invoiceNumber]
        .map(csvCell)
        .join(','),
    );
    const blob = new Blob([`\ufeff${[header.join(','), ...lines].join('\n')}`], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `earnings-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const openInvoice = async (row: MentorEarningRow) => {
    setInvoiceBusy(row.sessionId);
    setInvoiceError(null);
    try {
      const invoice = await mentorApi.invoice(row.sessionId);
      const win = window.open('', '_blank', 'width=820,height=920');
      if (!win) {
        setInvoiceError('Allow pop-ups for this site to open the invoice.');
        return;
      }
      win.document.write(invoiceHtml(invoice));
      win.document.close();
      win.focus();
      // Give the new document one frame to lay out before the print sheet opens.
      setTimeout(() => win.print(), 250);
    } catch (cause) {
      setInvoiceError(cause instanceof Error ? cause.message : 'Could not build the invoice.');
    } finally {
      setInvoiceBusy(null);
    }
  };

  return (
    <div className="stack earnings">
      <div className="page-head">
        <div>
          <p className="eyebrow">Mentor console</p>
          <h1>Earnings &amp; invoices</h1>
          <p className="muted">
            Every completed session, what it paid, and a printable invoice. Pending sessions are listed but not yet
            counted as earned.
          </p>
        </div>
        <div className="row">
          <Link to="/mentor" className="btn btn--ghost">
            <Icon name="chevronRight" size={14} /> Back to console
          </Link>
          <Button onClick={exportCsv} disabled={!data || data.rows.length === 0}>
            <Icon name="download" size={14} /> Export CSV
          </Button>
        </div>
      </div>

      <div className="earnings__range" role="group" aria-label="Date range">
        {PRESETS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`earnings__chip${preset === item.id ? ' is-on' : ''}`}
            onClick={() => choose(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {earnings.error ? <Notice tone="danger">{earnings.error}</Notice> : null}
      {invoiceError ? <Notice tone="danger">{invoiceError}</Notice> : null}

      {!data && earnings.loading ? (
        <Loading label="Loading earnings…" />
      ) : data ? (
        <>
          <div className="earnings__stats">
            <article className="earnings__stat">
              <span className="earnings__stat-icon is-mint">
                <Icon name="coin" size={18} />
              </span>
              <div>
                <b>{data.totals.earnedCoins}</b>
                <span>Coins earned</span>
              </div>
            </article>
            <article className="earnings__stat">
              <span className="earnings__stat-icon is-violet">
                <Icon name="presentation" size={18} />
              </span>
              <div>
                <b>{data.totals.completedSessions}</b>
                <span>Completed sessions</span>
              </div>
            </article>
            <article className="earnings__stat">
              <span className="earnings__stat-icon is-sun">
                <Icon name="clock" size={18} />
              </span>
              <div>
                <b>{data.totals.completedHours}h</b>
                <span>Teaching time</span>
              </div>
            </article>
            <article className="earnings__stat">
              <span className="earnings__stat-icon is-coral">
                <Icon name="hourglass" size={18} />
              </span>
              <div>
                <b>{data.totals.pendingCoins}</b>
                <span>Pending coins</span>
              </div>
            </article>
          </div>

          <div className="earnings__grid">
            <section className="earnings__card">
              <header>
                <h2>By month</h2>
                <span className="muted small">Completed sessions only</span>
              </header>
              {data.byMonth.length === 0 ? (
                <p className="muted small">No completed sessions in this range yet.</p>
              ) : (
                <div className="earnings__months">
                  {data.byMonth.map((row) => (
                    <div key={row.month} className="earnings__month">
                      <span className="earnings__month-label">{monthLabel(row.month)}</span>
                      <span className="earnings__month-bar">
                        <span style={{ width: `${Math.max(4, Math.round((row.coins / maxMonth) * 100))}%` }} />
                      </span>
                      <b>{row.coins}</b>
                      <span className="muted small">
                        {row.sessions} session{row.sessions === 1 ? '' : 's'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="earnings__card">
              <header>
                <h2>Rate card</h2>
                <span className="muted small">Charged per session</span>
              </header>
              <p className="muted small earnings__note">
                Your hourly rate is set in <Link to="/mentor">your mentor profile</Link>. Each row below shows what the
                student actually paid for that booking.
              </p>
              <ul className="earnings__legend">
                <li>
                  <Badge tone="success">Paid</Badge> session finished and counted.
                </li>
                <li>
                  <Badge tone="neutral">Scheduled</Badge> booked, not yet taught.
                </li>
                <li>
                  <Badge tone="warning">In progress</Badge> happening now.
                </li>
              </ul>
            </section>
          </div>

          <section className="earnings__table-wrap">
            <table className="earnings__table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Student</th>
                  <th>Session</th>
                  <th className="num">Minutes</th>
                  <th className="num">Coins</th>
                  <th>Status</th>
                  <th aria-label="Invoice" />
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => {
                  const status = statusLabel(row.status);
                  return (
                    <tr key={row.sessionId}>
                      <td className="nowrap">{when(row.startsAt)}</td>
                      <td>{row.studentName}</td>
                      <td>
                        <span className="earnings__topic">{row.topic || 'Coaching session'}</span>
                        <span className="muted small">{row.invoiceNumber}</span>
                      </td>
                      <td className="num">{row.minutes}</td>
                      <td className="num">{row.coins}</td>
                      <td>
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </td>
                      <td className="num">
                        <Button
                          variant="ghost"
                          loading={invoiceBusy === row.sessionId}
                          onClick={() => void openInvoice(row)}
                        >
                          Invoice
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {data.rows.length === 0 ? (
              <p className="muted earnings__empty">
                No sessions in this range. Try “All time”, or book your first session from the mentor console.
              </p>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );
}

interface InvoiceData {
  number: string;
  mentorName: string;
  studentName: string;
  topic: string;
  startsAt: string;
  endsAt: string;
  minutes: number;
  coins: number;
  status: string;
  issuedAt: string;
}

/** Standalone print sheet: no app chrome, safe to print or save as PDF. */
function invoiceHtml(invoice: InvoiceData): string {
  const esc = (value: string) =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(invoice.number)}</title>
  <style>
    @page { size: A4; margin: 18mm; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #242031; }
    header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 22px; border-bottom: 2px solid #ece8fa; }
    .brand { font-size: 13px; letter-spacing: .14em; text-transform: uppercase; color: #6c5ce7; font-weight: 700; }
    h1 { margin: 6px 0 0; font-size: 30px; letter-spacing: -.02em; }
    .meta { text-align: right; font-size: 13px; color: #6b6779; line-height: 1.7; }
    .meta b { color: #242031; }
    .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; margin: 30px 0; }
    .parties h2 { margin: 0 0 6px; font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: #8b8698; }
    .parties p { margin: 2px 0; font-size: 14px; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th { text-align: left; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: #8b8698; padding: 10px 8px; border-bottom: 1px solid #ece8fa; }
    td { padding: 14px 8px; border-bottom: 1px solid #f2eefb; }
    td.num, th.num { text-align: right; }
    .total { display: flex; justify-content: flex-end; margin-top: 22px; }
    .total div { min-width: 220px; display: flex; justify-content: space-between; padding: 14px 16px; border-radius: 12px; background: #f6f2ff; font-weight: 700; }
    footer { margin-top: 44px; font-size: 12px; color: #8b8698; line-height: 1.6; }
    .badge { display: inline-block; padding: 3px 9px; border-radius: 999px; background: #e9f8ef; color: #1f7a4d; font-size: 11px; font-weight: 700; }
  </style></head><body>
    <header>
      <div><div class="brand">AI Eo · IELTS</div><h1>Invoice</h1></div>
      <div class="meta">
        <div><b>${esc(invoice.number)}</b></div>
        <div>Issued ${esc(new Date(invoice.issuedAt).toLocaleDateString())}</div>
        <div>Session ${esc(new Date(invoice.startsAt).toLocaleDateString())}</div>
      </div>
    </header>
    <div class="parties">
      <div><h2>Mentor</h2><p><b>${esc(invoice.mentorName)}</b></p><p>AI Eo mentor</p></div>
      <div><h2>Student</h2><p><b>${esc(invoice.studentName)}</b></p><p>AI Eo learner</p></div>
    </div>
    <table>
      <thead><tr><th>Description</th><th>Date</th><th class="num">Minutes</th><th class="num">Coins</th></tr></thead>
      <tbody>
        <tr>
          <td>${esc(invoice.topic || 'One-to-one coaching session')}<br><span class="badge">${esc(invoice.status)}</span></td>
          <td>${esc(new Date(invoice.startsAt).toLocaleString())}</td>
          <td class="num">${invoice.minutes}</td>
          <td class="num">${invoice.coins}</td>
        </tr>
      </tbody>
    </table>
    <div class="total"><div><span>Total</span><span>${invoice.coins} coins</span></div></div>
    <footer>Amounts are in AI Eo coins. This invoice is generated from the booked session and its recorded duration.
    Questions: reply to the booking thread in AI Eo.</footer>
  </body></html>`;
}
