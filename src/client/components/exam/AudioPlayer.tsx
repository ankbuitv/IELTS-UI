import { useEffect, useRef, useState } from 'react';
import type { CandidateAudio } from '@shared/question-types';
import { Button, Notice } from '../ui';
import { formatClock } from '../../lib/format';

/**
 * Listening playback with the policy supplied by the server:
 * play limits, preparation time, pause and seek rules. The policy is part of
 * the attempt configuration, so it cannot be relaxed from the browser.
 *
 * The visual design is deliberately a calm exam panel rather than a music
 * player: one clear play control, an honest progress track and the playback
 * rules stated in words.
 */
export function AudioPlayer({
  audio,
  sectionTitle,
  onEvent,
}: {
  audio: CandidateAudio;
  sectionTitle: string;
  onEvent?: (type: 'COPY_ATTEMPT' | 'PASTE_ATTEMPT', metadata?: Record<string, unknown>) => void;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  const furthest = useRef(0);
  const [plays, setPlays] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [prepRemaining, setPrepRemaining] = useState(audio.playback.prepSeconds);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(audio.durationSeconds ?? 0);
  const [error, setError] = useState<string | null>(null);
  const maxedOut = plays >= audio.playback.maxPlays;
  const prepDone = prepRemaining <= 0;

  useEffect(() => {
    setPrepRemaining(audio.playback.prepSeconds);
    setPlays(0);
    setPlaying(false);
    setCurrentTime(0);
    furthest.current = 0;
  }, [audio.assetId, audio.playback.prepSeconds]);

  useEffect(() => {
    if (prepRemaining <= 0) return;
    const interval = window.setInterval(() => setPrepRemaining((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(interval);
  }, [prepRemaining]);

  const handlePlay = () => {
    const element = ref.current;
    if (!element || maxedOut || !prepDone || playing) return;
    void element.play().catch(() => setError('Playback was blocked by the browser. Press play again.'));
  };

  const handlePause = () => {
    const element = ref.current;
    if (!element || !audio.playback.allowPause) return;
    element.pause();
  };

  const percent = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const policyNotes = [
    `Play allowance ${plays}/${audio.playback.maxPlays}`,
    audio.playback.allowPause ? 'pausing allowed' : 'pausing disabled',
    audio.playback.allowSeekAfterPlay ? 'seeking allowed' : 'seeking disabled',
  ];

  return (
    <section className="audio-panel" style={{ marginBottom: 16 }} aria-label="Listening audio">
      <div className="audio-panel__head">
        <div>
          <div className="audio-panel__title">{sectionTitle || 'Listening audio'}</div>
          <div className="audio-panel__meta">{policyNotes.join(' · ')}</div>
        </div>
        <span className="badge badge--neutral" title="Recording length">
          {duration ? formatClock(duration) : 'Loading…'}
        </span>
      </div>

      {!prepDone ? (
        <div style={{ marginTop: 14 }}>
          <Notice tone="info" title="Preparation time">
            The recording starts in {formatClock(prepRemaining)}. Playback controls unlock when preparation ends.
          </Notice>
        </div>
      ) : null}

      {error ? (
        <div style={{ marginTop: 14 }}>
          <Notice tone="warning">{error}</Notice>
        </div>
      ) : null}

      {/* The element itself stays hidden: the panel below is the visible control. */}
      <audio
        ref={ref}
        src={audio.url}
        preload="metadata"
        style={{ display: 'none' }}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || duration)}
        onTimeUpdate={(event) => {
          const element = event.currentTarget;
          setCurrentTime(element.currentTime);
          if (!audio.playback.allowSeekAfterPlay) {
            // Scrub attempts are snapped back to the furthest point reached.
            if (element.currentTime > furthest.current + 1.5) {
              element.currentTime = furthest.current;
            } else if (element.currentTime > furthest.current) {
              furthest.current = element.currentTime;
            }
          }
        }}
        onPlay={() => {
          setPlaying(true);
          setPlays((value) => value + 1);
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() => setError('The audio for this part could not be loaded. Check your connection and reload.')}
        onCopy={(event) => {
          event.preventDefault();
          onEvent?.('COPY_ATTEMPT', { target: 'audio' });
        }}
      />

      <div className="audio-panel__controls">
        <button
          type="button"
          className="audio-panel__play"
          onClick={playing ? handlePause : handlePlay}
          disabled={maxedOut || !prepDone || (playing && !audio.playback.allowPause)}
          aria-label={playing ? 'Pause recording' : 'Play recording'}
        >
          {playing ? '❚❚' : '▶'}
        </button>

        <div
          className="audio-panel__track"
          role="progressbar"
          aria-valuenow={Math.round(percent)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Recording progress"
        >
          <div className="audio-panel__fill" style={{ width: `${percent}%` }} />
        </div>

        <span className="audio-panel__time">
          {formatClock(currentTime)} / {duration ? formatClock(duration) : '--:--'}
        </span>
      </div>

      {audio.playback.allowSeekAfterPlay && prepDone ? (
        <input
          className="audio-panel__scrub"
          type="range"
          min={0}
          max={Math.max(1, Math.floor(duration))}
          value={Math.floor(currentTime)}
          onChange={(event) => {
            const element = ref.current;
            if (!element) return;
            element.currentTime = Number(event.target.value);
            setCurrentTime(element.currentTime);
          }}
          aria-label="Seek within the recording"
        />
      ) : null}

      <div className="row" style={{ marginTop: 12 }}>
        {!playing ? (
          <Button variant="primary" size="sm" onClick={handlePlay} disabled={maxedOut || !prepDone}>
            {maxedOut ? 'Play limit reached' : 'Play recording'}
          </Button>
        ) : null}
        {playing && audio.playback.allowPause ? (
          <Button size="sm" onClick={handlePause}>
            Pause
          </Button>
        ) : null}
        {audio.url ? (
          <Button
            size="sm"
            onClick={() => {
              window.open(audio.url, '_blank', 'noopener,noreferrer');
            }}
          >
            Open audio URL
          </Button>
        ) : null}
      </div>
      {audio.url && (audio.url.startsWith('http://') || audio.url.startsWith('https://')) ? (
        <p className="tiny muted" style={{ marginTop: 8, wordBreak: 'break-all' }}>
          <a href={audio.url} target="_blank" rel="noreferrer">
            {audio.url}
          </a>
        </p>
      ) : null}

      {maxedOut ? (
        <p className="audio-panel__policy">
          The recording has been played the permitted number of times. This mirrors a computer-based listening test where
          the audio is played once.
        </p>
      ) : (
        <p className="audio-panel__policy">
          Playback rules come from the test configuration and cannot be changed from the browser.
        </p>
      )}
    </section>
  );
}
