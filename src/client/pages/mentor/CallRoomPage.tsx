import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { mentorApi } from '../../lib/mentor-api';
import { describeError } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { Button, Loading, Notice } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { MentorAvatar, formatWhen } from '../../components/mentor/MentorBits';
import { UserAvatar } from '../../components/UserAvatar';
import type { MentorChatMessage, MentorRoomState, MentorSignal, RoomParticipant } from '@shared/mentor';

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];
const POLL_MS = 1500;

interface Peer {
  userId: string;
  displayName: string;
  stream: MediaStream;
}

/**
 * The call room — a live video session (1-on-1 coaching or a class room).
 *
 * Media is peer-to-peer WebRTC (mesh) with D1 relaying the SDP/ICE signalling
 * envelopes. The implementation follows the "perfect negotiation" pattern:
 * - ICE candidates that arrive before the remote description are queued;
 * - glare is resolved with rollback on the polite peer (the larger user id);
 * - tracks that appear after connecting (late camera, screen share) trigger a
 *   renegotiation so they are actually sent;
 * - each tile only shows its avatar fallback while no live video track flows,
 *   so a shared screen is never hidden behind a placeholder.
 */
export function CallRoomPage() {
  const { sessionId = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [phase, setPhase] = useState<'loading' | 'prejoin' | 'room' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [state, setState] = useState<MentorRoomState | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [screenOn, setScreenOn] = useState(false);
  const [handRaised, setHandRaised] = useState(false);
  const [panel, setPanel] = useState<'chat' | 'notes' | 'people'>('chat');
  const [panelOpen, setPanelOpen] = useState(() => typeof window === 'undefined' || window.innerWidth > 900);
  const [reactions, setReactions] = useState<Array<{ key: number; emoji: string; name: string }>>([]);
  const reactionSeqRef = useRef(0);
  const [kicked, setKicked] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [notes, setNotes] = useState('');
  const [peers, setPeers] = useState<Peer[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [joinBusy, setJoinBusy] = useState(false);

  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const pcsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const participantsRef = useRef<MentorRoomState['participants']>([]);
  const lastSignalIdRef = useRef<string | null>(null);
  const sessionRef = useRef<string>(sessionId);
  const leftRef = useRef(false);

  useEffect(() => {
    sessionRef.current = sessionId;
  }, [sessionId]);

  const selfId = user?.id ?? '';

  // ---------------------------------------------------------------- media
  const stopMedia = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    screenStreamRef.current = null;
  }, []);

  /** Put the right stream under the self tile: the screen while sharing, else the camera. */
  const attachSelf = useCallback(() => {
    const el = localVideoRef.current;
    if (!el) return;
    const stream = screenStreamRef.current ?? localStreamRef.current;
    if (el.srcObject !== stream) el.srcObject = stream;
    // React renders `muted` as an attribute; the autoplay policy reads the DOM
    // property. Setting it here (and starting playback explicitly) is what makes
    // the local preview show up on desktop Chrome — without it the tile stays
    // black even though the camera light is on.
    el.muted = true;
    void el.play().catch(() => undefined);
  }, []);

  const startMedia = useCallback(async (force = false): Promise<MediaStream | null> => {
    if (localStreamRef.current && !force) {
      // A stream whose tracks were stopped (device unplug, permission revoked)
      // must be re-acquired, not reused.
      const stale = localStreamRef.current.getTracks().every((track) => track.readyState === 'ended');
      if (!stale) return localStreamRef.current;
    }
    if (force) {
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
    const explain = (cause: unknown) => {
      const name = (cause as { name?: string } | null)?.name ?? '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        return 'Camera/microphone permission was blocked. Click the camera icon in the address bar to allow it — inside a previewed iframe the host must also allow camera access.';
      }
      if (name === 'NotReadableError' || name === 'AbortError') {
        return 'Your camera or microphone is busy in another app. Close it there, then press “Try camera again”.';
      }
      return 'Camera and microphone are unavailable — you can still join and use chat.';
    };
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      localStreamRef.current = stream;
      const [videoTrack] = stream.getVideoTracks();
      if (videoTrack) videoTrack.onended = () => setCamOn(false);
      setMediaError(null);
      return stream;
    } catch (cause) {
      try {
        const audioOnly = await navigator.mediaDevices.getUserMedia({ audio: true });
        localStreamRef.current = audioOnly;
        setCamOn(false);
        setMediaError(explain(cause));
        return audioOnly;
      } catch (audioCause) {
        setMicOn(false);
        setCamOn(false);
        setMediaError(explain(audioCause));
        return null;
      }
    }
  }, []);

  // Media is requested as soon as the prejoin screen appears, so the preview is
  // live and the toggles really control the device before anyone else joins.
  useEffect(() => {
    if (phase !== 'prejoin' && phase !== 'room') return;
    void startMedia().then(() => attachSelf());
  }, [phase, startMedia, attachSelf]);

  /** "Try camera again" after a failure — re-acquires devices and re-attaches.
   * The room poll re-syncs the peer senders with the fresh tracks within a beat. */
  const retryMedia = async () => {
    const stream = await startMedia(true);
    if (stream) {
      setCamOn(stream.getVideoTracks().length > 0);
      setMicOn(stream.getAudioTracks().length > 0);
    }
    attachSelf();
  };

  // If the OS hands the camera to another app mid-call, come back automatically.
  useEffect(() => {
    const onDeviceChange = () => {
      const stream = localStreamRef.current;
      if (stream && stream.getTracks().every((track) => track.readyState === 'ended')) {
        void retryMedia();
      }
    };
    navigator.mediaDevices?.addEventListener?.('devicechange', onDeviceChange);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', onDeviceChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------- WebRTC plumbing
  /** Create (or fetch) the peer connection for a remote user. */
  const addPeer = useCallback(
    (userId: string, displayName: string): RTCPeerConnection => {
      const existing = pcsRef.current.get(userId);
      if (existing) return existing;
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      pcsRef.current.set(userId, pc);

      const remoteStream = new MediaStream();
      pc.ontrack = (event) => {
        // Reuse the same track objects so <video> keeps playing across renegotiations.
        if (!remoteStream.getTracks().includes(event.track)) remoteStream.addTrack(event.track);
        event.track.addEventListener('mute', () => {
          setPeers((prev) => [...prev.filter((p) => p.userId !== userId), { userId, displayName, stream: remoteStream }]);
        });
        event.track.addEventListener('unmute', () => {
          setPeers((prev) => [...prev.filter((p) => p.userId !== userId), { userId, displayName, stream: remoteStream }]);
        });
        setPeers((prev) => [...prev.filter((p) => p.userId !== userId), { userId, displayName, stream: remoteStream }]);
      };
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          void mentorApi
            .signal(sessionRef.current, { kind: 'CANDIDATE', targetId: userId, payload: JSON.stringify(event.candidate) })
            .catch(() => undefined);
        }
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          pc.close();
          pcsRef.current.delete(userId);
          setPeers((prev) => prev.filter((peer) => peer.userId !== userId));
        }
      };

      // Attach whatever media is available now; late tracks are added by syncSenders.
      const local = localStreamRef.current;
      local?.getTracks().forEach((track) => pc.addTrack(track, local));
      return pc;
    },
    [],
  );

  /** Offer from this side (perfect negotiation: both may offer; the polite peer rolls back on glare). */
  const negotiate = useCallback(
    async (userId: string) => {
      const pc = pcsRef.current.get(userId);
      if (!pc || pc.signalingState !== 'stable') return;
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await mentorApi.signal(sessionRef.current, { kind: 'OFFER', targetId: userId, payload: JSON.stringify(offer) });
      } catch {
        // The next poll or track change retries.
      }
    },
    [],
  );

  /** Add any local tracks the connection is missing (late camera, first media, screen). */
  const syncSenders = useCallback(
    (userId: string) => {
      const pc = pcsRef.current.get(userId);
      const local = localStreamRef.current;
      if (!pc || !local) return;
      let added = false;
      for (const track of local.getTracks()) {
        const has = pc.getSenders().some((sender) => sender.track?.kind === track.kind);
        if (!has) {
          pc.addTrack(track, local);
          added = true;
        }
      }
      if (added) void negotiate(userId);
    },
    [negotiate],
  );

  const flushCandidates = useCallback(async (userId: string, pc: RTCPeerConnection) => {
    const queued = pendingCandidatesRef.current.get(userId);
    if (!queued?.length) return;
    pendingCandidatesRef.current.set(userId, []);
    for (const candidate of queued) {
      try {
        await pc.addIceCandidate(candidate);
      } catch {
        // Stale candidate — drop it.
      }
    }
  }, []);

  const handleSignal = useCallback(
    async (signal: MentorSignal) => {
      const fromName = participantsRef.current.find((p) => p.userId === signal.senderId)?.displayName ?? 'Guest';
      const pc = addPeer(signal.senderId, fromName);
      const polite = selfId > signal.senderId;

      try {
        if (signal.kind === 'OFFER') {
          if (pc.signalingState !== 'stable') {
            if (!polite) return; // impolite peer keeps its own offer; the other side rolls back
            await pc.setLocalDescription({ type: 'rollback' } as RTCSessionDescriptionInit);
          }
          await pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(signal.payload)));
          await flushCandidates(signal.senderId, pc);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await mentorApi.signal(sessionRef.current, {
            kind: 'ANSWER',
            targetId: signal.senderId,
            payload: JSON.stringify(answer),
          });
          syncSenders(signal.senderId);
        } else if (signal.kind === 'ANSWER') {
          if (pc.signalingState === 'have-local-offer') {
            await pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(signal.payload)));
            await flushCandidates(signal.senderId, pc);
          }
        } else if (signal.kind === 'CANDIDATE') {
          const candidate = JSON.parse(signal.payload) as RTCIceCandidateInit;
          if (!pc.remoteDescription) {
            const queued = pendingCandidatesRef.current.get(signal.senderId) ?? [];
            queued.push(candidate);
            pendingCandidatesRef.current.set(signal.senderId, queued);
          } else {
            await pc.addIceCandidate(candidate);
          }
        } else if (signal.kind === 'BYE') {
          pc.close();
          pcsRef.current.delete(signal.senderId);
          setPeers((prev) => prev.filter((peer) => peer.userId !== signal.senderId));
        } else if (signal.kind === 'MUTE_MIC' || signal.kind === 'UNMUTE_MIC') {
          // The mentor is managing this mic — obey silently.
          if (!signal.targetId || signal.targetId === selfId) {
            const on = signal.kind === 'UNMUTE_MIC';
            setMicOn(on);
            localStreamRef.current?.getAudioTracks().forEach((track) => {
              track.enabled = on;
            });
          }
        } else if (signal.kind === 'KICK') {
          if (!signal.targetId || signal.targetId === selfId) {
            setKicked(signal.payload === 'banned' ? 'banned' : 'kicked');
          } else {
            // Everyone else just sees the tile disappear on the next poll.
          }
        } else if (signal.kind === 'REACTION') {
          const emoji = signal.payload.slice(0, 8);
          const name = participantsRef.current.find((p) => p.userId === signal.senderId)?.displayName ?? 'Guest';
          const key = ++reactionSeqRef.current;
          setReactions((prev) => [...prev.slice(-12), { key, emoji, name }]);
          window.setTimeout(() => setReactions((prev) => prev.filter((item) => item.key !== key)), 3200);
        } else if (signal.kind === 'HAND') {
          // Presence carries the flag; a signal makes it visible within a beat.
          setState((prev) =>
            prev
              ? {
                  ...prev,
                  participants: prev.participants.map((p) =>
                    p.userId === signal.senderId ? { ...p, handRaised: signal.payload === 'up' } : p,
                  ),
                }
              : prev,
          );
        }
      } catch {
        // A malformed or stale envelope is dropped: the next poll re-syncs.
      }
    },
    [addPeer, selfId, flushCandidates, syncSenders],
  );

  // ---------------------------------------------------------------- poll
  useEffect(() => {
    if (phase !== 'room' || !selfId) return;
    let alive = true;
    const tick = async () => {
      try {
        const next = await mentorApi.room(sessionId, lastSignalIdRef.current ?? undefined);
        if (!alive) return;
        participantsRef.current = next.participants;
        setState(next);
        const newest = next.signals.at(-1);
        if (newest) lastSignalIdRef.current = newest.id;
        for (const signal of next.signals) await handleSignal(signal);

        const presentIds = new Set(next.participants.map((p) => p.userId));
        // Everyone present (except me) gets a connection; the smaller id initiates
        // to avoid both sides offering at the exact same moment.
        for (const participant of next.participants) {
          if (participant.userId === selfId) continue;
          addPeer(participant.userId, participant.displayName);
          syncSenders(participant.userId);
          if (!pcsRef.current.get(participant.userId)?.remoteDescription && selfId < participant.userId) {
            void negotiate(participant.userId);
          }
        }
        // A peer that vanished from presence has really left: drop the tile now.
        setPeers((prev) => prev.filter((peer) => presentIds.has(peer.userId)));
        for (const [peerId, pc] of pcsRef.current) {
          if (!presentIds.has(peerId)) {
            pc.close();
            pcsRef.current.delete(peerId);
            pendingCandidatesRef.current.delete(peerId);
          }
        }
      } catch {
        // Polling hiccup: the next tick retries.
      }
    };
    void tick();
    const interval = window.setInterval(() => void tick(), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [phase, sessionId, selfId, addPeer, handleSignal, syncSenders, negotiate]);

  // Session clock.
  useEffect(() => {
    if (phase !== 'room') return;
    const started = state?.session.startedAt ?? state?.session.startsAt;
    const base = started ? new Date(started).getTime() : Date.now();
    const timer = window.setInterval(() => setElapsed(Math.max(0, Math.floor((Date.now() - base) / 1000))), 1000);
    return () => window.clearInterval(timer);
  }, [phase, state?.session.startedAt, state?.session.startsAt]);

  // First load: fetch the room (authz happens server side) to reach prejoin.
  useEffect(() => {
    let alive = true;
    mentorApi
      .room(sessionId)
      .then((data) => {
        if (!alive) return;
        setState(data);
        const me = data.participants.find((p) => p.userId === selfId);
        if (me) setHandRaised(me.handRaised);
        setPhase('prejoin');
      })
      .catch((cause) => {
        if (!alive) return;
        setError(describeError(cause));
        setPhase('error');
      });
    return () => {
      alive = false;
    };
  }, [sessionId, selfId]);

  // Mic/cam toggles push straight onto the live tracks.
  useEffect(() => {
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = micOn;
    });
  }, [micOn]);
  useEffect(() => {
    localStreamRef.current?.getVideoTracks().forEach((track) => {
      track.enabled = camOn;
    });
  }, [camOn]);

  // Best-effort goodbye when the tab is closed, so tiles disappear immediately.
  useEffect(() => {
    const bye = () => {
      if (leftRef.current) return;
      pcsRef.current.forEach((_pc, peerId) => {
        void mentorApi.signal(sessionRef.current, { kind: 'BYE', targetId: peerId, payload: '' }).catch(() => undefined);
      });
      void mentorApi.leave(sessionRef.current).catch(() => undefined);
    };
    window.addEventListener('pagehide', bye);
    return () => window.removeEventListener('pagehide', bye);
  }, []);

  // Clean up media + peers on exit.
  useEffect(
    () => () => {
      pcsRef.current.forEach((pc) => pc.close());
      pcsRef.current.clear();
      stopMedia();
    },
    [stopMedia],
  );

  const join = async () => {
    setJoinBusy(true);
    const stream = await startMedia();
    try {
      await mentorApi.join(sessionId);
      setPhase('room');
      // Tracks are attached by the effect/callback refs on mount; make sure the
      // connection to an already-present peer renegotiates with the real media.
      requestAnimationFrame(() => {
        attachSelf();
        pcsRef.current.forEach((_pc, peerId) => syncSenders(peerId));
      });
    } catch (cause) {
      setError(describeError(cause));
      setPhase('error');
    } finally {
      setJoinBusy(false);
      if (stream) attachSelf();
    }
  };

  const leave = async () => {
    if (leftRef.current) return;
    leftRef.current = true;
    pcsRef.current.forEach((pc, peerId) => {
      void mentorApi.signal(sessionId, { kind: 'BYE', targetId: peerId, payload: '' }).catch(() => undefined);
      pc.close();
    });
    pcsRef.current.clear();
    stopMedia();
    try {
      await mentorApi.leave(sessionId);
    } catch {
      // Leaving is best-effort; presence times out on its own.
    }
    navigate('/my-sessions');
  };

  const toggleScreen = async () => {
    if (screenOn) {
      screenStreamRef.current?.getTracks().forEach((track) => track.stop());
      screenStreamRef.current = null;
      setScreenOn(false);
      attachSelf();
      // Restore the camera track on every peer.
      const video = localStreamRef.current?.getVideoTracks()[0];
      pcsRef.current.forEach((pc) => {
        const sender = pc.getSenders().find((item) => item.track?.kind === 'video');
        if (sender && video) void sender.replaceTrack(video);
      });
      return;
    }
    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      screenStreamRef.current = screen;
      setScreenOn(true);
      const [track] = screen.getVideoTracks();
      pcsRef.current.forEach((pc) => {
        const sender = pc.getSenders().find((item) => item.track?.kind === 'video');
        if (sender && track) {
          void sender.replaceTrack(track);
        } else if (track) {
          pc.addTrack(track, screen);
          void negotiate(
            [...pcsRef.current.entries()].find(([, item]) => item === pc)?.[0] ?? '',
          );
        }
      });
      if (track) track.onended = () => void toggleScreen();
      attachSelf();
    } catch {
      // The user declined the picker.
    }
  };

  const toggleHand = async () => {
    const next = !handRaised;
    setHandRaised(next);
    try {
      await mentorApi.raiseHand(sessionId, next);
      await mentorApi.signal(sessionId, { kind: 'HAND', targetId: null, payload: next ? 'up' : 'down' });
    } catch {
      setHandRaised(!next);
    }
  };

  /** Fire a floating emoji everyone in the room sees. */
  const sendReaction = async (emoji: string) => {
    const key = ++reactionSeqRef.current;
    setReactions((prev) => [...prev.slice(-12), { key, emoji, name: 'You' }]);
    window.setTimeout(() => setReactions((prev) => prev.filter((item) => item.key !== key)), 3200);
    try {
      await mentorApi.signal(sessionId, { kind: 'REACTION', targetId: null, payload: emoji });
    } catch {
      // Reactions are best-effort.
    }
  };

  /** Mentor-only: force-mute / restore a member's microphone. */
  const forceMute = async (targetId: string, muted: boolean) => {
    try {
      await mentorApi.signal(sessionId, { kind: muted ? 'MUTE_MIC' : 'UNMUTE_MIC', targetId, payload: '' });
    } catch {
      setError('Could not reach that participant.');
    }
  };

  /** Mentor-only: remove someone from the room, optionally banning them. */
  const removeParticipant = async (targetId: string, ban: boolean) => {
    const question = ban
      ? 'Ban this person from the room? They cannot rejoin this session.'
      : 'Remove this person from the room?';
    if (!window.confirm(question)) return;
    try {
      await mentorApi.kick(sessionId, targetId, ban);
    } catch (cause) {
      setError(describeError(cause));
    }
  };

  const send = async () => {
    const body = draft.trim();
    if (!body) return;
    setDraft('');
    try {
      const { message } = await mentorApi.sendMessage(sessionId, body);
      setState((prev) => {
        if (!prev) return prev;
        const withoutDupes = prev.messages.filter((item) => item.id !== message.id);
        return { ...prev, messages: [...withoutDupes, message] };
      });
    } catch (cause) {
      setError(describeError(cause));
    }
  };

  const saveNotes = async () => {
    try {
      const { message } = await mentorApi.sendMessage(sessionId, notes, 'NOTE');
      setState((prev) => (prev ? { ...prev, messages: [...prev.messages, message] } : prev));
      setNotes('');
    } catch (cause) {
      setError(describeError(cause));
    }
  };

  // Auto-scroll the chat to the newest message.
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: 'nearest' });
  }, [state?.messages.length]);

  const clock = useMemo(() => {
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }, [elapsed]);

  const session = state?.session;
  const isMentor = session?.mentorId === user?.id;
  const isClass = session?.kind === 'CLASS';

  // Roster = server presence ∪ live peer connections ∪ me. The chip can never
  // disagree with the tiles on screen.
  const roster = useMemo(() => {
    const byId = new Map<string, RoomParticipant>();
    for (const participant of state?.participants ?? []) byId.set(participant.userId, participant);
    for (const peer of peers) {
      if (!byId.has(peer.userId)) {
        byId.set(peer.userId, {
          userId: peer.userId,
          displayName: peer.displayName,
          role: 'MEMBER',
          avatarUpdatedAt: null,
          handRaised: false,
          joinedAt: '',
        });
      }
    }
    if (selfId && !byId.has(selfId)) {
      byId.set(selfId, {
        userId: selfId,
        displayName: user?.displayName ?? 'You',
        role: user?.role ?? 'STUDENT',
        avatarUpdatedAt: null,
        handRaised,
        joinedAt: '',
      });
    }
    return [...byId.values()];
  }, [state?.participants, peers, selfId, user?.displayName, handRaised]);

  if (phase === 'loading') {
    return <Loading label="Opening the call room…" />;
  }

  if (phase === 'error') {
    return (
      <div className="stack" style={{ maxWidth: 560, margin: '60px auto' }}>
        <Notice tone="danger" title="Cannot open this room">
          {error ?? 'This session is not available.'}
        </Notice>
        <Button onClick={() => navigate('/my-sessions')}>Back to my sessions</Button>
      </div>
    );
  }

  if (kicked) {
    return (
      <div className="stack" style={{ maxWidth: 520, margin: '80px auto', textAlign: 'center' }}>
        <Notice tone="danger" title={kicked === 'banned' ? 'You were banned from this room' : 'You were removed from this room'}>
          The mentor {kicked === 'banned' ? 'banned' : 'removed'} you from this session. If you think this is a mistake,
          contact your mentor or an administrator.
        </Notice>
        <Button onClick={() => navigate('/my-sessions')}>Back to my sessions</Button>
      </div>
    );
  }

  if (phase === 'prejoin') {
    return (
      <div className="room-prejoin">
        <div className="room-prejoin__card">
          <div className="room-prejoin__preview">
            <video
              ref={(el) => {
                localVideoRef.current = el;
                if (el && localStreamRef.current && el.srcObject !== localStreamRef.current) {
                  el.srcObject = localStreamRef.current;
                }
              }}
              autoPlay
              playsInline
              muted
            />
            {!camOn ? (
              <div className="room-tile__avatar">
                <UserAvatar src={user?.avatarUrl ?? null} userId={user?.id} name={user?.displayName ?? 'Me'} size={80} />
              </div>
            ) : null}
          </div>
          <div>
            <span className="mchip mchip--sun">
              <Icon name="clock" size={12} />
              {session ? formatWhen(session.startsAt) : ''}
            </span>
            <h2 style={{ margin: '12px 0 6px' }}>{session?.topic ?? 'Coaching session'}</h2>
            <p>
              {isMentor
                ? `You are about to host this session with ${session?.studentName ?? 'your student'}.`
                : `You are about to join ${session?.mentorName ?? 'your mentor'} for a live video session.`}
            </p>
            {mediaError ? (
              <div className="stack" style={{ gap: 8 }}>
                <Notice tone="warning">{mediaError}</Notice>
                <div>
                  <Button size="sm" variant="secondary" onClick={() => void retryMedia()}>
                    <Icon name="rotate" size={14} />
                    Try camera again
                  </Button>
                </div>
              </div>
            ) : null}
            <div className="room-prejoin__toggles">
              <button
                type="button"
                className={`room-btn${micOn ? '' : ' room-btn--off'}`}
                onClick={() => setMicOn((value) => !value)}
                aria-label={micOn ? 'Mute' : 'Unmute'}
              >
                <Icon name="mic" size={20} />
              </button>
              <button
                type="button"
                className={`room-btn${camOn ? '' : ' room-btn--off'}`}
                onClick={() => setCamOn((value) => !value)}
                aria-label={camOn ? 'Camera off' : 'Camera on'}
              >
                <Icon name="video" size={20} />
              </button>
            </div>
            <Button variant="primary" size="lg" loading={joinBusy} onClick={() => void join()}>
              <Icon name="video" size={17} />
              Join now
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="room">
      <header className="room__topbar">
        <div className="row" style={{ gap: 10, alignItems: 'center' }}>
          <Icon name="video" size={18} />
          <strong>{session?.topic ?? 'Session'}</strong>
          <span className="mchip mchip--coral">
            <span className="dot" /> LIVE
          </span>
          <span className="mchip">{clock}</span>
        </div>
        <div className="row" style={{ gap: 10, alignItems: 'center' }}>
          <span className="mchip">
            <Icon name="users" size={13} />
            {roster.length} in room
          </span>
          <button
            type="button"
            className={`room-btn room-btn--sm${panelOpen ? ' room-btn--active' : ''}`}
            onClick={() => setPanelOpen((value) => !value)}
            aria-label="Toggle side panel"
          >
            <Icon name="bubble" size={17} />
          </button>
        </div>
      </header>

      {error ? (
        <div style={{ padding: '8px 16px 0' }}>
          <Notice tone="danger">{error}</Notice>
        </div>
      ) : null}
      {mediaError ? (
        <div className="room__media-error">
          <span>{mediaError}</span>
          <button type="button" onClick={() => void retryMedia()}>
            Try camera again
          </button>
        </div>
      ) : null}
      <div className="room__reactions" aria-hidden="true">
        {reactions.map((item) => (
          <span key={item.key} className="room__reaction">
            <b>{item.emoji}</b>
            <i>{item.name}</i>
          </span>
        ))}
      </div>

      <div className="room__body">
        <div className={`room__stage${peers.length === 0 ? ' room__stage--solo' : ''}`}>
          <div className="room-tile room-tile--self">
            <video
              ref={(el) => {
                localVideoRef.current = el;
                if (el) {
                  const stream = screenStreamRef.current ?? localStreamRef.current;
                  if (el.srcObject !== stream) el.srcObject = stream;
                }
              }}
              autoPlay
              playsInline
              muted
            />
            {!camOn && !screenOn ? (
              <div className="room-tile__avatar">
                <UserAvatar src={user?.avatarUrl ?? null} userId={user?.id} name={user?.displayName ?? 'Me'} size={80} />
              </div>
            ) : null}
            <span className="room-tile__name">
              You ({user?.displayName ?? 'Me'})
              {screenOn ? <span className="room-tile__badge">screen</span> : null}
              {!micOn ? (
                <span className="room-tile__mic-off">
                  <Icon name="mic" size={13} />
                </span>
              ) : null}
            </span>
            {handRaised ? (
              <span className="room-tile__hand" title="Hand raised">
                <Icon name="hand" size={17} />
              </span>
            ) : null}
          </div>

          {peers.map((peer) => (
            <RemoteTile
              key={peer.userId}
              peer={peer}
              participant={state?.participants.find((p) => p.userId === peer.userId)}
            />
          ))}

          {peers.length === 0 ? (
            <div className="room-tile room-tile--waiting" style={{ gridColumn: '1 / -1', minHeight: 120 }}>
              <Icon name="users" size={26} />
              <div>
                <strong>
                  Waiting for {isClass ? 'class members' : isMentor ? 'your student' : 'your mentor'} to join…
                </strong>
                <div className="small" style={{ opacity: 0.75 }}>
                  The call connects automatically when they arrive. Keep this tab open.
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {panelOpen ? (
          <aside className="room__panel">
            <div className="room__panel-tabs" role="tablist">
              <button
                type="button"
                className="room__panel-close"
                onClick={() => setPanelOpen(false)}
                aria-label="Close panel"
              >
                <Icon name="close" size={16} />
              </button>
              {(['chat', 'notes', 'people'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={panel === tab}
                  className={`room__panel-tab${panel === tab ? ' active' : ''}`}
                  onClick={() => setPanel(tab)}
                >
                  {tab === 'chat' ? 'Chat' : tab === 'notes' ? 'Notes' : 'People'}
                </button>
              ))}
            </div>

            {panel === 'chat' ? (
              <>
                <div className="room__chat">
                  {(state?.messages ?? [])
                    .filter((message: MentorChatMessage) => message.kind !== 'NOTE')
                    .map((message) => (
                      <div
                        key={message.id}
                        className={`room-msg${message.senderId === user?.id ? ' room-msg--self' : ''}${
                          message.kind === 'SYSTEM' ? ' room-msg--system' : ''
                        }`}
                      >
                        <span className="room-msg__who">{message.senderName}</span>
                        <div className="room-msg__bubble">{message.body}</div>
                      </div>
                    ))}
                  <div ref={chatEndRef} />
                </div>
                <div className="room__composer">
                  <input
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        void send();
                      }
                    }}
                    placeholder="Write a message…"
                    aria-label="Chat message"
                  />
                  <button type="button" onClick={() => void send()} aria-label="Send message">
                    <Icon name="send" size={17} />
                  </button>
                </div>
              </>
            ) : null}

            {panel === 'notes' ? (
              <div className="room__notes">
                <p className="tiny" style={{ opacity: 0.7, margin: 0 }}>
                  Session notes are shared with both sides and kept on the session.
                </p>
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Vocabulary to revisit, essay structure notes, next actions…"
                  aria-label="Session notes"
                />
                <Button variant="primary" onClick={() => void saveNotes()} disabled={!notes.trim()}>
                  <Icon name="send" size={14} />
                  Save notes to session
                </Button>
                {(state?.messages ?? [])
                  .filter((message) => message.kind === 'NOTE')
                  .map((message) => (
                    <div key={message.id} className="room-msg" style={{ maxWidth: '100%' }}>
                      <span className="room-msg__who">
                        {message.senderName} · {formatWhen(message.createdAt)}
                      </span>
                      <div className="room-msg__bubble" style={{ whiteSpace: 'pre-wrap' }}>
                        {message.body}
                      </div>
                    </div>
                  ))}
              </div>
            ) : null}

            {panel === 'people' ? (
              <div className="room__roster">
                {[...roster]
                  .sort((a, b) => Number(b.handRaised) - Number(a.handRaised))
                  .map((participant) => {
                    const isSelf = participant.userId === user?.id;
                    const isHost = participant.userId === session?.mentorId;
                    const peerMicLive = peers.find((p) => p.userId === participant.userId)?.stream
                      .getAudioTracks()
                      .some((track) => track.enabled && !track.muted);
                    return (
                      <div
                        key={participant.userId}
                        className={`room-roster-item${participant.handRaised ? ' room-roster-item--hand' : ''}`}
                      >
                        <MentorAvatar
                          name={participant.displayName}
                          userId={participant.userId}
                          avatarUpdatedAt={participant.avatarUpdatedAt}
                          tone={isSelf ? 'sun' : isHost ? 'violet' : 'coral'}
                        />
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div className="room-roster-item__name">
                            {participant.displayName}
                            {isSelf ? ' (you)' : ''}
                          </div>
                          <div className="room-roster-item__role">
                            {isHost ? 'mentor · host' : isClass ? 'member' : isSelf ? 'you' : 'student'}
                            {' · '}
                            {isSelf ? (micOn ? 'mic on' : 'muted') : peerMicLive === false ? 'muted' : 'mic on'}
                          </div>
                        </div>
                        {participant.handRaised ? (
                          <span className="room-roster-item__hand" title="Hand raised">
                            ✋
                          </span>
                        ) : null}
                        {isMentor && !isSelf && !isHost ? (
                          <div className="room-roster-item__actions">
                            <button
                              type="button"
                              title={peerMicLive === false ? 'Unmute their microphone' : 'Mute their microphone'}
                              onClick={() => void forceMute(participant.userId, peerMicLive !== false)}
                            >
                              <Icon name={peerMicLive === false ? 'mic' : 'mic'} size={14} />
                            </button>
                            <button type="button" title="Remove from room" onClick={() => void removeParticipant(participant.userId, false)}>
                              <Icon name="logout" size={14} />
                            </button>
                            <button type="button" title="Kick and ban" onClick={() => void removeParticipant(participant.userId, true)}>
                              <Icon name="shieldCheck" size={14} />
                            </button>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
              </div>
            ) : null}
          </aside>
        ) : null}
      </div>

      <footer className="room__controls">
        <span className="room-btn-wrap">
          <button
            type="button"
            className={`room-btn${micOn ? '' : ' room-btn--off'}`}
            onClick={() => setMicOn((value) => !value)}
            aria-label={micOn ? 'Mute' : 'Unmute'}
          >
            <Icon name="mic" size={20} />
          </button>
          <span className="room-btn__label">{micOn ? 'Mute' : 'Unmute'}</span>
        </span>
        <span className="room-btn-wrap">
          <button
            type="button"
            className={`room-btn${camOn ? '' : ' room-btn--off'}`}
            onClick={() => setCamOn((value) => !value)}
            aria-label={camOn ? 'Camera off' : 'Camera on'}
          >
            <Icon name="video" size={20} />
          </button>
          <span className="room-btn__label">{camOn ? 'Camera off' : 'Camera on'}</span>
        </span>
        <span className="room-btn-wrap">
          <button
            type="button"
            className={`room-btn${screenOn ? ' room-btn--active' : ''}`}
            onClick={() => void toggleScreen()}
            aria-label="Share screen"
          >
            <Icon name="monitor" size={20} />
          </button>
          <span className="room-btn__label">{screenOn ? 'Stop sharing' : 'Share screen'}</span>
        </span>
        <span className="room-btn-wrap">
          <button
            type="button"
            className={`room-btn${handRaised ? ' room-btn--active' : ''}`}
            onClick={() => void toggleHand()}
            aria-label="Raise hand"
          >
            <Icon name="hand" size={20} />
          </button>
          <span className="room-btn__label">{handRaised ? 'Lower hand' : 'Raise hand'}</span>
        </span>
        <span className="room-btn-wrap">
          <button
            type="button"
            className={`room-btn${panelOpen && panel === 'chat' ? ' room-btn--active' : ''}`}
            onClick={() => {
              setPanel('chat');
              setPanelOpen((value) => !(value && panel === 'chat'));
            }}
            aria-label="Chat"
          >
            <Icon name="bubble" size={20} />
          </button>
          <span className="room-btn__label">Chat</span>
        </span>
        {isMentor ? (
          <span className="room-btn-wrap">
            <button
              type="button"
              className="room-btn"
              onClick={async () => {
                try {
                  await mentorApi.complete(sessionId);
                  await leave();
                } catch (cause) {
                  setError(describeError(cause));
                }
              }}
              aria-label="End session"
            >
              <Icon name="checkCircle" size={20} />
            </button>
            <span className="room-btn__label">End session</span>
          </span>
        ) : null}
        <span className="room-btn-wrap room-btn-wrap--reactions" aria-label="Send a reaction">
          <span className="room__emoji-bar">
            {['👍', '👏', '😄', '🎉', '❤️', '🔥', '🤔', '✋'].map((emoji) => (
              <button key={emoji} type="button" className="room__emoji-btn" onClick={() => void sendReaction(emoji)} aria-label={`React ${emoji}`}>
                {emoji}
              </button>
            ))}
          </span>
        </span>
        <button type="button" className="room-btn room-btn--leave" onClick={() => void leave()}>
          <Icon name="phoneOff" size={19} />
          Leave
        </button>
      </footer>
    </div>
  );
}

/**
 * One remote participant: the video fills the tile and the avatar fallback only
 * shows while no live video is arriving (camera off / still connecting) — a
 * shared screen must never hide behind a placeholder.
 */
function RemoteTile({ peer, participant }: { peer: Peer; participant?: RoomParticipant }) {
  const [live, setLive] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const stream = peer.stream;
    const evaluate = () => {
      const videos = stream.getVideoTracks();
      setLive(videos.some((track) => track.readyState === 'live' && !track.muted && track.enabled));
    };
    const el = videoRef.current;
    if (el) {
      if (el.srcObject !== stream) el.srcObject = stream;
      void el.play().catch(() => undefined);
    }
    evaluate();
    const tracks = stream.getTracks();
    for (const track of tracks) {
      track.addEventListener('mute', evaluate);
      track.addEventListener('unmute', evaluate);
      track.addEventListener('ended', evaluate);
    }
    stream.addEventListener('addtrack', evaluate);
    stream.addEventListener('removetrack', evaluate);
    return () => {
      for (const track of tracks) {
        track.removeEventListener('mute', evaluate);
        track.removeEventListener('unmute', evaluate);
        track.removeEventListener('ended', evaluate);
      }
      stream.removeEventListener('addtrack', evaluate);
      stream.removeEventListener('removetrack', evaluate);
    };
  }, [peer.stream]);

  return (
    <div className="room-tile">
      <video
        ref={(el) => {
          videoRef.current = el;
          if (el && el.srcObject !== peer.stream) el.srcObject = peer.stream;
        }}
        autoPlay
        playsInline
      />
      {!live ? (
        <div className="room-tile__avatar">
          <UserAvatar
            userId={peer.userId}
            avatarUpdatedAt={participant?.avatarUpdatedAt}
            name={peer.displayName}
            size={80}
          />
        </div>
      ) : null}
      <span className="room-tile__name">
        {peer.displayName}
        {participant?.handRaised ? <span className="room-tile__hand-inline">✋</span> : null}
      </span>
    </div>
  );
}

export default CallRoomPage;
