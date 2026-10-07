import type { FriendsResponse, PersonSummary, PublicProfile } from '@shared/social';
import { api, queryString } from './api';
import type { ProfileAvatarKey, ProfileBannerKey, ProfileEffect, ProfileNameColor } from '@shared/social';

export interface SocialProfilePatch {
  displayName?: string;
  avatarKey?: ProfileAvatarKey;
  bannerKey?: ProfileBannerKey;
  usernameColor?: ProfileNameColor;
  profileEffect?: ProfileEffect;
}

export const socialApi = {
  me: () => api.get<{ profile: PublicProfile }>('/api/social/me'),
  profile: (userId: string) => api.get<{ profile: PublicProfile }>(`/api/social/profiles/${encodeURIComponent(userId)}`),
  updateProfile: (input: SocialProfilePatch) => api.patch<{ profile: PublicProfile }>('/api/social/me', input),
  friends: () => api.get<FriendsResponse>('/api/social/friends'),
  search: (query: string) => api.get<{ people: PersonSummary[] }>(`/api/social/people${queryString({ q: query })}`),
  request: (userId: string) => api.post<{ ok: true }>('/api/social/friends/requests', { userId }),
  respond: (requestId: string, accept: boolean) =>
    api.post<{ ok: true }>(`/api/social/friends/requests/${encodeURIComponent(requestId)}/respond`, { accept }),
  remove: (userId: string) => api.delete<{ ok: true }>(`/api/social/friends/${encodeURIComponent(userId)}`),
};
