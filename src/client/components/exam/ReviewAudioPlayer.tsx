import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { Icon } from '../Icon';
import { formatClock } from '../../lib/format';

const RATES = [0.75, 1, 1.25, 1.5];

/**
 * The playback bar for a finished attempt (review) and for the practice
 * transcript — where the learner is free to replay, scrub and slow the audio
 * down. Unlike the in-exam `AudioPlayer`, there is no play-count or seek
 * policy to enforce, so the whole surface is spent on being a good, calm
 * player: one clear play control, an honest seek track, the time, speed and
 * volume.
 *
 * `audioRef` is forwarded to the underlying element so a parent can seek it
 * imperatively ("Listen from here" jumps the recording to a sentence).
 */
export function ReviewAudioPlayer({
  src,
  title,
  audioRef,
  onDuration,
  className = '',
}: {
  src: string;
  title?: string;
  audioRef?: RefObject<HTMLAudioElement | null>;
  onDuration?: (seconds: number) => void;
  className?: string;
}) {
  const localRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [error, setError] = useState(false);

  // Point both the parent's ref and ours at the same element.
  useEffect(() => {
    if (audioRef) audioRef.current = localRef.current;
  }, [audioRef, src]);

  // Reset when the source changes (a different section/part).
  useEffect(() => {
    setPlaying(false);
    setCurrent(0);
    setDuration(0);
    setError(false);
  }, [src]);

  useEffect(() => {
    const element = localRef.current;
    if (element) element.playbackRate = rate;
  }, [rate]);

  useEffect(() => {
    const element = localRef.current;
    if (element) element.muted = muted;
  }, [muted]);

  const toggle = () => {
    const element = localRef.current;
    if (!element) return;
    if (element.paused) void element.play().catch(() => setError(true));
    else element.pause();
  };

  const seekTo = (seconds: number) => {
    const element = localRef.current;
    if (!element) return;
    element.currentTime = seconds;
    setCurrent(seconds);
  };

  const pct = duration > 0 ? (current / duration) * 100 : 0;
  const nextRate = RATES[(RATES.indexOf(rate) + 1) % RATES.length]!;

  return (
    <div className={`audiobar${playing ? ' audiobar--playing' : ''}${className}`}>
      <audio
        ref={localRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={(event) => {
          const value = event.currentTarget.duration;
          if (Number.isFinite(value) && value > 0) {
            setDuration(value);
            onDuration?.(value);
          }
        }}
        onDurationChange={(event) => {
          const value = event.currentTarget.duration;
          if (Number.isFinite(value) && value > 0) {
            setDuration(value);
            onDuration?.(value);
          }
        }}
        onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() => setError(true)}
      />

      <button
        type="button"
        className="audiobar__play"
        onClick={toggle}
        aria-label={playing ? 'Pause' : 'Play'}
        title={playing ? 'Pause' : 'Play'}
      >
        <Icon name={playing ? 'pause' : 'play'} size={20} />
      </button>

      <div className="audiobar__main">
        <div className="audiobar__row">
          {title ? <span className="audiobar__title">{title}</span> : <span />}
          <span className="audiobar__time">
            {formatClock(current)} <span className="audiobar__sep">/</span> {duration ? formatClock(duration) : '--:--'}
          </span>
        </div>
        <input
          className="audiobar__seek"
          type="range"
          min={0}
          max={Math.max(1, Math.floor(duration))}
          value={Math.floor(current)}
          onChange={(event) => seekTo(Number(event.target.value))}
          style={{ '--pct': `${pct}%` } as CSSProperties}
          aria-label="Seek"
        />
      </div>

      <div className="audiobar__side">
        <button
          type="button"
          className="audiobar__chip"
          onClick={() => setRate(nextRate)}
          aria-label={`Playback speed ${rate}×`}
          title="Playback speed"
        >
          {rate}×
        </button>
        <div className="audiobar__volume">
          <button
            type="button"
            className={`audiobar__volbtn${muted ? ' is-muted' : ''}`}
            onClick={() => setMuted((value) => !value)}
            aria-label={muted ? 'Unmute' : 'Mute'}
            title={muted ? 'Unmute' : 'Mute'}
          >
            <Icon name="volume" size={18} />
          </button>
          <input
            className="audiobar__vol"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            onChange={(event) => {
              const value = Number(event.target.value);
              setVolume(value);
              setMuted(value === 0);
              if (localRef.current) {
                localRef.current.volume = value;
                localRef.current.muted = value === 0;
              }
            }}
            style={{ '--pct': `${(muted ? 0 : volume) * 100}%` } as CSSProperties}
            aria-label="Volume"
          />
        </div>
      </div>

      {error ? (
        <p className="audiobar__error" role="alert">
          The recording could not be loaded. Check your connection and try again.
        </p>
      ) : null}
    </div>
  );
}
