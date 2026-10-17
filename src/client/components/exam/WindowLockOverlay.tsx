import { Icon } from '../Icon';
import { Button } from '../ui';

/**
 * Covers the paper while an exam-mode candidate is outside fullscreen.
 *
 * It is the fullscreen counterpart of the tab lock: a page cannot force a window
 * to stay maximised, so instead the test stops being visible until fullscreen is
 * re-entered. The paper is never submitted over this — a screensaver, an OS
 * update or a browser prompt can leave fullscreen on its own — and the candidate
 * can continue in the window if their browser refuses fullscreen, which is
 * recorded for the teacher instead.
 */
export function WindowLockOverlay({
  exits,
  allowance,
  browserRefused,
  onEnterFullscreen,
  onContinue,
}: {
  exits: number;
  allowance: number | null;
  browserRefused: boolean;
  onEnterFullscreen: () => void;
  onContinue: () => void;
}) {
  const pips = allowance ?? Math.max(3, exits);
  const overAllowance = allowance !== null && exits > allowance;

  return (
    <div
      className="tablock tablock--fullscreen"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="winlock-title"
      aria-describedby="winlock-text"
    >
      <div className="tablock__card">
        <div className="tablock__head">
          <Icon name="shield" size={16} />
          Fullscreen required
        </div>
        <div className="tablock__body">
          <h2 id="winlock-title">Fullscreen was exited</h2>
          <div
            className="tablock__pips"
            role="img"
            aria-label={allowance === null ? `${exits} exit(s)` : `Exit ${Math.min(exits, allowance)} of ${allowance}`}
          >
            {Array.from({ length: pips }, (_, index) => (
              <span key={index} className={index < exits ? 'is-hit' : ''} />
            ))}
          </div>
          <p id="winlock-text">
            The test stays covered until you go back to fullscreen. This exam mode opens the
            browser fullscreen by itself and records every exit.
            {allowance === null
              ? ''
              : overAllowance
                ? ` You have used the ${allowance} allowed exit(s) for this sitting, so your teacher has been flagged.`
                : ` ${Math.max(0, allowance - exits)} exit(s) left before your teacher is flagged.`}
          </p>
          <p className="tablock__fine">
            {browserRefused
              ? 'Your browser refused fullscreen on this device, so you may continue in this window. That has been recorded.'
              : 'Your answers are saved and the timer keeps running. Nothing is submitted for leaving fullscreen.'}
          </p>
        </div>
        <div className="tablock__foot">
          <Button variant="ghost" size="lg" onClick={onContinue}>
            {overAllowance ? 'Continue without fullscreen (reported)' : 'Continue in this window'}
          </Button>
          <Button autoFocus variant="primary" size="lg" onClick={onEnterFullscreen}>
            <Icon name="expand" size={15} />
            Back to fullscreen
          </Button>
        </div>
      </div>
    </div>
  );
}
