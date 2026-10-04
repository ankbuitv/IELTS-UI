/**
 * Avatars on screen: the picture, and the two things that stand in for one.
 *
 * Three states, one component, so every surface draws a learner the same way:
 *
 *   1. an uploaded picture (a data URL, because an `<img>` cannot carry the
 *      bearer header the embedded preview authenticates with);
 *   2. a preset coat — one of the mascots, drawn live, in the colour the
 *      learner picked. This is what makes a leaderboard of strangers colourful
 *      without shipping fifty photographs to every reader;
 *   3. two initials in a tinted circle, which is what everybody had before and
 *      what anybody falls back to.
 *
 * `AvatarPicker` is the profile-page half: the preset gallery, a file input with
 * drag-and-drop, and the *same* validation the server runs, imported from
 * `@shared/avatar` so a refusal happens in the file picker with a reason rather
 * than after a round trip with an error. Raster pictures are downscaled to
 * 256 px in the browser before they are sent, which keeps the stored avatar in
 * the tens of kilobytes — the database has no object storage, and a profile
 * picture does not need to be printable.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type DragEvent } from 'react';
import {
  AVATAR_ACCEPT,
  AVATAR_EXTENSIONS,
  AVATAR_MAX_BYTES,
  AVATAR_PRESETS,
  AVATAR_SVG_MAX_BYTES,
  validateAvatar,
  type AvatarState,
} from '@shared/avatar';
import { Mascot, type MascotVariant } from './learn/Mascot';
import { Icon } from './Icon';
import { Button } from './ui';
import { learnApi } from '../lib/learn-api';
import { describeError } from '../lib/api';

/** Two initials, from a display name; '?' when there is nothing to take them from. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? '').join('') || '?';
}

/** The tint behind the initials, chosen by the name so it is stable per person. */
const AVATAR_TINTS = ['#e23a41', '#f2760c', '#12805a', '#1d6fc4', '#6b3fa8', '#e0457f', '#0b7a75', '#c98a00'];

function tintOf(name: string): string {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) hash = (hash * 31 + name.charCodeAt(index)) % 100_003;
  return AVATAR_TINTS[hash % AVATAR_TINTS.length]!;
}

export function Avatar({
  name,
  avatar,
  preset,
  size = 40,
  className = '',
}: {
  /** The display name; supplies the initials and the tint when there is no picture. */
  name: string;
  /** The signed-in person's own avatar, when this is their face. */
  avatar?: AvatarState | null;
  /** A preset coat name from a leaderboard row, when this is somebody else's. */
  preset?: string;
  size?: number;
  className?: string;
}) {
  const dataUrl = avatar?.kind === 'UPLOAD' ? avatar.dataUrl : null;
  const coat = (avatar?.kind === 'PRESET' ? avatar.preset : preset) || '';
  const style = { '--avatar-size': `${size}px`, '--avatar-tint': tintOf(name) } as CSSProperties;

  if (dataUrl) {
    return (
      <span className={`avatar avatar--image${className ? ` ${className}` : ''}`} style={style}>
        <img src={dataUrl} alt="" width={size} height={size} />
      </span>
    );
  }
  if (coat && (AVATAR_PRESETS as readonly string[]).includes(coat)) {
    return (
      <span className={`avatar avatar--preset${className ? ` ${className}` : ''}`} style={style} aria-hidden="true">
        <Mascot variant={coat as MascotVariant} mood="idle" size={Math.round(size * 1.16)} />
      </span>
    );
  }
  return (
    <span className={`avatar avatar--initials${className ? ` ${className}` : ''}`} style={style} aria-hidden="true">
      {initialsOf(name)}
    </span>
  );
}

// ------------------------------------------------------------------- picker
/** What the browser is willing to re-encode, and to what. */
const CANVAS_TYPE: Record<string, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

/** The longest edge a stored avatar keeps. 256 px is four times a 64 px slot. */
const AVATAR_TARGET_PX = 256;

/**
 * Downscales a raster picture in the browser.
 *
 * Returns the original bytes when the picture is already small, when it is an
 * SVG (text: scaling it would mean rewriting it), or when the canvas refuses —
 * a failure to shrink is not a failure to upload, and the server's own size
 * limit is still the last word.
 */
async function downscale(file: File, type: string): Promise<{ blob: Blob; name: string }> {
  if (type === 'svg' || file.size <= 96 * 1024) return { blob: file, name: file.name };
  const mime = CANVAS_TYPE[type];
  if (!mime) return { blob: file, name: file.name };

  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return { blob: file, name: file.name };
  const scale = Math.min(1, AVATAR_TARGET_PX / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return { blob: file, name: file.name };
  // A JPEG has no alpha channel: paint white first or a transparent logo comes
  // back black.
  if (type === 'jpeg') {
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
  }
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, 0.92));
  if (!blob || blob.size >= file.size) return { blob: file, name: file.name };
  // The extension has to survive the re-encode, because the server checks the
  // name against the bytes it receives.
  const extension = type === 'jpeg' ? (/\.(jpe?g)$/i.test(file.name) ? file.name.match(/\.(jpe?g)$/i)![1]! : 'jpg') : type;
  const base = file.name.replace(/\.[^.]+$/, '');
  return { blob, name: `${base}.${extension}` };
}

export function AvatarPicker({
  avatar,
  name,
  onChange,
}: {
  avatar: AvatarState;
  name: string;
  onChange: (avatar: AvatarState) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  // A local preview of the picked file, revoked when it is replaced or on unmount.
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const accept = useCallback(
    async (file: File | null | undefined) => {
      if (!file) return;
      setError(null);
      setNotice(null);

      // The policy, on the file exactly as it was chosen: name, declared type,
      // size and the bytes' own signature. This is the same function the Worker
      // runs, so nothing is accepted here that will be refused there.
      const bytes = new Uint8Array(await file.arrayBuffer().catch(() => new ArrayBuffer(0)));
      const checked = validateAvatar({ filename: file.name, mime: file.type, bytes });
      if (!checked.ok) {
        setError(checked.reason);
        return;
      }

      setBusy(true);
      try {
        const scaled = await downscale(file, checked.type);
        if (scaled.blob.size > (checked.type === 'svg' ? AVATAR_SVG_MAX_BYTES : AVATAR_MAX_BYTES)) {
          setError(`That picture is still ${Math.round(scaled.blob.size / 1024)} KB after resizing. Pick a smaller one.`);
          return;
        }
        const form = new FormData();
        form.append('file', scaled.blob, scaled.name);
        const result = await learnApi.uploadAvatar(form);
        onChange(result.avatar);
        setNotice(`“${result.avatar.filename}” is now your avatar.`);
      } catch (cause) {
        setError(describeError(cause));
      } finally {
        setBusy(false);
      }
    },
    [onChange],
  );

  const pickPreset = async (preset: string) => {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const result = await learnApi.setAvatarPreset(preset);
      onChange(result.avatar);
      setNotice('Preset chosen.');
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setError(null);
    setBusy(true);
    try {
      const result = await learnApi.clearAvatar();
      onChange(result.avatar);
      setNotice('Avatar removed — your initials are back.');
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      if (preview) URL.revokeObjectURL(preview);
      setPreview(URL.createObjectURL(file));
      void accept(file);
    }
  };

  return (
    <div className="avatar-picker">
      <div className="avatar-picker__now">
        <Avatar name={name} avatar={avatar} size={88} />
        <div className="avatar-picker__meta">
          <b>{name || 'Your name'}</b>
          {avatar.kind === 'UPLOAD' ? (
            <span className="muted small">
              {avatar.filename || 'uploaded picture'} · {Math.max(1, Math.round(avatar.bytes / 1024))} KB · {avatar.mime}
            </span>
          ) : avatar.kind === 'PRESET' ? (
            <span className="muted small">Preset · {avatar.preset}</span>
          ) : (
            <span className="muted small">No picture yet — your initials are showing.</span>
          )}
          <div className="avatar-picker__actions">
            <Button size="sm" variant="primary" loading={busy} onClick={() => inputRef.current?.click()}>
              <Icon name="camera" size={14} />
              Upload a picture
            </Button>
            {avatar.kind ? (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void remove()}>
                <Icon name="trash" size={13} />
                Remove
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <div
        className={`avatar-picker__drop${dragging ? ' is-over' : ''}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <Icon name="image" size={18} />
        <span>
          Drop a picture here, or choose one. Accepted: <b>{AVATAR_EXTENSIONS.join(', ')}</b> — and only those. A name like{' '}
          <code>photo.php.jpg</code> is refused, whatever the file turns out to be.
        </span>
        {preview ? <img className="avatar-picker__preview" src={preview} alt="The picture you just chose" /> : null}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={AVATAR_ACCEPT}
        className="avatar-picker__input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) {
            if (preview) URL.revokeObjectURL(preview);
            setPreview(URL.createObjectURL(file));
            void accept(file);
          }
        }}
      />

      <fieldset className="avatar-picker__presets" disabled={busy}>
        <legend>
          <Icon name="palette" size={13} /> Or pick a creature — nothing to upload
        </legend>
        <div className="avatar-picker__grid">
          {AVATAR_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className={`avatar-chip${avatar.kind === 'PRESET' && avatar.preset === preset ? ' is-on' : ''}`}
              aria-pressed={avatar.kind === 'PRESET' && avatar.preset === preset}
              onClick={() => void pickPreset(preset)}
            >
              <Mascot variant={preset} mood="idle" size={44} />
              <span>{preset}</span>
            </button>
          ))}
        </div>
      </fieldset>

      {error ? (
        <p className="avatar-picker__message avatar-picker__message--bad" role="alert">
          <Icon name="noEntry" size={14} /> {error}
        </p>
      ) : null}
      {notice && !error ? (
        <p className="avatar-picker__message avatar-picker__message--good" role="status">
          <Icon name="checkCircle" size={14} /> {notice}
        </p>
      ) : null}
    </div>
  );
}
