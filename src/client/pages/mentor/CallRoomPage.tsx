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

/** Human, actionable copy for a getUserMedia failure. */
function describeDeviceError(kind: 'camera' | 'microphone', cause: unknown): string {
  const name = (cause as { name?: string } | null)?.name ?? '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return `Permission to use the ${kind} was blocked. Allow it from the camera icon in the address bar, then press "Try again". If this page is inside a preview panel, open the app in its own tab — the frame also needs camera/microphone permission.`;
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return `No ${kind} was found. Plug one in (or pick another device in Settings) and try again.`;
  }
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
    return `The ${kind} is busy in another app or tab (Zoom, Meet, Teams, Camera). Close it there and press "Try again".`;
  }
  if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
    return `The ${kind} does not support the requested quality. Pick another device in Settings.`;
  }
  return `The ${kind} could not start${name ? ` (${name})` : ''}. Pick another device in Settings.`;
}

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
  const [panelOpen, setPanelOpen] = useState(false);
  const [reactions, setReactions] = useState<Array<{ key: number; emoji: string; name: string }>>([]);
  const reactionSeqRef = useRef(0);
  const [kicked, setKicked] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [notes, setNotes] = useState('');
  const [peers, setPeers] = useState<Peer[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [joinBusy, setJoinBusy] = useState(false);
  // Device picker + dialogs (Jitsi-style room chrome).
  const [deviceList, setDeviceList] = useState<MediaDeviceInfo[]>([]);
  const [selectedCamera, setSelectedCamera] = useState('');
  const [selectedMic, setSelectedMic] = useState('');
  const [cameraIssue, setCameraIssue] = useState<string | null>(null);
  const [micIssue, setMicIssue] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [reactionsOpen, setReactionsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [switching, setSwitching] = useState(false);

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

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setDeviceList(list);
      setSelectedCamera((current) => current || list.find((item) => item.kind === 'videoinput')?.deviceId || '');
      setSelectedMic((current) => current || list.find((item) => item.kind === 'audioinput')?.deviceId || '');
    } catch {
      // Labels and ids stay hidden until permission is granted; nothing to do.
    }
  }, []);

  /**
   * Acquires the microphone and the camera **independently**.
   *
   * The previous version asked for both in one request and, on any failure,
   * retried with audio only — so a busy/blocked microphone made a perfectly
   * good camera look "unavailable". Now the common case is still one prompt,
   * but a failure is isolated per device and each device is retried with a
   * relaxed constraint before we report it as broken.
   */
  const startMedia = useCallback(
    async (
      force = false,
      overrides: { cameraId?: string; micId?: string } = {},
    ): Promise<MediaStream | null> => {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setMediaError(
          'Camera and microphone need a secure (https) page. Open the app directly in its own tab — an embedded preview must explicitly allow camera and microphone for the frame.',
        );
        setCameraIssue('Camera access is not available in this context.');
        setMicIssue('Microphone access is not available in this context.');
        setCamOn(false);
        setMicOn(false);
        return null;
      }

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

      const cameraId = overrides.cameraId ?? selectedCamera;
      const micId = overrides.micId ?? selectedMic;
      const videoConstraints: MediaTrackConstraints = cameraId
        ? { deviceId: { exact: cameraId }, width: { ideal: 1280 }, height: { ideal: 720 } }
        : { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } };
      const audioConstraints: MediaTrackConstraints = micId
        ? { deviceId: { exact: micId }, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        : { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

      let stream: MediaStream | null;
      // One prompt for both devices — the normal path.
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: audioConstraints });
      } catch {
        stream = null;
      }

      if (!stream) {
        let video: MediaStream | null = null;
        let audio: MediaStream | null = null;
        let videoError: unknown = null;
        let audioError: unknown = null;

        for (const constraints of [videoConstraints, true] as Array<boolean | MediaTrackConstraints>) {
          try {
            video = await navigator.mediaDevices.getUserMedia({ video: constraints });
            videoError = null;
            break;
          } catch (cause) {
            videoError = cause;
            const name = (cause as { name?: string } | null)?.name ?? '';
            // A permission block or a missing device will not improve by asking
            // again with different constraints.
            if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'NotFoundError') break;
          }
        }
        for (const constraints of [audioConstraints, true] as Array<boolean | MediaTrackConstraints>) {
          try {
            audio = await navigator.mediaDevices.getUserMedia({ audio: constraints });
            audioError = null;
            break;
          } catch (cause) {
            audioError = cause;
            const name = (cause as { name?: string } | null)?.name ?? '';
            if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'NotFoundError') break;
          }
        }

        const tracks = [...(video?.getVideoTracks() ?? []), ...(audio?.getAudioTracks() ?? [])];
        if (tracks.length > 0) stream = new MediaStream(tracks);

        setCameraIssue(video ? null : videoError ? describeDeviceError('camera', videoError) : null);
        setMicIssue(audio ? null : audioError ? describeDeviceError('microphone', audioError) : null);

        const problems: string[] = [];
        if (!video && videoError) problems.push(describeDeviceError('camera', videoError));
        if (!audio && audioError) problems.push(describeDeviceError('microphone', audioError));
        setMediaError(problems.length ? `${problems.join(' ')} You can still join and use chat.` : null);
      } else {
        setCameraIssue(null);
        setMicIssue(null);
        setMediaError(null);
      }

      if (!stream || stream.getTracks().length === 0) {
        setMicOn(false);
        setCamOn(false);
        return null;
      }

      stream.getVideoTracks().forEach((track) => {
        track.enabled = true;
        track.onended = () => {
          setCamOn(false);
          setCameraIssue('The camera disconnected. Reconnect it and press "Try again".');
        };
      });
      stream.getAudioTracks().forEach((track) => {
        track.enabled = true;
        track.onended = () => setMicOn(false);
      });

      localStreamRef.current = stream;
      setCamOn(stream.getVideoTracks().length > 0);
      setMicOn(stream.getAudioTracks().length > 0);
      void refreshDevices();
      return stream;
    },
    [refreshDevices, selectedCamera, selectedMic],
  );

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
      void refreshDevices();
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

  /** Swap every outgoing sender onto the freshly acquired tracks (device change). */
  const replaceOutgoingTracks = useCallback(() => {
    const local = localStreamRef.current;
    if (!local) return;
    pcsRef.current.forEach((pc, peerId) => {
      let added = false;
      for (const track of local.getTracks()) {
        const sender = pc.getSenders().find((item) => item.track?.kind === track.kind);
        if (sender) void sender.replaceTrack(track);
        else {
          pc.addTrack(track, local);
          added = true;
        }
      }
      if (added) void negotiate(peerId);
    });
  }, [negotiate]);

  /** Settings dialog: pick another camera/microphone without leaving the call. */
  const switchDevice = useCallback(
    async (kind: 'camera' | 'mic', deviceId: string) => {
      if (kind === 'camera') setSelectedCamera(deviceId);
      else setSelectedMic(deviceId);
      setSwitching(true);
      const stream = await startMedia(true, {
        cameraId: kind === 'camera' ? deviceId : selectedCamera,
        micId: kind === 'mic' ? deviceId : selectedMic,
      });
      if (stream) {
        replaceOutgoingTracks();
        attachSelf();
      }
      setSwitching(false);
    },
    [attachSelf, replaceOutgoingTracks, selectedCamera, selectedMic, startMedia],
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

  const roomLink =
    typeof window === 'undefined' ? '' : `${window.location.origin}/sessions/${sessionId}/room`;

  const copyRoomLink = async () => {
    try {
      await navigator.clipboard.writeText(roomLink);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy the link — select it and copy it manually.');
    }
  };

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
    const devicesReady = Boolean(camOn || micOn);
    const statusText = cameraIssue
      ? cameraIssue
      : micIssue
        ? micIssue
        : camOn && micOn
          ? 'Your devices are working properly'
          : camOn
            ? 'Camera ready — microphone is off'
            : micOn
              ? 'Microphone ready — camera is off'
              : 'Join with chat — no camera or microphone';

    return (
      <div className="jr jr--prejoin">
        <div className="jr-prejoin__stage">
          <video
            className={`jr-prejoin__video${camOn ? '' : ' is-hidden'}`}
            ref={(el) => {
              localVideoRef.current = el;
              if (el) {
                const stream = screenStreamRef.current ?? localStreamRef.current;
                if (el.srcObject !== stream) el.srcObject = stream;
                el.muted = true;
                void el.play().catch(() => undefined);
              }
            }}
            autoPlay
            playsInline
            muted
          />
          {!camOn ? (
            <div className="jr-prejoin__avatar">
              <UserAvatar
                src={user?.avatarUrl ?? null}
                userId={user?.id}
                name={user?.displayName ?? 'Me'}
                size={116}
              />
              <span>Camera is off</span>
            </div>
          ) : null}
          <span className="jr-prejoin__name">{user?.displayName ?? 'You'}</span>
          <span className="jr-prejoin__when">{session ? formatWhen(session.startsAt) : ''}</span>
        </div>

        <aside className="jr-prejoin__panel">
          <div className="jr-brand jr-brand--panel">
            <span className="jr-brand__mark">AI</span>
            <span>AI Eo</span>
            <em>LIVE</em>
          </div>
          <span className="jr-eyebrow">{isClass ? 'Live class' : 'Coaching session'}</span>
          <h1>{session?.topic ?? 'Coaching session'}</h1>
          <p className="jr-prejoin__meta">
            {isMentor
              ? `Hosting with ${session?.studentName ?? 'your student'}`
              : `with ${session?.mentorName ?? 'your mentor'}`}
            {session ? ` · ${formatWhen(session.startsAt)}` : ''}
          </p>

          <label className="jr-field">
            <span>Your name</span>
            <input value={user?.displayName ?? 'Guest'} readOnly />
          </label>

          {mediaError ? (
            <div className="jr-alert">
              <Icon name="alert" size={16} />
              <span>{mediaError}</span>
            </div>
          ) : null}

          <button type="button" className="jr-join" disabled={joinBusy} onClick={() => void join()}>
            {joinBusy ? 'Joining…' : 'Join meeting'}
          </button>

          <div className={`jr-status${devicesReady ? ' is-ok' : ' is-warn'}`}>
            <span className="jr-dot" />
            <span>{statusText}</span>
          </div>

          <div className="jr-prejoin__controls">
            <button
              type="button"
              className={`jr-round${micOn ? '' : ' is-off'}`}
              onClick={() => setMicOn((value) => !value)}
              aria-label={micOn ? 'Mute microphone' : 'Unmute microphone'}
              title={micOn ? 'Mute microphone' : 'Unmute microphone'}
            >
              <span className="jr-ico">
                <Icon name="mic" size={20} />
              </span>
            </button>
            <button
              type="button"
              className={`jr-round${camOn ? '' : ' is-off'}`}
              onClick={() => setCamOn((value) => !value)}
              aria-label={camOn ? 'Turn camera off' : 'Turn camera on'}
              title={camOn ? 'Turn camera off' : 'Turn camera on'}
            >
              <span className="jr-ico">
                <Icon name="video" size={20} />
              </span>
            </button>
            <button
              type="button"
              className="jr-round"
              onClick={() => setSettingsOpen(true)}
              aria-label="Device settings"
              title="Device settings"
            >
              <Icon name="settings" size={19} />
            </button>
          </div>

          {cameraIssue || micIssue ? (
            <button type="button" className="jr-retry" onClick={() => void retryMedia()}>
              <Icon name="rotate" size={14} />
              Try camera and microphone again
            </button>
          ) : null}
        </aside>

        <DeviceSettingsDialog
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          devices={deviceList}
          cameraId={selectedCamera}
          micId={selectedMic}
          cameraIssue={cameraIssue}
          micIssue={micIssue}
          switching={switching}
          onSwitch={(kind, id) => void switchDevice(kind, id)}
          onRetry={() => void retryMedia()}
        />
      </div>
    );
  }

  const shareText = encodeURIComponent(`Join my AI Eo session: ${roomLink}`);

  return (
    <div className="jr">
      <header className="jr-top">
        <div className="jr-brand">
          <span className="jr-brand__mark">AI</span>
          <span>AI Eo</span>
          <em>LIVE</em>
        </div>

        <div className="jr-title">
          <strong>{session?.topic ?? 'Session'}</strong>
          <span className="jr-title__timer">
            <Icon name="clock" size={13} />
            {clock}
          </span>
          {isClass ? <span className="jr-title__badge">Class</span> : null}
          <button type="button" className="jr-iconbtn" onClick={() => void copyRoomLink()} title="Copy meeting link" aria-label="Copy meeting link">
            <Icon name={copied ? 'check' : 'link'} size={15} />
          </button>
        </div>

        <div className="jr-top__right">
          <button
            type="button"
            className={`jr-pill${panelOpen ? ' is-on' : ''}`}
            onClick={() => {
              setPanel('people');
              setPanelOpen(true);
            }}
            title="Participants"
          >
            <Icon name="users" size={15} />
            {roster.length}
          </button>
          <button type="button" className="jr-pill jr-pill--invite" onClick={() => setInviteOpen(true)}>
            <Icon name="plus" size={15} />
            Invite
          </button>
        </div>
      </header>

      <div className="jr-body">
        {panelOpen ? (
          <aside className="jr-panel" aria-label="Session panel">
            <header className="jr-panel__top">
              <div className="jr-panel__tabs" role="tablist">
                {(['chat', 'notes', 'people'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={panel === tab}
                    className={panel === tab ? 'is-on' : undefined}
                    onClick={() => setPanel(tab)}
                  >
                    {tab === 'chat' ? 'Chat' : tab === 'notes' ? 'Notes' : `People (${roster.length})`}
                  </button>
                ))}
              </div>
              <button type="button" className="jr-iconbtn" onClick={() => setPanelOpen(false)} aria-label="Close panel">
                <Icon name="close" size={17} />
              </button>
            </header>

            {panel === 'chat' ? (
              <>
                <div className="jr-chat">
                  {(state?.messages ?? [])
                    .filter((message: MentorChatMessage) => message.kind !== 'NOTE')
                    .map((message) => (
                      <div
                        key={message.id}
                        className={`jr-msg${message.senderId === user?.id ? ' is-self' : ''}${
                          message.kind === 'SYSTEM' ? ' is-system' : ''
                        }`}
                      >
                        <span className="jr-msg__who">{message.senderName}</span>
                        <div className="jr-msg__bubble">{message.body}</div>
                      </div>
                    ))}
                  {(state?.messages ?? []).filter((message) => message.kind !== 'NOTE').length === 0 ? (
                    <p className="jr-panel__empty">No messages yet. Say hello 👋</p>
                  ) : null}
                  <div ref={chatEndRef} />
                </div>
                <div className="jr-composer">
                  <input
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        void send();
                      }
                    }}
                    placeholder="Type a message"
                    aria-label="Chat message"
                  />
                  <button type="button" onClick={() => void send()} aria-label="Send message">
                    <Icon name="send" size={17} />
                  </button>
                </div>
              </>
            ) : null}

            {panel === 'notes' ? (
              <div className="jr-notes">
                <p className="jr-panel__empty" style={{ padding: 0 }}>
                  Session notes are shared with both sides and kept on the session.
                </p>
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Vocabulary to revisit, essay structure, next actions…"
                  aria-label="Session notes"
                />
                <button type="button" className="jr-primary" onClick={() => void saveNotes()} disabled={!notes.trim()}>
                  <Icon name="send" size={14} />
                  Save notes to session
                </button>
                <div className="jr-notes__list">
                  {(state?.messages ?? [])
                    .filter((message) => message.kind === 'NOTE')
                    .map((message) => (
                      <div key={message.id} className="jr-note">
                        <span className="jr-msg__who">
                          {message.senderName} · {formatWhen(message.createdAt)}
                        </span>
                        <p>{message.body}</p>
                      </div>
                    ))}
                </div>
              </div>
            ) : null}

            {panel === 'people' ? (
              <div className="jr-roster">
                {[...roster]
                  .sort((a, b) => Number(b.handRaised) - Number(a.handRaised))
                  .map((participant) => {
                    const isSelf = participant.userId === user?.id;
                    const isHost = participant.userId === session?.mentorId;
                    const peerMicLive = peers
                      .find((item) => item.userId === participant.userId)
                      ?.stream.getAudioTracks()
                      .some((track) => track.enabled && !track.muted);
                    return (
                      <div
                        key={participant.userId}
                        className={`jr-person${participant.handRaised ? ' is-hand' : ''}`}
                      >
                        <MentorAvatar
                          name={participant.displayName}
                          userId={participant.userId}
                          avatarUpdatedAt={participant.avatarUpdatedAt}
                          tone={isSelf ? 'sun' : isHost ? 'violet' : 'coral'}
                        />
                        <div className="jr-person__text">
                          <strong>
                            {participant.displayName}
                            {isSelf ? ' (you)' : ''}
                          </strong>
                          <span>
                            {isHost ? 'mentor · host' : isClass ? 'member' : isSelf ? 'you' : 'student'}
                            {' · '}
                            {isSelf ? (micOn ? 'mic on' : 'muted') : peerMicLive === false ? 'muted' : 'mic on'}
                          </span>
                        </div>
                        {participant.handRaised ? <span className="jr-person__hand" title="Hand raised">✋</span> : null}
                        {isMentor && !isSelf && !isHost ? (
                          <div className="jr-person__actions">
                            <button
                              type="button"
                              title={peerMicLive === false ? 'Unmute their microphone' : 'Mute their microphone'}
                              onClick={() => void forceMute(participant.userId, peerMicLive !== false)}
                            >
                              <Icon name="mic" size={14} />
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

        <main className={`jr-stage${peers.length === 0 ? ' jr-stage--solo' : ''}`}>
          {peers.length === 0 ? (
            <div className="jr-solo">
              <div className={`jr-solo__tile${camOn ? '' : ' is-off'}${screenOn ? ' is-screen' : ''}`}>
                <video
                  ref={(el) => {
                    localVideoRef.current = el;
                    if (el) {
                      const stream = screenStreamRef.current ?? localStreamRef.current;
                      if (el.srcObject !== stream) el.srcObject = stream;
                      el.muted = true;
                      void el.play().catch(() => undefined);
                    }
                  }}
                  autoPlay
                  playsInline
                  muted
                />
                {!camOn && !screenOn ? (
                  <div className="jr-tile__avatar">
                    <UserAvatar src={user?.avatarUrl ?? null} userId={user?.id} name={user?.displayName ?? 'Me'} size={110} />
                  </div>
                ) : null}
                <span className="jr-tile__label">
                  You{screenOn ? ' · presenting' : ''}
                  {!micOn ? (
                    <i className="jr-tile__muted">
                      <Icon name="mic" size={12} />
                    </i>
                  ) : null}
                </span>
                {handRaised ? <span className="jr-tile__hand">✋</span> : null}
              </div>
              <div className="jr-waiting">
                <span className="jr-waiting__pulse" />
                <div>
                  <strong>
                    Waiting for {isClass ? 'class members' : isMentor ? 'your student' : 'your mentor'} to join…
                  </strong>
                  <span>The call connects automatically when they arrive. Keep this tab open.</span>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="jr-grid" data-count={Math.min(peers.length, 6)}>
                {peers.map((peer) => (
                  <RemoteTile
                    key={peer.userId}
                    peer={peer}
                    participant={state?.participants.find((item) => item.userId === peer.userId)}
                  />
                ))}
              </div>
              <div className={`jr-self${camOn && !screenOn ? '' : ' is-off'}${screenOn ? ' is-screen' : ''}`}>
                <video
                  ref={(el) => {
                    localVideoRef.current = el;
                    if (el) {
                      const stream = screenStreamRef.current ?? localStreamRef.current;
                      if (el.srcObject !== stream) el.srcObject = stream;
                      el.muted = true;
                      void el.play().catch(() => undefined);
                    }
                  }}
                  autoPlay
                  playsInline
                  muted
                />
                {!camOn && !screenOn ? (
                  <div className="jr-tile__avatar jr-tile__avatar--small">
                    <UserAvatar src={user?.avatarUrl ?? null} userId={user?.id} name={user?.displayName ?? 'Me'} size={48} />
                  </div>
                ) : null}
                <span className="jr-tile__label">
                  You{screenOn ? ' · presenting' : ''}
                  {!micOn ? (
                    <i className="jr-tile__muted">
                      <Icon name="mic" size={11} />
                    </i>
                  ) : null}
                </span>
                {handRaised ? <span className="jr-tile__hand">✋</span> : null}
              </div>
            </>
          )}

          <div className="jr-reactions" aria-hidden="true">
            {reactions.map((item) => (
              <span key={item.key} className="jr-reaction">
                <b>{item.emoji}</b>
                <i>{item.name}</i>
              </span>
            ))}
          </div>
        </main>
      </div>

      {mediaError ? (
        <div className="jr-banner">
          <Icon name="alert" size={16} />
          <span>{mediaError}</span>
          <button type="button" onClick={() => void retryMedia()}>
            Try again
          </button>
          <button type="button" className="jr-banner__close" onClick={() => setMediaError(null)} aria-label="Dismiss">
            <Icon name="close" size={15} />
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="jr-banner jr-banner--error">
          <Icon name="alert" size={16} />
          <span>{error}</span>
          <button type="button" className="jr-banner__close" onClick={() => setError(null)} aria-label="Dismiss">
            <Icon name="close" size={15} />
          </button>
        </div>
      ) : null}

      <footer className="jr-toolbar">
        <div className="jr-toolbar__inner">
          <button
            type="button"
            className={`jr-btn${micOn ? '' : ' is-off'}`}
            onClick={() => setMicOn((value) => !value)}
            aria-label={micOn ? 'Mute microphone' : 'Unmute microphone'}
            title={micOn ? 'Mute microphone' : 'Unmute microphone'}
          >
            <span className="jr-ico">
              <Icon name="mic" size={20} />
            </span>
            <span className="jr-btn__label">{micOn ? 'Mute' : 'Unmute'}</span>
          </button>

          <button
            type="button"
            className={`jr-btn${camOn ? '' : ' is-off'}`}
            onClick={() => setCamOn((value) => !value)}
            aria-label={camOn ? 'Turn camera off' : 'Turn camera on'}
            title={camOn ? 'Turn camera off' : 'Turn camera on'}
          >
            <span className="jr-ico">
              <Icon name="video" size={20} />
            </span>
            <span className="jr-btn__label">{camOn ? 'Camera' : 'Camera off'}</span>
          </button>

          <button
            type="button"
            className={`jr-btn${screenOn ? ' is-on' : ''}`}
            onClick={() => void toggleScreen()}
            aria-label="Share screen"
            title="Share your screen"
          >
            <span className="jr-ico">
              <Icon name="monitor" size={20} />
            </span>
            <span className="jr-btn__label">{screenOn ? 'Stop' : 'Share'}</span>
          </button>

          <span className="jr-sep" />

          <button
            type="button"
            className={`jr-btn${panelOpen && panel === 'chat' ? ' is-on' : ''}`}
            onClick={() => {
              if (panelOpen && panel === 'chat') setPanelOpen(false);
              else {
                setPanel('chat');
                setPanelOpen(true);
              }
            }}
            aria-label="Chat"
            title="Chat"
          >
            <span className="jr-ico">
              <Icon name="bubble" size={20} />
            </span>
            <span className="jr-btn__label">Chat</span>
          </button>

          <button
            type="button"
            className={`jr-btn${handRaised ? ' is-hand' : ''}`}
            onClick={() => void toggleHand()}
            aria-label="Raise hand"
            title={handRaised ? 'Lower hand' : 'Raise hand'}
          >
            <span className="jr-ico">
              <Icon name="hand" size={20} />
            </span>
            <span className="jr-btn__label">{handRaised ? 'Lower' : 'Raise'}</span>
          </button>

          <button
            type="button"
            className={`jr-btn${panelOpen && panel === 'people' ? ' is-on' : ''}`}
            onClick={() => {
              if (panelOpen && panel === 'people') setPanelOpen(false);
              else {
                setPanel('people');
                setPanelOpen(true);
              }
            }}
            aria-label="Participants"
            title="Participants"
          >
            <span className="jr-ico">
              <Icon name="users" size={20} />
            </span>
            <span className="jr-btn__label">People</span>
          </button>

          <div className="jr-pop">
            <button
              type="button"
              className={`jr-btn${reactionsOpen ? ' is-on' : ''}`}
              onClick={() => {
                setReactionsOpen((value) => !value);
                setMoreOpen(false);
              }}
              aria-label="Reactions"
              title="Reactions"
            >
              <span className="jr-ico">😊</span>
              <span className="jr-btn__label">React</span>
            </button>
            {reactionsOpen ? (
              <div className="jr-emoji" role="menu" aria-label="Send a reaction">
                {['👍', '👏', '😄', '🎉', '❤️', '🔥', '🤔', '✋'].map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => {
                      void sendReaction(emoji);
                      setReactionsOpen(false);
                    }}
                    aria-label={`React ${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="jr-pop">
            <button
              type="button"
              className={`jr-btn${moreOpen ? ' is-on' : ''}`}
              onClick={() => {
                setMoreOpen((value) => !value);
                setReactionsOpen(false);
              }}
              aria-label="More actions"
              title="More actions"
            >
              <span className="jr-ico">
                <Icon name="more" size={20} />
              </span>
              <span className="jr-btn__label">More</span>
            </button>
            {moreOpen ? (
              <div className="jr-more" role="menu">
                <button type="button" onClick={() => { setSettingsOpen(true); setMoreOpen(false); }}>
                  <Icon name="settings" size={15} />
                  Device settings
                </button>
                <button type="button" onClick={() => { setInviteOpen(true); setMoreOpen(false); }}>
                  <Icon name="plus" size={15} />
                  Invite people
                </button>
                <button type="button" onClick={() => { void copyRoomLink(); setMoreOpen(false); }}>
                  <Icon name="link" size={15} />
                  {copied ? 'Link copied' : 'Copy meeting link'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMoreOpen(false);
                    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
                    else void document.documentElement.requestFullscreen?.().catch(() => undefined);
                  }}
                >
                  <Icon name="expand" size={15} />
                  Full screen
                </button>
                {isMentor ? (
                  <>
                    <span className="jr-more__sep" />
                    <button
                      type="button"
                      className="is-danger"
                      onClick={async () => {
                        setMoreOpen(false);
                        try {
                          await mentorApi.complete(sessionId);
                          await leave();
                        } catch (cause) {
                          setError(describeError(cause));
                        }
                      }}
                    >
                      <Icon name="checkCircle" size={15} />
                      End session for everyone
                    </button>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>

          <span className="jr-sep" />

          <button type="button" className="jr-hangup" onClick={() => void leave()} aria-label="Leave the call" title="Leave the call">
            <Icon name="phoneOff" size={20} />
          </button>
        </div>
      </footer>

      {inviteOpen ? (
        <div
          className="jr-modal-scrim"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setInviteOpen(false);
          }}
        >
          <div className="jr-modal" role="dialog" aria-modal="true" aria-label="Invite people">
            <header className="jr-modal__head">
              <h2>Invite more people</h2>
              <button type="button" className="jr-iconbtn" onClick={() => setInviteOpen(false)} aria-label="Close">
                <Icon name="close" size={18} />
              </button>
            </header>
            <p className="jr-modal__lead">
              Share the meeting link. Everyone who opens it signs in with their AI Eo account and lands in this room.
            </p>
            <div className="jr-invite">
              <input value={roomLink} readOnly onFocus={(event) => event.currentTarget.select()} aria-label="Meeting link" />
              <button type="button" className={copied ? 'is-copied' : undefined} onClick={() => void copyRoomLink()}>
                <Icon name={copied ? 'check' : 'copy'} size={15} />
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <div className="jr-share">
              <a href={`https://wa.me/?text=${shareText}`} target="_blank" rel="noreferrer">WhatsApp</a>
              <a href={`https://t.me/share/url?url=${encodeURIComponent(roomLink)}&text=${encodeURIComponent('Join my AI Eo session')}`} target="_blank" rel="noreferrer">Telegram</a>
              <a href={`mailto:?subject=${encodeURIComponent('AI Eo live session')}&body=${encodeURIComponent(`Join here: ${roomLink}`)}`}>Email</a>
            </div>
          </div>
        </div>
      ) : null}

      <DeviceSettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        devices={deviceList}
        cameraId={selectedCamera}
        micId={selectedMic}
        cameraIssue={cameraIssue}
        micIssue={micIssue}
        switching={switching}
        onSwitch={(kind, id) => void switchDevice(kind, id)}
        onRetry={() => void retryMedia()}
      />
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
  const [micLive, setMicLive] = useState(true);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const stream = peer.stream;
    const evaluate = () => {
      const videos = stream.getVideoTracks();
      setLive(videos.some((track) => track.readyState === 'live' && !track.muted && track.enabled));
      const audios = stream.getAudioTracks();
      setMicLive(audios.length === 0 ? true : audios.some((track) => !track.muted && track.enabled));
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
    <div className="jr-tile">
      <video
        ref={(el) => {
          videoRef.current = el;
          if (el && el.srcObject !== peer.stream) {
            el.srcObject = peer.stream;
            void el.play().catch(() => undefined);
          }
        }}
        autoPlay
        playsInline
      />
      {!live ? (
        <div className="jr-tile__avatar">
          <UserAvatar
            userId={peer.userId}
            avatarUpdatedAt={participant?.avatarUpdatedAt}
            name={peer.displayName}
            size={92}
          />
        </div>
      ) : null}
      <span className="jr-tile__label">
        {peer.displayName}
        {!micLive ? (
          <i className="jr-tile__muted">
            <Icon name="mic" size={11} />
          </i>
        ) : null}
        {participant?.handRaised ? <span className="jr-tile__hand">✋</span> : null}
      </span>
    </div>
  );
}

/** Jitsi-style settings: pick another camera or microphone without leaving. */
function DeviceSettingsDialog({
  open,
  onClose,
  devices,
  cameraId,
  micId,
  cameraIssue,
  micIssue,
  switching,
  onSwitch,
  onRetry,
}: {
  open: boolean;
  onClose: () => void;
  devices: MediaDeviceInfo[];
  cameraId: string;
  micId: string;
  cameraIssue: string | null;
  micIssue: string | null;
  switching: boolean;
  onSwitch: (kind: 'camera' | 'mic', deviceId: string) => void;
  onRetry: () => void;
}) {
  if (!open) return null;
  const cameras = devices.filter((device) => device.kind === 'videoinput');
  const microphones = devices.filter((device) => device.kind === 'audioinput');

  return (
    <div
      className="jr-modal-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="jr-modal jr-modal--settings" role="dialog" aria-modal="true" aria-label="Device settings">
        <header className="jr-modal__head">
          <h2>Settings</h2>
          <button type="button" className="jr-iconbtn" onClick={onClose} aria-label="Close">
            <Icon name="close" size={18} />
          </button>
        </header>

        <section className="jr-settings__group">
          <h3>
            <Icon name="mic" size={16} />
            Microphone
          </h3>
          <select value={micId} onChange={(event) => onSwitch('mic', event.target.value)} disabled={switching}>
            {microphones.length === 0 ? <option value="">Default microphone</option> : null}
            {microphones.map((device, index) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Microphone ${index + 1}`}
              </option>
            ))}
          </select>
          {micIssue ? (
            <p className="jr-hint jr-hint--bad">{micIssue}</p>
          ) : (
            <p className="jr-hint">Speak — your level moves in the tile. Switching keeps the call connected.</p>
          )}
        </section>

        <section className="jr-settings__group">
          <h3>
            <Icon name="video" size={16} />
            Camera
          </h3>
          <select value={cameraId} onChange={(event) => onSwitch('camera', event.target.value)} disabled={switching}>
            {cameras.length === 0 ? <option value="">Default camera</option> : null}
            {cameras.map((device, index) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Camera ${index + 1}`}
              </option>
            ))}
          </select>
          {cameraIssue ? (
            <p className="jr-hint jr-hint--bad">{cameraIssue}</p>
          ) : (
            <p className="jr-hint">A busy microphone no longer blocks the camera — each device is requested on its own.</p>
          )}
        </section>

        <footer className="jr-modal__foot">
          <button type="button" className="jr-ghost" onClick={onRetry} disabled={switching}>
            <Icon name="rotate" size={14} />
            {switching ? 'Switching…' : 'Try again'}
          </button>
          <button type="button" className="jr-primary" onClick={onClose}>
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}

export default CallRoomPage;
