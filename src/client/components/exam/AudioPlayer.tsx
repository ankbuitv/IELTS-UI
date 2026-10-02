import { useEffect, useRef, useState } from 'react';
import type { CandidateAudio } from '@shared/question-types';
import { Icon } from '../Icon';
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
    `Plays ${plays}/${audio.playback.maxPlays}`,
    audio.playback.allowPause ? 'pause allowed' : 'no pause',
    audio.playback.allowSeekAfterPlay ? 'seek allowed' : 'no seeking',
  ];

  return (
    <section className="audio-panel" aria-label="Listening audio">
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

      <div className="audio-panel__row">
        <button
          type="button"
          className="audio-panel__play"
          onClick={playing ? handlePause : handlePlay}
          disabled={maxedOut || !prepDone || (playing && !audio.playback.allowPause)}
          aria-label={playing ? 'Pause recording' : 'Play recording'}
          title={maxedOut ? 'Play limit reached' : playing ? 'Pause' : 'Play'}
        >
          <Icon name={playing ? 'pause' : 'play'} size={18} />
        </button>

        <div className="audio-panel__main">
          <div className="audio-panel__head">
            <span className="audio-panel__title">{sectionTitle || 'Listening audio'}</span>
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
          ) : (
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
          )}
        </div>
      </div>

      <div className="audio-panel__meta">
        {!prepDone ? (
          <strong>Starts in {formatClock(prepRemaining)} — controls unlock when preparation ends.</strong>
        ) : maxedOut ? (
          <strong>Play limit reached.</strong>
        ) : null}
        <span>{policyNotes.join(' · ')}</span>
      </div>

      {error ? (
        <p className="audio-panel__error" role="alert">
          {error}{' '}
          {audio.url ? (
            <a href={audio.url} target="_blank" rel="noreferrer">
              Open the audio file
            </a>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}
