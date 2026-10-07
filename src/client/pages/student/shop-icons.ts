/** The icon that stands for a shop item, so the shelf and the lesson header agree. */
import type { ShopItemKey } from '@shared/shop';
import type { IconName } from '../../components/Icon';

export function itemIcon(key: ShopItemKey): IconName {
  switch (key) {
    case 'streak_freeze':
      return 'snowflake';
    case 'xp_boost':
      return 'bolt';
    case 'heart_refill':
      return 'heart';
    case 'hint':
      return 'bulb';
    case 'cosmetic_username_sunset':
    case 'cosmetic_username_ocean':
      return 'user';
    case 'cosmetic_profile_glow':
      return 'sparkle';
    case 'cosmetic_banner_sakura':
    case 'cosmetic_banner_midnight':
      return 'star';
  }
}
