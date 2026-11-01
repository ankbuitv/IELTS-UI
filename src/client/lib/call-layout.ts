/** Select the main tile for a viewer, without changing anyone else's layout. */
export function selectCallFocus(input: {
  layout: 'auto' | 'grid';
  isClass: boolean;
  selfId?: string;
  hostId?: string;
  selfScreenOn: boolean;
  peers: readonly { userId: string }[];
  participants: readonly { userId: string; screenOn: boolean }[];
}): { featuredId?: string; selfPresenting: boolean; selfFocus: boolean } {
  if (input.layout === 'grid') return { selfPresenting: false, selfFocus: false };
  const selfPresenting = input.selfScreenOn;
  const presenterId = input.participants.find((participant) =>
    participant.userId !== input.selfId && participant.screenOn && input.peers.some((peer) => peer.userId === participant.userId),
  )?.userId;
  const remoteHost = input.isClass && input.hostId !== input.selfId && input.peers.some((peer) => peer.userId === input.hostId)
    ? input.hostId : undefined;
  return {
    featuredId: selfPresenting ? undefined : presenterId ?? remoteHost,
    selfPresenting,
    selfFocus: !selfPresenting && !presenterId && input.isClass && !!input.selfId && input.hostId === input.selfId,
  };
}
