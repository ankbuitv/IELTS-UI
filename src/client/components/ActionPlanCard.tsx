import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ActionPlan } from '@shared/action-plan';
import { api } from '../lib/api';
import { Icon } from './Icon';
import { Skeleton } from './ui';

/**
 * "This week" checklist on the dashboard. Three tasks, derived from the
 * learner's own weakest criterion, words due and recent attempts.
 */
export function ActionPlanCard() {
  const [plan, setPlan] = useState<ActionPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await api.get<ActionPlan>('/api/student/action-plan');
      setPlan(next);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load this week’s plan.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (taskId: string, done: boolean) => {
    if (!plan) return;
    setBusy(taskId);
    const before = plan;
    const next = {
      ...plan,
      tasks: plan.tasks.map((item) => (item.id === taskId ? { ...item, done } : item)),
      completed: plan.tasks.filter((item) => (item.id === taskId ? done : item.done)).length,
    };
    setPlan(next);
    try {
      setPlan(await api.patch<ActionPlan>(`/api/student/action-plan/tasks/${encodeURIComponent(taskId)}`, { done }));
    } catch {
      setPlan(before);
    } finally {
      setBusy(null);
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      setPlan(await api.post<ActionPlan>('/api/student/action-plan/refresh'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not refresh the plan.');
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) {
    return (
      <section className="plan-card" aria-busy="true">
        <div className="stack" style={{ gap: 10 }}>
          <Skeleton height={18} width="42%" />
          <Skeleton height={12} width="78%" />
          <Skeleton height={54} />
          <Skeleton height={54} />
        </div>
      </section>
    );
  }

  if (!plan) {
    return (
      <section className="plan-card plan-card--empty">
        <div>
          <h2>Kế hoạch tuần này</h2>
          <p>{error ?? 'Chưa tạo được kế hoạch.'}</p>
        </div>
        <button type="button" className="btn btn--sm btn--secondary" onClick={() => void load()}>
          Thử lại
        </button>
      </section>
    );
  }

  const done = plan.tasks.filter((item) => item.done).length;

  return (
    <section className="plan-card" aria-label="Kế hoạch tuần này">
      <header className="plan-card__head">
        <div>
          <p className="plan-card__kicker">
            <Icon name="target" size={13} />
            Kế hoạch tuần này
          </p>
          <h2>
            {done}/{plan.tasks.length} việc đã xong
          </h2>
        </div>
        <div className="plan-card__actions">
          {plan.focus ? (
            <span className="plan-card__focus" title="Tiêu chí bạn đang yếu nhất, tính từ điểm chấm gần đây">
              {plan.focus.label} · {plan.focus.band?.toFixed(1) ?? '—'}
            </span>
          ) : null}
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            onClick={() => void refresh()}
            disabled={refreshing}
            title="Tính lại kế hoạch từ dữ liệu mới nhất"
          >
            <Icon name="rotate" size={13} /> {refreshing ? 'Đang tính…' : 'Làm mới'}
          </button>
        </div>
      </header>

      <p className="plan-card__summary">{plan.summary}</p>

      <ul className="plan-list">
        {plan.tasks.map((item) => (
          <li key={item.id} className={`plan-task${item.done ? ' is-done' : ''}`}>
            <button
              type="button"
              className="plan-task__check"
              aria-pressed={item.done}
              onClick={() => void toggle(item.id, !item.done)}
              disabled={busy === item.id}
              aria-label={item.done ? 'Đánh dấu chưa xong' : 'Đánh dấu đã xong'}
            >
              {item.done ? <Icon name="check" size={13} strokeWidth={3} /> : null}
            </button>
            <div className="plan-task__text">
              <strong>{item.title}</strong>
              <span>{item.detail}</span>
            </div>
            <span className="plan-task__minutes">{item.minutes}′</span>
            <Link className="plan-task__go" to={item.href} aria-label={`Mở: ${item.title}`}>
              <Icon name="chevronRight" size={15} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
