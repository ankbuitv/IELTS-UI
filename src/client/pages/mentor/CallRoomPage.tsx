import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { mentorApi } from '../../lib/mentor-api';
import { api, describeError, getCsrfToken, getSessionToken } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { Button, Notice } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { MentorAvatar, formatWhen } from '../../components/mentor/MentorBits';
import { UserAvatar } from '../../components/UserAvatar';
import { BrandLogo } from '../../components/BrandLogo';
import type { MentorChatMessage, MentorRoomState, MentorSignal, RoomParticipant } from '@shared/mentor';
import type { BreakoutState, ClassPoll, WhiteboardStroke } from '@shared/live';

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];
const POLL_MS = 1000;

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
  const [searchParams] = useSearchParams();
  // A breakout room is the same session with a different `room` key; leaving
  // and re-entering swaps the whole call (see BreakoutPanel).
  const room = searchParams.get('room') || 'main';
  const navigate = useNavigate();
  const { user } = useAuth();

  const [phase, setPhase] = useState<'loading' | 'prejoin' | 'room' | 'left' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  // True when the app sits inside another page's iframe (preview panel). The
  // parent frame must grant `allow="camera; microphone"` for the frame to use
  // the devices — nothing this document can do — so the reliable fix is
  // opening the room in its own tab. Checked once at mount.
  const [framed] = useState(() => {
    try {
      return window.self !== window.top;
    } catch {
      return true;
    }
  });
  const openOwnTab = () => window.open(window.location.href, '_blank', 'noopener');
  const [state, setState] = useState<MentorRoomState | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [hasCamera, setHasCamera] = useState(false);
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
  // Live classroom tools.
  const [breakouts, setBreakouts] = useState<BreakoutState | null>(null);
  const [breakoutOpen, setBreakoutOpen] = useState(false);
  const [quizOpen, setQuizOpen] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  const [timerOpen, setTimerOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [feedbackComment, setFeedbackComment] = useState('');
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [leaveError, setLeaveError] = useState(false);
  const [signalStatus, setSignalStatus] = useState<'connected' | 'reconnecting'>('connected');
  const [latency, setLatency] = useState<number | null>(null);
  const [peerIssue, setPeerIssue] = useState(false);
  const [turnAvailable, setTurnAvailable] = useState<boolean | null>(null);
  const iceServersRef = useRef<RTCIceServer[]>(ICE_SERVERS);

  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const pcsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  /** One stable MediaStream per remote peer. Tiles exist as soon as the person is
   * in the room; tracks land in this stream when WebRTC connects. */
  const remoteStreamsRef = useRef<Map<string, MediaStream>>(new Map());
  /** Device flags for the presence heartbeat (read inside the poll interval). */
  const mediaRef = useRef({ cam: true, mic: true, screen: false });
  const negotiatingRef = useRef(new Set<string>());
  const offerAtRef = useRef(new Map<string, number>());
  const inRoomRef = useRef(false);
  const pendingCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const participantsRef = useRef<MentorRoomState['participants']>([]);
  const lastSignalIdRef = useRef<string | null>(null);
  const sessionRef = useRef<string>(sessionId);
  const roomRef = useRef(room);
  const leftRef = useRef(false);

  useEffect(() => {
    roomRef.current = room;
  }, [room]);

  /** Signalling never crosses rooms: the room key rides on every envelope. */
  const sendSignal = (
    signal: Parameters<typeof mentorApi.signal>[1],
  ): Promise<{ ok: true; id: string }> =>
    mentorApi.signal(sessionRef.current, { ...signal, room: roomRef.current });

  useEffect(() => {
    sessionRef.current = sessionId;
  }, [sessionId]);

  const selfId = user?.id ?? '';

  useEffect(() => {
    mediaRef.current = { cam: camOn, mic: micOn, screen: screenOn };
  }, [camOn, micOn, screenOn]);

  // ---------------------------------------------------------------- media
  const stopMedia = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    setHasCamera(false);
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
      setHasCamera(stream.getVideoTracks().length > 0);
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
      const pc = new RTCPeerConnection({ iceServers: iceServersRef.current });
      pcsRef.current.set(userId, pc);

      const remoteStream = new MediaStream();
      remoteStreamsRef.current.set(userId, remoteStream);
      // A tile exists the moment someone is present — before media negotiates.
      setPeers((prev) =>
        prev.some((peer) => peer.userId === userId) ? prev : [...prev, { userId, displayName, stream: remoteStream }],
      );
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
          void sendSignal({ kind: 'CANDIDATE', targetId: userId, payload: JSON.stringify(event.candidate) })
            .catch(() => undefined);
        }
      };
      pc.onconnectionstatechange = () => {
        if ((pc.connectionState === 'failed' || pc.connectionState === 'closed') && pcsRef.current.get(userId) === pc) {
          pcsRef.current.delete(userId);
          offerAtRef.current.delete(userId);
          pc.close();
          remoteStreamsRef.current.delete(userId);
          setPeers((prev) => prev.filter((peer) => peer.userId !== userId));
        }
      };

      // Attach whatever media is available now; late tracks are added by syncSenders.
      const local = localStreamRef.current;
      local?.getAudioTracks().forEach((track) => pc.addTrack(track, local));
      const screen = screenStreamRef.current;
      const video = screen?.getVideoTracks()[0] ?? local?.getVideoTracks()[0];
      if (video) pc.addTrack(video, screen ?? local!);
      return pc;
    },
    [],
  );

  /** Offer from this side (perfect negotiation: both may offer; the polite peer rolls back on glare). */
  const negotiate = useCallback(
    async (userId: string) => {
      const pc = pcsRef.current.get(userId);
      if (!pc || pc.signalingState !== 'stable' || negotiatingRef.current.has(userId)) return;
      negotiatingRef.current.add(userId);
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        offerAtRef.current.set(userId, Date.now());
        await sendSignal({ kind: 'OFFER', targetId: userId, payload: JSON.stringify(offer) });
      } catch {
        if ((pc.signalingState as RTCSignalingState) === 'have-local-offer') await pc.setLocalDescription({ type: 'rollback' }).catch(() => undefined);
        offerAtRef.current.delete(userId);
      } finally {
        negotiatingRef.current.delete(userId);
      }
    },
    [],
  );

  /** Add any local tracks the connection is missing (late camera, first media, screen). */
  const syncSenders = useCallback(
    (userId: string) => {
      const pc = pcsRef.current.get(userId);
      const local = localStreamRef.current;
      const screen = screenStreamRef.current;
      if (!pc) return;
      let added = false;
      const tracks = [...(local?.getAudioTracks() ?? []), ...((screen?.getVideoTracks()[0] ?? local?.getVideoTracks()[0]) ? [screen?.getVideoTracks()[0] ?? local!.getVideoTracks()[0]!] : [])];
      for (const track of tracks) {
        const has = pc.getSenders().some((sender) => sender.track?.kind === track.kind);
        if (!has) {
          pc.addTrack(track, track.kind === 'video' && screen ? screen : local!);
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
        if (track.kind === 'video' && screenStreamRef.current) continue;
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
      if (signal.targetId && signal.targetId !== selfId) return;
      const fromName = participantsRef.current.find((p) => p.userId === signal.senderId)?.displayName ?? 'Guest';
      const isMediaSignal = signal.kind === 'OFFER' || signal.kind === 'ANSWER' || signal.kind === 'CANDIDATE';
      const pc = isMediaSignal ? addPeer(signal.senderId, fromName) : pcsRef.current.get(signal.senderId);
      const polite = selfId > signal.senderId;

      try {
        if (signal.kind === 'OFFER' && pc) {
          if (pc.signalingState !== 'stable') {
            if (!polite) return; // impolite peer keeps its own offer; the other side rolls back
            await pc.setLocalDescription({ type: 'rollback' } as RTCSessionDescriptionInit);
          }
          await pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(signal.payload)));
          await flushCandidates(signal.senderId, pc);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await sendSignal({
            kind: 'ANSWER',
            targetId: signal.senderId,
            payload: JSON.stringify(answer),
          });
          syncSenders(signal.senderId);
        } else if (signal.kind === 'ANSWER' && pc) {
          if (pc.signalingState === 'have-local-offer') {
            await pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(signal.payload)));
            offerAtRef.current.delete(signal.senderId);
            await flushCandidates(signal.senderId, pc);
          }
        } else if (signal.kind === 'CANDIDATE' && pc) {
          const candidate = JSON.parse(signal.payload) as RTCIceCandidateInit;
          if (!pc.remoteDescription) {
            const queued = pendingCandidatesRef.current.get(signal.senderId) ?? [];
            queued.push(candidate);
            pendingCandidatesRef.current.set(signal.senderId, queued);
          } else {
            await pc.addIceCandidate(candidate);
          }
        } else if (signal.kind === 'BYE') {
          pc?.close();
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
    let failures = 0;
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        const next = await mentorApi.room(
          sessionId,
          lastSignalIdRef.current ?? undefined,
          room,
          mediaRef.current,
        );
        if (!alive) return;
        failures = 0; setSignalStatus('connected');
        participantsRef.current = next.participants;
        setState(next);
        for (const signal of next.signals) await handleSignal(signal);
        lastSignalIdRef.current = next.signalCursor;

        const presentIds = new Set(next.participants.map((p) => p.userId));
        // Everyone present (except me) gets a connection; the smaller id initiates
        // to avoid both sides offering at the exact same moment.
        for (const participant of next.participants) {
          if (participant.userId === selfId) continue;
          addPeer(participant.userId, participant.displayName);
          syncSenders(participant.userId);
          const pc = pcsRef.current.get(participant.userId);
          const offerAt = offerAtRef.current.get(participant.userId);
          if (pc?.signalingState === 'have-local-offer' && offerAt && Date.now() - offerAt > 15000 && !negotiatingRef.current.has(participant.userId)) {
            offerAtRef.current.delete(participant.userId);
            await pc.setLocalDescription({ type: 'rollback' }).catch(() => undefined);
          }
          if (!pcsRef.current.get(participant.userId)?.remoteDescription && selfId < participant.userId) {
            void negotiate(participant.userId);
          }
        }
        // One tile per person present — names and avatars are visible even
        // while their camera is off or the first frame has not arrived yet.
        const others = next.participants.filter((participant) => participant.userId !== selfId);
        setPeers(
          others.map((participant) => ({
            userId: participant.userId,
            displayName: participant.displayName,
            stream: remoteStreamsRef.current.get(participant.userId) ?? new MediaStream(),
          })),
        );
        for (const [peerId, pc] of pcsRef.current) {
          if (!presentIds.has(peerId)) {
            pc.close();
            pcsRef.current.delete(peerId);
            remoteStreamsRef.current.delete(peerId);
            pendingCandidatesRef.current.delete(peerId);
          }
        }
      } catch {
        failures += 1;
        if (alive && failures >= 2) setSignalStatus('reconnecting');
      } finally { running = false; }
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
  }, [phase, sessionId, selfId, room, addPeer, handleSignal, syncSenders, negotiate]);

  // Show observed peer round-trip latency, not a fabricated bandwidth/quality score.
  useEffect(() => {
    if (phase !== 'room') return;
    let active = true;
    const sample = async () => {
      const pcs = [...pcsRef.current.values()];
      const values: number[] = [];
      let issue = false;
      for (const pc of pcs) {
        if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') issue = true;
        try { const stats = await pc.getStats(); stats.forEach((row) => { if (row.type === 'candidate-pair' && row.state === 'succeeded' && row.nominated && typeof row.currentRoundTripTime === 'number') values.push(row.currentRoundTripTime * 1000); }); } catch { /* closed while sampling */ }
      }
      if (active) { setLatency(values.length ? Math.round(Math.max(...values)) : null); setPeerIssue(issue); }
    };
    void sample(); const timer = window.setInterval(() => void sample(), 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [phase]);

  // Breakout rooms: refresh while the call is open so assignments and closing
  // reach participants without a reload.
  useEffect(() => {
    if (phase !== 'room' || !selfId) return;
    let alive = true;
    const load = async () => {
      try {
        const next = await mentorApi.breakouts(sessionId);
        if (!alive) return;
        setBreakouts(next);
        // The host closed the rooms (or they expired): go back to the main call.
        if (room !== 'main' && !next.rooms.some((item) => item.roomKey === room)) {
          window.location.assign(`/sessions/${sessionId}/room`);
        }
      } catch {
        // A transient failure leaves the last known assignment on screen.
      }
    };
    void load();
    const interval = window.setInterval(() => void load(), 6000);
    return () => {
      alive = false;
      window.clearInterval(interval);
    };
  }, [phase, sessionId, selfId, room]);

  // When the breakout timer runs out, everybody returns to the main room.
  const breakoutEndsAt = breakouts?.endsAt ?? null;
  useEffect(() => {
    if (!breakoutEndsAt || room === 'main') return;
    const delay = Date.parse(breakoutEndsAt) - Date.now();
    if (!Number.isFinite(delay)) return;
    const timer = window.setTimeout(() => window.location.assign(`/sessions/${sessionId}/room`), Math.max(1000, delay));
    return () => window.clearTimeout(timer);
  }, [breakoutEndsAt, room, sessionId]);

  // Time in this call. The session's `started_at` can be hours (or days) old —
  // a mentor who opened the room early left every later visitor with a
  // nonsensical 1391:00 clock. Jitsi counts from the moment you joined, so we
  // use this participant's presence row (the poll keeps it fresh).
  const selfJoinedAt = state?.participants.find((item) => item.userId === selfId)?.joinedAt ?? null;
  useEffect(() => {
    if (phase !== 'room') return;
    const parsed = selfJoinedAt ? Date.parse(selfJoinedAt) : NaN;
    const base = Number.isFinite(parsed) ? parsed : Date.now();
    const tick = () =>
      setElapsed(Math.max(0, Math.min(6 * 60 * 60, Math.floor((Date.now() - base) / 1000))));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [phase, selfJoinedAt]);

  // First load: fetch the room (authz happens server side) to reach prejoin.
  useEffect(() => {
    let alive = true;
    mentorApi
      .room(sessionId, undefined, room)
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
  }, [sessionId, selfId, room]);

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
      if (leftRef.current || !inRoomRef.current) return;
      pcsRef.current.forEach((_pc, peerId) => {
        void sendSignal({ kind: 'BYE', targetId: peerId, payload: '' }).catch(() => undefined);
      });
      // keepalive allows the explicit leave request to finish as the tab closes.
      const csrf = getCsrfToken(); const token = getSessionToken();
      void fetch(`/api/mentor/sessions/${encodeURIComponent(sessionRef.current)}/leave`, {
        method: 'POST', credentials: 'same-origin', keepalive: true,
        headers: { 'content-type': 'application/json', ...(csrf ? { 'x-csrf-token': csrf } : {}), ...(token ? { 'x-session-token': token } : {}) }, body: '{}',
      }).catch(() => undefined);
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
      try {
        const config = await api.get<{ iceServers: RTCIceServer[]; configured: boolean }>(`/api/mentor/sessions/${sessionId}/ice`);
        iceServersRef.current = [...ICE_SERVERS, ...config.iceServers]; setTurnAvailable(config.configured);
      } catch { setTurnAvailable(false); }
      const joined = await mentorApi.join(sessionId, room, { cam: camOn, mic: micOn });
      lastSignalIdRef.current = joined.signalCursor;
      inRoomRef.current = true;
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
    inRoomRef.current = false;
    setPhase('left');
    pcsRef.current.forEach((pc, peerId) => {
      void sendSignal({ kind: 'BYE', targetId: peerId, payload: '' }).catch(() => undefined);
      pc.close();
    });
    pcsRef.current.clear();
    stopMedia();
    try {
      await mentorApi.leave(sessionId);
    } catch {
      setLeaveError(true);
    }
  };

  const stopScreen = () => {
    const screen = screenStreamRef.current;
    screenStreamRef.current = null;
    if (screen) for (const track of screen.getTracks()) { track.onended = null; track.stop(); }
    setScreenOn(false);
    const video = localStreamRef.current?.getVideoTracks()[0] ?? null;
    pcsRef.current.forEach((pc) => {
      const sender = pc.getSenders().find((item) => item.track?.kind === 'video');
      if (sender) void sender.replaceTrack(video).catch(() => setError('Không thể khôi phục camera. Hãy thử kết nối lại.'));
    });
    attachSelf();
  };
  const toggleScreen = async () => {
    if (screenStreamRef.current) { stopScreen(); return; }
    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const [track] = screen.getVideoTracks();
      if (!track) return;
      screenStreamRef.current = screen;
      setScreenOn(true);
      pcsRef.current.forEach((pc, peerId) => {
        const sender = pc.getSenders().find((item) => item.track?.kind === 'video');
        if (sender) void sender.replaceTrack(track).catch(() => setError('Không thể chia sẻ màn hình. Hãy thử kết nối lại.'));
        else { pc.addTrack(track, screen); void negotiate(peerId); }
      });
      track.onended = stopScreen;
      attachSelf();
    } catch (cause) {
      if ((cause as { name?: string })?.name !== 'NotAllowedError') setError('Không thể bắt đầu chia sẻ màn hình.');
    }
  };

  const toggleHand = async () => {
    const next = !handRaised;
    setHandRaised(next);
    try {
      await mentorApi.raiseHand(sessionId, next);
      await sendSignal({ kind: 'HAND', targetId: null, payload: next ? 'up' : 'down' });
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
      await sendSignal({ kind: 'REACTION', targetId: null, payload: emoji });
    } catch {
      // Reactions are best-effort.
    }
  };

  /** Mentor-only: force-mute / restore a member's microphone. */
  const forceMute = async (targetId: string, muted: boolean) => {
    try {
      await sendSignal({ kind: muted ? 'MUTE_MIC' : 'UNMUTE_MIC', targetId, payload: '' });
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
      const { message } = await mentorApi.sendMessage(sessionId, body, 'CHAT', room);
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
      const { message } = await mentorApi.sendMessage(sessionId, notes, 'NOTE', room);
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
    const hours = Math.floor(elapsed / 3600);
    const minutes = Math.floor((elapsed % 3600) / 60);
    const seconds = elapsed % 60;
    const mm = String(minutes).padStart(2, '0');
    const ss = String(seconds).padStart(2, '0');
    return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
  }, [elapsed]);

  // Show the local preview only when there is a real camera frame; otherwise the
  // avatar sits on top of the black <video> box (the "empty box" on phones).
  const selfVideoVisible = screenOn || (camOn && hasCamera);

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
          camOn: true,
          micOn: true,
          screenOn: false,
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
        camOn,
        micOn,
        screenOn,
      });
    }
    return [...byId.values()];
  }, [state?.participants, peers, selfId, user?.displayName, handRaised, camOn, micOn, screenOn, user?.role]);

  if (phase === 'left') {
    const canReview = !isMentor && user?.role !== 'ADMIN';
    return <div className="jr jr-after"><div className="jr-after__card"><BrandLogo theme="dark" height={32} /><h1>Đã rời buổi học</h1><p>Đánh giá giúp giáo viên hoặc mentor cải thiện buổi học tiếp theo.</p>
      {leaveError && <p role="alert">Chưa xác nhận được việc rời phòng. Hãy kiểm tra mạng và thử lại.</p>}
      {leaveError && <Button onClick={() => void mentorApi.leave(sessionId).then(() => setLeaveError(false)).catch(() => setLeaveError(true))}>Thử lại</Button>}
      {canReview && !feedbackSent && <form onSubmit={(event) => { event.preventDefault(); setFeedbackBusy(true); void api.post(`/api/mentor/sessions/${sessionId}/feedback`, { rating, comment: feedbackComment }).then(() => setFeedbackSent(true)).catch((cause) => setError(describeError(cause))).finally(() => setFeedbackBusy(false)); }}>
        <fieldset><legend>Buổi học của bạn thế nào?</legend><div className="jr-after__stars">{[1,2,3,4,5].map((value) => <button type="button" key={value} aria-label={`${value} sao`} aria-pressed={rating === value} onClick={() => setRating(value)}>{value <= rating ? '★' : '☆'}</button>)}</div></fieldset>
        <label htmlFor="feedback-comment">Nhận xét (không bắt buộc)</label><textarea id="feedback-comment" maxLength={2000} value={feedbackComment} onChange={(event) => setFeedbackComment(event.target.value)} placeholder="Chia sẻ ý kiến của bạn…" />
        {error && <p role="alert">{error}</p>}<Button type="submit" variant="primary" disabled={!rating || leaveError} loading={feedbackBusy}>Gửi đánh giá</Button>
      </form>}
      {feedbackSent && <p role="status">Cảm ơn bạn! Đánh giá đã gửi tới người chủ trì.</p>}
      {isMentor && <Button onClick={() => setReportOpen(true)}>Xem điểm danh và đánh giá</Button>}
      <Button onClick={() => navigate(isClass ? (session?.classId ? `/classes/${session.classId}` : user?.role === 'TEACHER' ? '/teacher' : '/classrooms') : '/my-sessions')}>Quay lại</Button>
    </div>{reportOpen && <CallReport sessionId={sessionId} onClose={() => setReportOpen(false)} />}</div>;
  }

  if (phase === 'loading') {
    return <div className="jr jr-loading" role="status"><BrandLogo theme="dark" height={36} /><div className="jr-loading__spinner" aria-hidden="true" /><h1>Đang mở phòng học</h1><p>Vui lòng chờ trong giây lát…</p></div>;
  }

  if (phase === 'error') {
    const cancelled = /was cancelled/i.test(error ?? '');
    const over = /already over/i.test(error ?? '');
    return (
      <div className="stack" style={{ maxWidth: 560, margin: '60px auto' }}>
        <Notice
          tone="danger"
          title={cancelled ? 'This session was cancelled' : over ? 'This session has ended' : 'Cannot open this room'}
        >
          {cancelled
            ? 'This booking is no longer active — it was cancelled or declined. Book a fresh time from the mentor profile.'
            : over
              ? 'This call is already finished. The recording, notes and feedback live on your sessions page.'
              : (error ?? 'This session is not available.')}
        </Notice>
        <div className="row">
          <Button onClick={() => navigate('/my-sessions')}>Back to my sessions</Button>
          {cancelled ? <Button onClick={() => navigate('/mentors')}>Browse mentors</Button> : null}
        </div>
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
            <BrandLogo theme="dark" height={30} />
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

          {signalStatus === 'reconnecting' || peerIssue ? <div className="jr-banner jr-banner--error" role="status"><Icon name="alert" size={16} /><span>Kết nối đang gián đoạn. Kiểm tra Wi-Fi, thử tắt camera hoặc đổi mạng.{turnAvailable === false ? ' Máy chủ chưa cấu hình TURN nên một số mạng có thể không kết nối được.' : ''}</span><button type="button" onClick={() => { pcsRef.current.forEach((pc, id) => { pc.restartIce(); void negotiate(id); }); }}>Thử kết nối lại</button></div> : null}

      {mediaError ? (
            <div className="jr-alert">
              <Icon name="alert" size={16} />
              <div className="jr-alert__body">
                <span>{mediaError}</span>
                {framed ? (
                  <button type="button" className="jr-alert__action" onClick={openOwnTab}>
                    Open in a new tab
                  </button>
                ) : null}
              </div>
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
          <BrandLogo theme="dark" height={25} />
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
          <span className={`jr-network${signalStatus === 'reconnecting' || peerIssue ? ' is-warning' : ''}`} role="status" title="Độ trễ khứ hồi WebRTC cao nhất đo được; không phải điểm chất lượng mạng.">{signalStatus === 'reconnecting' ? 'Đang kết nối lại' : peerIssue ? 'Kết nối không ổn định' : latency !== null ? `Độ trễ ${latency} ms` : 'Đang kết nối'}</span>
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
                        <ChatMessageBody body={message.body} />
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
                {!selfVideoVisible ? (
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
                  <strong>Waiting for {isClass ? 'class members' : isMentor ? 'your student' : 'your mentor'}…</strong>
                  <span>The call connects automatically when they arrive.</span>
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
                {!selfVideoVisible ? (
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
          {framed ? (
            <button type="button" onClick={openOwnTab}>
              Open in a new tab
            </button>
          ) : null}
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

      {breakouts?.open ? (
        <div className="jr-banner jr-banner--breakout">
          <Icon name="grid" size={16} />
          {room === 'main' ? (
            breakouts.myRoom ? (
              <span>
                Breakout rooms are open. You are in <strong>{breakouts.myRoom.name}</strong>.
              </span>
            ) : (
              <span>Breakout rooms are open — your mentor will place you in one.</span>
            )
          ) : (
            <span>
              Breakout <strong>{breakouts.rooms.find((item) => item.roomKey === room)?.name ?? 'room'}</strong>
              {breakouts.endsAt
                ? ` · back to the main room at ${new Date(breakouts.endsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                : ''}
            </span>
          )}
          {room === 'main' && breakouts.myRoom ? (
            <button
              type="button"
              onClick={() => window.location.assign(`/sessions/${sessionId}/room?room=${encodeURIComponent(breakouts.myRoom!.roomKey)}`)}
            >
              Join
            </button>
          ) : null}
          {room !== 'main' ? (
            <button type="button" onClick={() => window.location.assign(`/sessions/${sessionId}/room`)}>
              Return to main
            </button>
          ) : null}
          {isMentor && room === 'main' ? (
            <button type="button" onClick={() => setBreakoutOpen(true)}>
              Manage
            </button>
          ) : null}
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

          <button
            type="button"
            className={`jr-btn${quizOpen ? ' is-on' : ''}`}
            onClick={() => {
              setQuizOpen(true);
              setBoardOpen(false);
              setPanelOpen(false);
            }}
            aria-label="Quiz and polls"
            title="Quiz and polls"
          >
            <span className="jr-ico">
              <Icon name="presentation" size={20} />
            </span>
            <span className="jr-btn__label">Quiz</span>
          </button>

          <button
            type="button"
            className={`jr-btn${boardOpen ? ' is-on' : ''}`}
            onClick={() => {
              setBoardOpen(true);
              setQuizOpen(false);
              setPanelOpen(false);
            }}
            aria-label="Whiteboard"
            title="Whiteboard"
          >
            <span className="jr-ico">
              <Icon name="pen" size={20} />
            </span>
            <span className="jr-btn__label">Board</span>
          </button>

          <button
            type="button"
            className={`jr-btn${breakoutOpen ? ' is-on' : ''}`}
            onClick={() => { setBreakoutOpen(true); setQuizOpen(false); setBoardOpen(false); setPanelOpen(false); }}
            aria-label="Breakout rooms"
            title="Breakout rooms"
          >
            <span className="jr-ico"><Icon name="grid" size={20} /></span>
            <span className="jr-btn__label">Nhóm nhỏ</span>
          </button>

          <button type="button" className={`jr-btn${timerOpen ? ' is-on' : ''}`} onClick={() => setTimerOpen((open) => !open)} aria-label="Đồng hồ luyện nói" title="Đồng hồ luyện nói">
            <span className="jr-ico"><Icon name="clock" size={20} /></span><span className="jr-btn__label">Đồng hồ</span>
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
                    <button type="button" onClick={() => { setMoreOpen(false); setReportOpen(true); }}><Icon name="users" size={15} /> Điểm danh & đánh giá</button>
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

        </div>

        <button type="button" className="jr-hangup" onClick={() => void leave()} aria-label="Leave the call" title="Leave the call">
          <Icon name="phoneOff" size={20} />
        </button>
      </footer>

      {reportOpen ? <CallReport sessionId={sessionId} onClose={() => setReportOpen(false)} /> : null}
      {timerOpen ? <SpeakingTimer onClose={() => setTimerOpen(false)} /> : null}

      {quizOpen ? (
        <QuizPanel sessionId={sessionId} room={room} host={isMentor} onClose={() => setQuizOpen(false)} />
      ) : null}

      {boardOpen ? (
        <WhiteboardPanel sessionId={sessionId} room={room} host={isMentor} onClose={() => setBoardOpen(false)} />
      ) : null}

      {breakoutOpen ? (
        <BreakoutPanel
          sessionId={sessionId}
          host={isMentor}
          state={breakouts}
          onChanged={setBreakouts}
          onClose={() => setBreakoutOpen(false)}
        />
      ) : null}

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
/** Local speaking timer: it does not change other participants' timers. */
function SpeakingTimer({ onClose }: { onClose: () => void }) {
  const [remaining, setRemaining] = useState(60);
  const [deadline, setDeadline] = useState<number | null>(null);
  useEffect(() => {
    if (deadline === null) return undefined;
    const tick = () => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) setDeadline(null);
    };
    const id = window.setInterval(tick, 200);
    return () => window.clearInterval(id);
  }, [deadline]);
  const choose = (seconds: number) => { setDeadline(null); setRemaining(seconds); };
  return <aside className="jr-timer" aria-label="Đồng hồ luyện nói"><div className="jr-timer__head"><strong>Luyện nói</strong><button type="button" onClick={onClose} aria-label="Đóng đồng hồ">×</button></div><p>Đồng hồ riêng trên thiết bị này</p><output className="jr-timer__time" aria-live="off">{Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}</output><div className="jr-timer__presets"><button type="button" onClick={() => choose(60)}>Chuẩn bị · 1 phút</button><button type="button" onClick={() => choose(120)}>Trả lời · 2 phút</button></div><button type="button" className="jr-timer__start" onClick={() => deadline === null ? setDeadline(Date.now() + remaining * 1000) : (setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000))), setDeadline(null))} disabled={remaining === 0}>{deadline === null ? 'Bắt đầu' : 'Tạm dừng'}</button>{remaining === 0 && <p role="status">Đã hết giờ. Chọn thời gian để bắt đầu lại.</p>}</aside>;
}

/**
 * Quiz & polls: the host writes a question, everyone answers, and results show
 * live. A closed quiz reveals the correct option (the API only sends it then).
 */
function QuizPanel({
  sessionId,
  room,
  host,
  onClose,
}: {
  sessionId: string;
  room: string;
  host: boolean;
  onClose: () => void;
}) {
  const [polls, setPolls] = useState<ClassPoll[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [composing, setComposing] = useState(false);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [correct, setCorrect] = useState<number | null>(null);
  const [kind, setKind] = useState<'QUIZ' | 'POLL'>('QUIZ');

  const load = useCallback(async () => {
    try {
      const { polls: next } = await mentorApi.polls(sessionId, room);
      setPolls(next);
    } catch (cause) {
      setError(describeError(cause));
    }
  }, [sessionId, room]);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const { polls: next } = await mentorApi.polls(sessionId, room);
        if (alive) setPolls(next);
      } catch {
        // The next tick retries; the panel keeps the last known question.
      }
    };
    void tick();
    const timer = window.setInterval(tick, 3000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [sessionId, room]);

  const launch = async () => {
    const cleaned = options.map((option) => option.trim()).filter(Boolean);
    if (question.trim().length < 3 || cleaned.length < 2) {
      setError('Write a question and at least two options.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await mentorApi.createPoll(sessionId, room, {
        question: question.trim(),
        options: cleaned,
        kind,
        correctIndex: kind === 'QUIZ' ? correct : null,
      });
      setQuestion('');
      setOptions(['', '']);
      setCorrect(null);
      setComposing(false);
      await load();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  const answer = async (poll: ClassPoll, index: number) => {
    setBusy(true);
    setError(null);
    try {
      const { poll: next } = await mentorApi.answerPoll(sessionId, poll.id, index);
      setPolls((prev) => prev.map((item) => (item.id === next.id ? next : item)));
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  const close = async (poll: ClassPoll) => {
    setBusy(true);
    try {
      const { poll: next } = await mentorApi.closePoll(sessionId, poll.id);
      setPolls((prev) => prev.map((item) => (item.id === next.id ? next : item)));
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  const open = polls.find((poll) => poll.status === 'OPEN') ?? null;
  const previous = polls.filter((poll) => poll.status === 'CLOSED').slice(0, 3);
  const reveal = open ? open.status === 'CLOSED' || host : false;

  return (
    <div
      className="jr-modal-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="jr-modal jr-modal--tool" role="dialog" aria-modal="true" aria-label="Quiz and polls">
        <header className="jr-modal__head">
          <div>
            <h2>Quiz &amp; polls</h2>
            <p className="jr-modal__sub">Ask one question at a time — answers update live for everyone.</p>
          </div>
          <button type="button" className="jr-iconbtn" onClick={onClose} aria-label="Close">
            <Icon name="close" size={18} />
          </button>
        </header>

        {error ? <p className="jr-tool__error">{error}</p> : null}

        {open ? (
          <section className="jr-quiz">
            <div className="jr-quiz__top">
              <span className={`jr-quiz__tag${open.kind === 'POLL' ? ' is-poll' : ''}`}>{open.kind === 'POLL' ? 'Poll' : 'Quiz'}</span>
              <span className="jr-quiz__count">
                {open.totalVotes} answer{open.totalVotes === 1 ? '' : 's'}
              </span>
            </div>
            <h3 className="jr-quiz__question">{open.question}</h3>
            <div className="jr-quiz__options">
              {open.options.map((option) => {
                const answered = open.myChoice !== null || host;
                const isMine = open.myChoice === option.index;
                const isCorrect = reveal && open.correctIndex === option.index;
                const percent = open.totalVotes ? Math.round((option.votes / open.totalVotes) * 100) : 0;
                return (
                  <button
                    key={option.index}
                    type="button"
                    className={`jr-quiz__option${isMine ? ' is-mine' : ''}${isCorrect ? ' is-correct' : ''}`}
                    onClick={() => void answer(open, option.index)}
                    disabled={busy || host || open.myChoice !== null}
                  >
                    <span className="jr-quiz__letter">{String.fromCharCode(65 + option.index)}</span>
                    <span className="jr-quiz__text">{option.text}</span>
                    {answered ? (
                      <>
                        <span className="jr-quiz__bar" aria-hidden="true">
                          <span style={{ width: `${percent}%` }} />
                        </span>
                        <span className="jr-quiz__votes">{option.votes}</span>
                      </>
                    ) : null}
                  </button>
                );
              })}
            </div>
            <div className="jr-quiz__foot">
              {open.myChoice !== null ? <span className="jr-quiz__muted">Your answer is in — waiting for the host.</span> : null}
              {host ? (
                <Button variant="primary" onClick={() => void close(open)} loading={busy}>
                  Close question
                </Button>
              ) : null}
            </div>
          </section>
        ) : (
          <div className="jr-tool__empty">
            <Icon name="presentation" size={28} />
            <p>No question is running right now.</p>
            {host ? (
              <Button variant="primary" onClick={() => setComposing(true)}>
                Start a question
              </Button>
            ) : (
              <p className="jr-quiz__muted">Your mentor will launch one — it appears here automatically.</p>
            )}
          </div>
        )}

        {host && composing ? (
          <section className="jr-quiz jr-quiz--compose">
            <div className="jr-quiz__row">
              <label>
                Type
                <select value={kind} onChange={(event) => setKind(event.target.value as 'QUIZ' | 'POLL')}>
                  <option value="QUIZ">Quiz (one correct answer)</option>
                  <option value="POLL">Poll (no right answer)</option>
                </select>
              </label>
            </div>
            <label className="jr-quiz__field">
              Question
              <input
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="e.g. Which word means “important”?"
                maxLength={500}
              />
            </label>
            <div className="jr-quiz__field">
              <span>Options</span>
              {options.map((option, index) => (
                <div className="jr-quiz__optrow" key={index}>
                  <span className="jr-quiz__letter">{String.fromCharCode(65 + index)}</span>
                  <input
                    value={option}
                    onChange={(event) =>
                      setOptions((prev) => prev.map((value, position) => (position === index ? event.target.value : value)))
                    }
                    placeholder={`Option ${index + 1}`}
                    maxLength={160}
                  />
                  {options.length > 2 ? (
                    <button
                      type="button"
                      className="jr-iconbtn"
                      aria-label={`Remove option ${index + 1}`}
                      onClick={() => {
                        setOptions((prev) => prev.filter((_, position) => position !== index));
                        if (correct === index) setCorrect(null);
                        else if (correct !== null && correct > index) setCorrect(correct - 1);
                      }}
                    >
                      <Icon name="close" size={14} />
                    </button>
                  ) : null}
                  {kind === 'QUIZ' ? (
                    <label className="jr-quiz__correct" title="Mark as the correct answer">
                      <input
                        type="radio"
                        name="correct-option"
                        checked={correct === index}
                        onChange={() => setCorrect(index)}
                      />
                      <span>Correct</span>
                    </label>
                  ) : null}
                </div>
              ))}
              {options.length < 4 ? (
                <button type="button" className="jr-quiz__add" onClick={() => setOptions((prev) => [...prev, ''])}>
                  <Icon name="plus" size={14} /> Add option
                </button>
              ) : null}
            </div>
            <div className="jr-quiz__foot">
              <Button onClick={() => setComposing(false)}>Cancel</Button>
              <Button variant="primary" loading={busy} onClick={() => void launch()}>
                Launch
              </Button>
            </div>
          </section>
        ) : null}

        {host && !composing && !open ? null : null}

        {previous.length > 0 ? (
          <section className="jr-quiz__history">
            <h4>Earlier questions</h4>
            {previous.map((poll) => (
              <div key={poll.id} className="jr-quiz__past">
                <span>{poll.question}</span>
                <span className="jr-quiz__muted">{poll.totalVotes} answers</span>
              </div>
            ))}
          </section>
        ) : null}

        {host && !composing && open ? (
          <button type="button" className="jr-tool__link" onClick={() => setComposing(true)}>
            Ask another question
          </button>
        ) : null}
      </div>
    </div>
  );
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Shared whiteboard. Coordinates are normalised, so every screen draws the
 * same picture; the server keeps one row per room with a revision counter.
 */
function WhiteboardPanel({
  sessionId,
  room,
  host,
  onClose,
}: {
  sessionId: string;
  room: string;
  host: boolean;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const strokesRef = useRef<WhiteboardStroke[]>([]);
  const revisionRef = useRef(0);
  const drawingRef = useRef<WhiteboardStroke | null>(null);
  const sizeRef = useRef({ width: 1, height: 1, dpr: 1 });
  const [strokes, setStrokes] = useState<WhiteboardStroke[]>([]);
  const [, setRevision] = useState(0);
  const [color, setColor] = useState('#f5f3ff');
  const [width, setWidth] = useState(4);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState<string | null>(null);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const { width: cssWidth, height: cssHeight, dpr } = sizeRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const all = drawingRef.current ? [...strokesRef.current, drawingRef.current] : strokesRef.current;
    for (const stroke of all) {
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width;
      ctx.beginPath();
      stroke.points.forEach(([x, y], index) => {
        const px = x * cssWidth;
        const py = y * cssHeight;
        if (index === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      sizeRef.current = { width: rect.width || 1, height: rect.height || 1, dpr };
      redraw();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [redraw]);

  const adopt = useCallback(
    (next: WhiteboardStroke[], revision: number) => {
      strokesRef.current = next;
      revisionRef.current = revision;
      setStrokes(next);
      setRevision(revision);
      redraw();
    },
    [redraw],
  );

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const board = await mentorApi.whiteboard(sessionId, room);
        if (!alive || drawingRef.current) return;
        if (board.revision > revisionRef.current) adopt(board.strokes, board.revision);
        else if (board.revision === revisionRef.current) setStatus('saved');
      } catch (cause) {
        if (alive) setError(describeError(cause));
      }
    };
    void load();
    const timer = window.setInterval(load, 3000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [sessionId, room, adopt]);

  const save = async (next: WhiteboardStroke[]) => {
    setStatus('saving');
    setError(null);
    try {
      const result = await mentorApi.saveWhiteboard(sessionId, room, revisionRef.current, next);
      if (result.saved) {
        revisionRef.current = result.revision;
        setRevision(result.revision);
        setStatus('saved');
      } else {
        adopt(result.strokes, result.revision);
        setStatus('idle');
        setError('Someone else was drawing — the board refreshed. Check your last stroke.');
      }
    } catch (cause) {
      setStatus('idle');
      setError(describeError(cause));
    }
  };

  const pointFrom = (event: ReactPointerEvent<HTMLCanvasElement>): [number, number] => {
    const rect = event.currentTarget.getBoundingClientRect();
    return [clamp01((event.clientX - rect.left) / Math.max(1, rect.width)), clamp01((event.clientY - rect.top) / Math.max(1, rect.height))];
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = { color, width, points: [pointFrom(event)] };
    redraw();
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const current = drawingRef.current;
    if (!current) return;
    current.points.push(pointFrom(event));
    redraw();
  };

  const onPointerUp = () => {
    const current = drawingRef.current;
    if (!current) return;
    drawingRef.current = null;
    if (current.points.length === 1) current.points.push(current.points[0]!);
    const next = [...strokesRef.current, current];
    strokesRef.current = next;
    setStrokes(next);
    redraw();
    void save(next);
  };

  const undo = () => {
    if (drawingRef.current) return;
    const next = strokesRef.current.slice(0, -1);
    strokesRef.current = next;
    setStrokes(next);
    redraw();
    void save(next);
  };

  const clear = () => {
    if (!host) return;
    if (!window.confirm('Clear the whiteboard for everyone?')) return;
    strokesRef.current = [];
    setStrokes([]);
    redraw();
    void save([]);
  };

  const palette = ['#f5f3ff', '#ffd166', '#8ce99a', '#ff8787', '#74c0fc'];

  return (
    <div
      className="jr-modal-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="jr-modal jr-modal--tool jr-modal--board" role="dialog" aria-modal="true" aria-label="Whiteboard">
        <header className="jr-modal__head">
          <div>
            <h2>Whiteboard</h2>
            <p className="jr-modal__sub">
              {strokes.length} stroke{strokes.length === 1 ? '' : 's'} · {status === 'saving' ? 'Saving…' : 'Shared with the room'}
            </p>
          </div>
          <button type="button" className="jr-iconbtn" onClick={onClose} aria-label="Close">
            <Icon name="close" size={18} />
          </button>
        </header>

        {error ? <p className="jr-tool__error">{error}</p> : null}

        <div className="jr-board__bar">
          <div className="jr-board__colors" role="group" aria-label="Pen colour">
            {palette.map((tone) => (
              <button
                key={tone}
                type="button"
                className={`jr-board__color${color === tone ? ' is-on' : ''}`}
                style={{ background: tone }}
                onClick={() => setColor(tone)}
                aria-label={`Use colour ${tone}`}
              />
            ))}
          </div>
          <div className="jr-board__widths" role="group" aria-label="Pen size">
            {[
              { value: 2, label: 'Thin' },
              { value: 4, label: 'Medium' },
              { value: 8, label: 'Thick' },
            ].map((item) => (
              <button
                key={item.value}
                type="button"
                className={`jr-board__width${width === item.value ? ' is-on' : ''}`}
                onClick={() => setWidth(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <span className="jr-board__spacer" />
          <button type="button" className="jr-board__action" onClick={undo} disabled={strokes.length === 0}>
            <Icon name="rotate" size={14} /> Undo
          </button>
          {host ? (
            <button type="button" className="jr-board__action is-danger" onClick={clear} disabled={strokes.length === 0}>
              <Icon name="trash" size={14} /> Clear
            </button>
          ) : null}
        </div>

        <div className="jr-board__canvas-wrap">
          <canvas
            ref={canvasRef}
            className="jr-board__canvas"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerLeave={() => {
              if (drawingRef.current) onPointerUp();
            }}
          />
          {strokes.length === 0 ? <p className="jr-board__hint">Draw here — everyone in the room sees it.</p> : null}
        </div>
      </div>
    </div>
  );
}

/** Host: split the class into rooms and start a timer. Everyone: join / return. */
function BreakoutPanel({
  sessionId,
  host,
  state,
  onChanged,
  onClose,
}: {
  sessionId: string;
  host: boolean;
  state: BreakoutState | null;
  onChanged: (next: BreakoutState) => void;
  onClose: () => void;
}) {
  const [count, setCount] = useState(2);
  const [minutes, setMinutes] = useState(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      onChanged(await mentorApi.createBreakouts(sessionId, count, minutes));
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  const closeAll = async () => {
    setBusy(true);
    setError(null);
    try {
      onChanged(await mentorApi.closeBreakouts(sessionId));
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  const enter = (roomKey: string) => {
    window.location.assign(`/sessions/${sessionId}/room${roomKey === 'main' ? '' : `?room=${encodeURIComponent(roomKey)}`}`);
  };

  return (
    <div
      className="jr-modal-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="jr-modal jr-modal--tool" role="dialog" aria-modal="true" aria-label="Breakout rooms">
        <header className="jr-modal__head">
          <div>
            <h2>Breakout rooms</h2>
            <p className="jr-modal__sub">Split the class into small rooms, each with its own call, chat and board.</p>
          </div>
          <button type="button" className="jr-iconbtn" onClick={onClose} aria-label="Close">
            <Icon name="close" size={18} />
          </button>
        </header>

        {error ? <p className="jr-tool__error">{error}</p> : null}

        {host ? (
          <section className="jr-breakout__form">
            <label>
              Rooms
              <select value={count} onChange={(event) => setCount(Number(event.target.value))}>
                {[2, 3, 4].map((value) => (
                  <option key={value} value={value}>
                    {value} rooms
                  </option>
                ))}
              </select>
            </label>
            <label>
              Timer
              <select value={minutes} onChange={(event) => setMinutes(Number(event.target.value))}>
                {[5, 10, 15, 20, 30].map((value) => (
                  <option key={value} value={value}>
                    {value} minutes
                  </option>
                ))}
              </select>
            </label>
            <Button variant="primary" loading={busy} onClick={() => void create()}>
              Open rooms
            </Button>
            {state?.open ? (
              <Button loading={busy} onClick={() => void closeAll()}>
                Close all
              </Button>
            ) : null}
          </section>
        ) : null}

        {state?.open ? (
          <div className="jr-breakout__rooms">
            {state.rooms.map((item) => (
              <article key={item.id} className="jr-breakout__room">
                <header>
                  <h3>{item.name}</h3>
                  <span>{item.members.length}</span>
                </header>
                <p className="jr-breakout__members">
                  {item.members.length > 0 ? item.members.map((member) => member.displayName).join(', ') : 'Empty'}
                </p>
                <div className="jr-breakout__foot">
                  <button type="button" className="jr-tool__link" onClick={() => enter(item.roomKey)}>
                    {host ? 'Join room' : 'Join'}
                  </button>
                  {state.myRoom?.id === item.id ? <span className="jr-breakout__mine">Your room</span> : null}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="jr-tool__empty">
            <Icon name="grid" size={28} />
            <p>No breakout rooms are open.</p>
            {host ? <p className="jr-quiz__muted">Open 2–4 rooms and the students in this call are split evenly.</p> : null}
          </div>
        )}

        <p className="jr-breakout__note">
          A breakout is a separate call inside this session — chat, reactions and the whiteboard stay in that room. When
          the timer ends, everyone returns to the main room.
        </p>
      </div>
    </div>
  );
}

/** Chat bubbles: plain text, clickable links, and inline GIFs/images. */
function ChatMessageBody({ body }: { body: string }) {
  const parts = body.split(/(https?:\/\/[^\s<>"']+)/g);
  return (
    <div className="jr-msg__bubble">
      {parts.map((part, index) => {
        if (!/^https?:\/\//i.test(part)) return <span key={index}>{part}</span>;
        const url = part.replace(/[.,!?)\]]+$/, '');
        const isImage = /\.(gif|png|jpe?g|webp|avif)(\?[^\s]*)?$/i.test(url);
        if (isImage) {
          return (
            <a key={index} className="jr-msg__media" href={url} target="_blank" rel="noopener noreferrer">
              <img src={url} alt="Shared image" loading="lazy" />
            </a>
          );
        }
        return (
          <a key={index} href={url} target="_blank" rel="noopener noreferrer">
            {url}
          </a>
        );
      })}
    </div>
  );
}

function RemoteTile({ peer, participant }: { peer: Peer; participant?: RoomParticipant }) {
  const [live, setLive] = useState(false);
  const [micLive, setMicLive] = useState(true);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const stream = peer.stream;
    const el = videoRef.current;
    const evaluate = () => {
      const videos = stream.getVideoTracks();
      // A track can exist and still carry no frames (camera switched off by the
      // sender). Presence says whether their camera is really on; the track
      // events cover the moment frames start or stop.
      const playing = !!el && el.readyState >= 2 && el.videoWidth > 0;
      setLive(
        videos.some((track) => track.readyState === 'live' && track.enabled && !track.muted) ||
          (playing && videos.some((track) => track.readyState === 'live')),
      );
      const audios = stream.getAudioTracks();
      setMicLive(audios.length === 0 ? true : audios.some((track) => !track.muted && track.enabled));
    };
    // The tile mounts with an empty stream: when the first track lands the
    // element has to be pointed at the stream and kicked into playback again,
    // otherwise the <video> stays black even though frames are arriving.
    const attach = () => {
      if (!el) return;
      if (el.srcObject !== stream) el.srcObject = stream;
      void el.play().catch(() => undefined);
      window.setTimeout(evaluate, 150);
    };
    attach();
    const tracks = stream.getTracks();
    for (const track of tracks) {
      track.addEventListener('mute', evaluate);
      track.addEventListener('unmute', evaluate);
      track.addEventListener('ended', evaluate);
    }
    stream.addEventListener('addtrack', attach);
    stream.addEventListener('removetrack', evaluate);
    el?.addEventListener('loadeddata', evaluate);
    el?.addEventListener('playing', evaluate);
    // First frame can arrive without a track event after renegotiation.
    const retry = window.setTimeout(evaluate, 1200);
    return () => {
      window.clearTimeout(retry);
      for (const track of tracks) {
        track.removeEventListener('mute', evaluate);
        track.removeEventListener('unmute', evaluate);
        track.removeEventListener('ended', evaluate);
      }
      stream.removeEventListener('addtrack', attach);
      stream.removeEventListener('removetrack', evaluate);
      el?.removeEventListener('loadeddata', evaluate);
      el?.removeEventListener('playing', evaluate);
    };
  }, [peer.stream]);

  // Presence is authoritative for "camera is off"; default to on until it loads.
  const cameraOn = participant?.screenOn || participant?.camOn !== false;
  const showVideo = live && cameraOn;
  const muted = participant ? !participant.micOn : !micLive;

  return (
    <div className={`jr-tile${showVideo ? '' : ' is-avatar'}`}>
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
        className={showVideo ? undefined : 'is-hidden'}
      />
      {!showVideo ? (
        <div className="jr-tile__avatar">
          <UserAvatar
            userId={peer.userId}
            avatarUpdatedAt={participant?.avatarUpdatedAt}
            name={peer.displayName}
            size={92}
          />
          <span className="jr-tile__avatar-note">
            <Icon name="video" size={12} />
            Camera off
          </span>
        </div>
      ) : null}
      <span className="jr-tile__label">
        {peer.displayName}{participant?.screenOn ? ' · đang trình chiếu' : ''}
        {muted ? (
          <i className="jr-tile__muted" title="Microphone off">
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

interface CallReportData {
  attendance: Array<{ id: string; name: string; joinedAt: string; leftAt: string | null; lastSeenAt: string }>;
  feedback: Array<{ id: string; name: string; rating: number; comment: string; createdAt: string }>;
}
function CallReport({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [report, setReport] = useState<CallReportData | null>(null);
  const [failure, setFailure] = useState('');
  useEffect(() => { let active = true; void api.get<CallReportData>(`/api/mentor/sessions/${sessionId}/report`).then((data) => { if (active) setReport(data); }).catch((cause) => { if (active) setFailure(describeError(cause)); }); return () => { active = false; }; }, [sessionId]);
  const exportCsv = () => {
    if (!report) return;
    const cell = (value: string) => `"${(/^[=+@\-\t\r]/.test(value) ? "'" + value : value).replace(/"/g, '""')}"`;
    const rows = [['Tên', 'Tham gia', 'Rời / lần cuối thấy', 'Trạng thái'], ...report.attendance.map((a) => [a.name, a.joinedAt, a.leftAt ?? a.lastSeenAt, a.leftAt ? 'Đã rời' : 'Lần cuối thấy'])];
    const url = URL.createObjectURL(new Blob(['\uFEFF' + rows.map((row) => row.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'diem-danh.csv'; document.body.appendChild(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <div className="jr-report-overlay" role="presentation"><section className="jr-report" role="dialog" aria-modal="true" aria-labelledby="call-report-title"><header><h2 id="call-report-title">Điểm danh & đánh giá</h2><button type="button" onClick={onClose} aria-label="Đóng">×</button></header><p>Thời điểm rời có thể không chính xác khi mất mạng hoặc đóng trình duyệt. Danh sách tối đa 200 lượt tham gia và 100 đánh giá gần nhất.</p>
    {failure && <p role="alert">{failure}</p>}{!report && !failure && <p>Đang tải…</p>}
    {report && <><button type="button" className="jr-report__export" onClick={exportCsv}>Tải điểm danh CSV</button><h3>Lượt tham gia ({report.attendance.length})</h3>{report.attendance.length === 0 && <p>Chưa có lượt tham gia.</p>}<ul>{report.attendance.map((a) => <li key={a.id}><strong>{a.name}</strong><span>Vào {new Date(a.joinedAt).toLocaleString('vi-VN')} · {a.leftAt ? `Rời ${new Date(a.leftAt).toLocaleString('vi-VN')}` : `Lần cuối thấy ${new Date(a.lastSeenAt).toLocaleString('vi-VN')}`}</span></li>)}</ul><h3>Đánh giá ({report.feedback.length})</h3>{report.feedback.length === 0 && <p>Chưa có đánh giá.</p>}<ul>{report.feedback.map((f) => <li key={f.id}><strong>{f.name} · {f.rating}/5</strong><span>{f.comment || 'Không có nhận xét.'}</span></li>)}</ul></>}
  </section></div>;
}
