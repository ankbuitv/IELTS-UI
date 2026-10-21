import { useState } from 'react';
import { initials } from '../lib/format';
import { Icon, type IconName } from './Icon';

/** `/api/files/avatar/:userId?v=…` — the `v` busts caches after a new upload. */
export function avatarSrc(userId: string | undefined, avatarUpdatedAt: string | null | undefined): string | null {
  if (!userId || !avatarUpdatedAt) return null;
  return `/api/files/avatar/${encodeURIComponent(userId)}?v=${encodeURIComponent(avatarUpdatedAt)}`;
}

interface UserAvatarProps {
  /** Preferred: enough to build the picture URL server-side rows already carry. */
  userId?: string;
  avatarUpdatedAt?: string | null;
  /** Direct URL (the signed-in user's own avatar comes with `avatarUrl`). */
  src?: string | null;
  name: string;
  size?: number;
  /** Fallback tile: gradient violet (default), sunny or coral. */
  tone?: 'violet' | 'sun' | 'coral' | 'slate';
  icon?: IconName;
  title?: string;
  className?: string;
}

/**
 * A round profile picture with an initials (or icon) tile as the fallback —
 * every list in the app can show people without requiring an upload.
 */
export function UserAvatar({
  userId,
  avatarUpdatedAt,
  src,
  name,
  size = 38,
  tone = 'violet',
  icon,
  title,
  className = '',
}: UserAvatarProps) {
  const [failed, setFailed] = useState(false);
  const url = src ?? avatarSrc(userId, avatarUpdatedAt);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.36) };

  if (url && !failed) {
    return (
      <img
        className={`user-avatar user-avatar--img ${className}`.trim()}
        style={style}
        src={url}
        alt={name}
        title={title ?? name}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <span
      className={`user-avatar user-avatar--${tone} ${className}`.trim()}
      style={style}
      title={title ?? name}
      aria-hidden="true"
    >
      {icon ? <Icon name={icon} size={Math.round(size * 0.5)} /> : initials(name)}
    </span>
  );
}
