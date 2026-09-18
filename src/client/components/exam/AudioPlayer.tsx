import { useEffect, useRef, useState } from 'react';
import type { CandidateAudio } from '@shared/question-types';
import { Button, Notice } from '../ui';
import { formatClock } from '../../lib/format';

/**
 * Listening playback with the policy supplied by the server:
 * play limits, preparation time, pause and seek rules. The policy is part of
 * the attempt configuration, so it cannot be relaxed from the browser.
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

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card__header">
        <div>
          <h3 className="card__title">{sectionTitle || 'Listening audio'}</h3>
          <div className="card__hint">
            Play allowance: {plays}/{audio.playback.maxPlays}
            {audio.playback.allowPause ? '' : ' · pausing is disabled for this test'}
            {audio.playback.allowSeekAfterPlay ? '' : ' · seeking is disabled'}
          </div>
        </div>
        <span className="tiny muted">{duration ? `Recording ${formatClock(duration)}` : ''}</span>
      </div>

      {!prepDone ? (
        <Notice tone="info" title="Preparation time">
          The recording starts in {formatClock(prepRemaining)}. You cannot replay the audio afterwards.
        </Notice>
      ) : null}

      {error ? (
        <Notice tone="warning">
          {error}
        </Notice>
      ) : null}

      <audio
        ref={ref}
        src={audio.url}
        preload="metadata"
        style={{ width: '100%', marginTop: 10 }}
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

      <div className="row" style={{ marginTop: 10 }}>
        <Button variant="primary" size="sm" onClick={handlePlay} disabled={maxedOut || !prepDone || playing}>
          {playing ? 'Playing…' : maxedOut ? 'Play limit reached' : 'Play recording'}
        </Button>
        <Button size="sm" onClick={handlePause} disabled={!playing || !audio.playback.allowPause}>
          Pause
        </Button>
        <span className="tiny muted nowrap">
          {formatClock(currentTime)} {duration ? `/ ${formatClock(duration)}` : ''}
        </span>
      </div>

      {maxedOut ? (
        <p className="tiny muted" style={{ marginTop: 8 }}>
          The recording has been played the permitted number of times. This mirrors a computer-based listening test where
          the audio is played once.
        </p>
      ) : null}
    </div>
  );
}
