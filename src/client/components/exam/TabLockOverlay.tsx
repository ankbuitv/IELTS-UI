import type { TabLockState } from './useExamSession';
import { Icon } from '../Icon';
import { Button } from '../ui';

/**
 * Shown when the candidate comes back to the exam after leaving it. It blocks
 * the test until they acknowledge it, says which strike this was, and on the
 * last strike tells them the attempt has been submitted.
 *
 * A web page cannot stop someone switching windows. What it can do is notice,
 * count, interrupt and (at the limit) submit, and this notice says exactly that.
 */
export function TabLockOverlay({
  lock,
  onReturn,
  onViewResults,
}: {
  lock: TabLockState;
  onReturn: () => void;
  onViewResults: () => void;
}) {
  const limit = lock.limit;
  const remaining = limit === null ? null : Math.max(0, limit - lock.strikes);
  const pips = limit ?? Math.max(3, lock.strikes);

  return (
    <div className="tablock" role="alertdialog" aria-modal="true" aria-labelledby="tablock-title" aria-describedby="tablock-text">
      <div className="tablock__card">
        <div className="tablock__head">
          <Icon name="lock" size={16} />
          Exam locked
        </div>
        <div className="tablock__body">
          <h2 id="tablock-title">{lock.final ? 'Your attempt has been submitted' : 'You left the exam tab'}</h2>
          <div className="tablock__pips" role="img" aria-label={limit === null ? `${lock.strikes} strikes` : `Strike ${Math.min(lock.strikes, limit)} of ${limit}`}>
            {Array.from({ length: pips }, (_, index) => (
              <span key={index} className={index < lock.strikes ? 'is-hit' : ''} />
            ))}
          </div>
          <p id="tablock-text">
            {lock.final
              ? `You left the exam tab ${limit ?? lock.strikes} times, which is the limit, so the test was submitted automatically. Everything you had answered up to that moment was saved and will be marked.`
              : limit === null
                ? 'Leaving the exam tab is recorded and your teacher can see it. Please stay on this page until you submit.'
                : `Strike ${lock.strikes} of ${limit}. Switching tabs or windows is not allowed during a test. ${remaining} more and your attempt will be submitted automatically.`}
          </p>
          {lock.final ? null : (
            <p className="tablock__fine">
              A web page cannot stop you from switching windows, so Ai eo counts it. The timer kept running while you were away.
            </p>
          )}
        </div>
        <div className="tablock__foot">
          {lock.final ? (
            <Button autoFocus variant="primary" size="lg" onClick={onViewResults}>
              See my results
            </Button>
          ) : (
            <Button autoFocus variant="primary" size="lg" onClick={onReturn}>
              Return to test
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
