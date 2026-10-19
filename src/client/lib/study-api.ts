import type {
  StudyGroupDetail,
  StudyGroupsOverview,
  StudyRoomDetail,
  StudyRoomsOverview,
} from '@shared/study';
import { api } from './api';
import { localDay } from './learn-api';

export const studyApi = {
  groups: () => api.get<StudyGroupsOverview>(`/api/study/groups?day=${localDay()}`),
  group: (groupId: string) => api.get<StudyGroupDetail>(`/api/study/groups/${encodeURIComponent(groupId)}`),
  createGroup: (input: { name: string; goal: string; targetBand: number }) =>
    api.post<StudyGroupDetail>('/api/study/groups', input),
  joinGroup: (groupId: string) => api.post<StudyGroupDetail>(`/api/study/groups/${encodeURIComponent(groupId)}/join`, {}),
  leaveGroup: (groupId: string) => api.delete<{ ok: true }>(`/api/study/groups/${encodeURIComponent(groupId)}/leave`),

  rooms: () => api.get<StudyRoomsOverview>(`/api/study/rooms?day=${localDay()}`),
  room: (roomId: string) => api.get<StudyRoomDetail>(`/api/study/rooms/${encodeURIComponent(roomId)}?day=${localDay()}`),
  createRoom: (input: { name: string; topic: string; focusMinutes: number; breakMinutes: number }) =>
    api.post<StudyRoomDetail>('/api/study/rooms', input),
  joinRoom: (roomId: string) =>
    api.post<StudyRoomDetail>(`/api/study/rooms/${encodeURIComponent(roomId)}/join`, { day: localDay() }),
  heartbeat: (roomId: string) =>
    api.post<StudyRoomDetail>(`/api/study/rooms/${encodeURIComponent(roomId)}/heartbeat`, { day: localDay() }),
  phase: (roomId: string, action: 'start' | 'skip' | 'stop') =>
    api.post<StudyRoomDetail>(`/api/study/rooms/${encodeURIComponent(roomId)}/phase?day=${localDay()}`, { action }),
  leaveRoom: (roomId: string) => api.delete<{ ok: true }>(`/api/study/rooms/${encodeURIComponent(roomId)}/leave`),
};
