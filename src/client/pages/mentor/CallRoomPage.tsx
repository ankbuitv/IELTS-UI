import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { mentorApi } from '../../lib/mentor-api';
import { describeError } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { Button, Loading, Notice } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { MentorAvatar, formatWhen } from '../../components/mentor/MentorBits';
import type { MentorChatMessage, MentorRoomState, MentorSignal } from '@shared/mentor';

const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
const POLL_MS = 2500;

interface Peer {
  userId: string;
  displayName: string;
  stream: MediaStream;
}

/**
 * The call room — a live video session between a mentor and a student.
 *
 * Media is peer-to-peer WebRTC (mesh): D1 relays the SDP/ICE signalling
 * envelopes (`mentor_signals`) and the room polls for them, so no realtime
 * service is needed for a two-or-three person coaching call. The room also
 * carries chat, structured notes and the roster with hand-raises.
 */
export function CallRoomPage() {
  const { sessionId = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [phase, setPhase] = useState<'loading' | 'prejoin' | 'room' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<MentorRoomState | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [screenOn, setScreenOn] = useState(false);
  const [handRaised, setHandRaised] = useState(false);
  const [panel, setPanel] = useState<'chat' | 'notes' | 'people'>('chat');
  const [panelOpen, setPanelOpen] = useState(true);
  const [draft, setDraft] = useState('');
  const [notes, setNotes] = useState('');
  const [peers, setPeers] = useState<Peer[]>([]);
  const [elapsed, setElapsed] = useState(0);

  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const pcsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const participantsRef = useRef<MentorRoomState['participants']>([]);
  const lastSignalIdRef = useRef<string | null>(null);
  const sessionRef = useRef<string>(sessionId);

  // Keep the signalling helpers pointed at the current session without touching
  // refs during render.
  useEffect(() => {
    sessionRef.current = sessionId;
  }, [sessionId]);

  // ---------------------------------------------------------------- media
  const stopMedia = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    screenStreamRef.current = null;
  }, []);

  const startMedia = useCallback(async () => {
    if (localStreamRef.current) return localStreamRef.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      return stream;
    } catch {
      try {
        const audioOnly = await navigator.mediaDevices.getUserMedia({ audio: true });
        localStreamRef.current = audioOnly;
        setCamOn(false);
        return audioOnly;
      } catch {
        setMicOn(false);
        setCamOn(false);
        return null;
      }
    }
  }, []);

  // ------------------------------------------------------------- WebRTC
  const addPeer = useCallback((userId: string, displayName: string, initiator: boolean) => {
    if (pcsRef.current.has(userId)) return pcsRef.current.get(userId)!;
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pcsRef.current.set(userId, pc);

    const remoteStream = new MediaStream();
    pc.ontrack = (event) => {
      event.streams[0]?.getTracks().forEach((track) => remoteStream.addTrack(track));
      setPeers((prev) => {
        const without = prev.filter((peer) => peer.userId !== userId);
        return [...without, { userId, displayName, stream: remoteStream }];
      });
    };
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        void mentorApi.signal(sessionRef.current, {
          kind: 'CANDIDATE',
          targetId: userId,
          payload: JSON.stringify(event.candidate),
        }).catch(() => undefined);
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        pc.close();
        pcsRef.current.delete(userId);
        setPeers((prev) => prev.filter((peer) => peer.userId !== userId));
      }
    };

    const local = localStreamRef.current;
    local?.getTracks().forEach((track) => pc.addTrack(track, local));

    if (initiator) {
      void pc
        .createOffer()
        .then((offer) => pc.setLocalDescription(offer).then(() => offer))
        .then((offer) =>
          mentorApi.signal(sessionRef.current, {
            kind: 'OFFER',
            targetId: userId,
            payload: JSON.stringify(offer),
          }),
        )
        .catch(() => undefined);
    }
    return pc;
  }, []);

  const handleSignal = useCallback(
    async (signal: MentorSignal) => {
      const fromName = participantsRef.current.find((p) => p.userId === signal.senderId)?.displayName ?? 'Guest';
      let pc = pcsRef.current.get(signal.senderId);
      if (!pc) pc = addPeer(signal.senderId, fromName, false);

      try {
        if (signal.kind === 'OFFER') {
          await pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(signal.payload)));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await mentorApi.signal(sessionRef.current, {
            kind: 'ANSWER',
            targetId: signal.senderId,
            payload: JSON.stringify(answer),
          });
        } else if (signal.kind === 'ANSWER') {
          if (pc.signalingState === 'have-local-offer') {
            await pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(signal.payload)));
          }
        } else if (signal.kind === 'CANDIDATE') {
          await pc.addIceCandidate(new RTCIceCandidate(JSON.parse(signal.payload)));
        } else if (signal.kind === 'BYE') {
          pc.close();
          pcsRef.current.delete(signal.senderId);
          setPeers((prev) => prev.filter((peer) => peer.userId !== signal.senderId));
        }
      } catch {
        // A malformed or stale envelope is dropped: the next poll re-syncs.
      }
    },
    [addPeer],
  );

  // ---------------------------------------------------------------- poll
  const selfId = user?.id ?? '';
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
        // Everyone present (except me) gets a peer connection; the lexicographically
        // smaller id initiates the offer so both sides don't glare.
        for (const participant of next.participants) {
          if (participant.userId === selfId) continue;
          if (pcsRef.current.has(participant.userId)) continue;
          const initiator = selfId < participant.userId;
          addPeer(participant.userId, participant.displayName, initiator);
        }
      } catch {
        // Polling hiccup: the next tick retries.
      }
    };
    void tick();
    const interval = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(interval);
    };
  }, [phase, sessionId, selfId, addPeer, handleSignal]);

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
  }, [sessionId]);

  // Attach the local preview whenever it appears.
  useEffect(() => {
    if (localVideoRef.current && localStreamRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
    }
  }, [phase, camOn, peers.length, panelOpen]);

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
    const stream = await startMedia();
    if (localVideoRef.current && stream) localVideoRef.current.srcObject = stream;
    try {
      await mentorApi.join(sessionId);
      setPhase('room');
    } catch (cause) {
      setError(describeError(cause));
      setPhase('error');
    }
  };

  const leave = async () => {
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
      // Restore camera track on every peer.
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
        if (sender && track) void sender.replaceTrack(track);
      });
      if (track) track.onended = () => void toggleScreen();
    } catch {
      // The user declined the picker.
    }
  };

  const toggleHand = async () => {
    const next = !handRaised;
    setHandRaised(next);
    try {
      await mentorApi.raiseHand(sessionId, next);
    } catch {
      setHandRaised(!next);
    }
  };

  const send = async () => {
    const body = draft.trim();
    if (!body) return;
    setDraft('');
    try {
      const { message } = await mentorApi.sendMessage(sessionId, body);
      setState((prev) => (prev ? { ...prev, messages: [...prev.messages, message] } : prev));
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

  const clock = useMemo(() => {
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }, [elapsed]);

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

  const session = state?.session;
  const isMentor = session?.mentorId === user?.id;

  if (phase === 'prejoin') {
    return (
      <div className="room-prejoin">
        <div className="room-prejoin__card">
          <div className="room-prejoin__preview">
            <video ref={localVideoRef} autoPlay playsInline muted />
            {!camOn ? (
              <div className="room-tile__avatar">
                <Icon name="video" size={28} />
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
            <div className="room-prejoin__toggles">
              <button
                type="button"
                className={`room-btn${micOn ? '' : ' room-btn--off'}`}
                aria-label={micOn ? 'Mute microphone' : 'Unmute microphone'}
                onClick={() => setMicOn((value) => !value)}
              >
                <Icon name="mic" size={20} />
              </button>
              <button
                type="button"
                className={`room-btn${camOn ? '' : ' room-btn--off'}`}
                aria-label={camOn ? 'Turn camera off' : 'Turn camera on'}
                onClick={() => setCamOn((value) => !value)}
              >
                <Icon name="video" size={20} />
              </button>
            </div>
            <Button variant="primary" size="lg" block onClick={join}>
              <Icon name="video" size={16} />
              Join now
            </Button>
            <Button variant="glass" block onClick={() => navigate('/my-sessions')} style={{ marginTop: 10 }}>
              Not now
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="room">
      <header className="room__top">
        <div className="room__title">
          <Icon name="video" size={18} />
          {session?.topic ?? 'Session'}
          <span className="room__live">Live</span>
        </div>
        <span className="room__timer">{clock}</span>
        <div className="room__top-right">
          <span className="mchip mchip--violet" style={{ background: 'rgba(255,255,255,0.12)', color: '#fff', borderColor: 'transparent' }}>
            <Icon name="users" size={12} />
            {state?.participants.length ?? 1} in room
          </span>
          <button
            type="button"
            className="room-btn"
            style={{ width: 42, height: 42 }}
            onClick={() => setPanelOpen((value) => !value)}
            aria-label="Toggle side panel"
          >
            <Icon name="bubble" size={18} />
          </button>
        </div>
      </header>

      <div className="room__body">
        <div className={`room__stage${peers.length === 0 ? ' room__stage--solo' : ''}`}>
          <div className="room-tile room-tile--self">
            <video ref={localVideoRef} autoPlay playsInline muted />
            {!camOn ? (
              <div className="room-tile__avatar">
                <Icon name="user" size={30} />
              </div>
            ) : null}
            <span className="room-tile__name">
              You ({user?.displayName ?? 'Me'})
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
            <div key={peer.userId} className="room-tile">
              <RemoteVideo stream={peer.stream} />
              <div className="room-tile__avatar">
                <Icon name="user" size={30} />
              </div>
              <span className="room-tile__name">
                {peer.displayName}
                {state?.participants.find((p) => p.userId === peer.userId)?.handRaised ? (
                  <Icon name="hand" size={13} />
                ) : null}
              </span>
            </div>
          ))}

          {peers.length === 0 ? (
            <div className="room-tile room-tile--waiting" style={{ gridColumn: '1 / -1', minHeight: 120 }}>
              <Icon name="users" size={26} />
              <div>
                <strong>Waiting for {isMentor ? 'your student' : 'your mentor'} to join…</strong>
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
                </div>
                <div className="room__composer">
                  <input
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void send();
                    }}
                    placeholder="Write a message…"
                    aria-label="Chat message"
                  />
                  <button type="button" onClick={send} aria-label="Send message">
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
                <Button variant="primary" onClick={saveNotes} disabled={!notes.trim()}>
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
                {(state?.participants ?? []).map((participant) => (
                  <div key={participant.userId} className="room-roster-item">
                    <MentorAvatar name={participant.displayName} tone={participant.userId === user?.id ? 'sun' : 'violet'} />
                    <div>
                      <div className="room-roster-item__name">
                        {participant.displayName}
                        {participant.userId === user?.id ? ' (you)' : ''}
                      </div>
                      <div className="room-roster-item__role">
                        {participant.userId === session?.mentorId ? 'mentor' : 'student'}
                      </div>
                    </div>
                    {participant.handRaised ? (
                      <span className="room-roster-item__hand" title="Hand raised">
                        <Icon name="hand" size={17} />
                      </span>
                    ) : null}
                  </div>
                ))}
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
        <button type="button" className="room-btn room-btn--leave" onClick={leave}>
          <Icon name="phoneOff" size={19} />
          Leave
        </button>
      </footer>
    </div>
  );
}

/** Binds a remote MediaStream to a <video> element. */
function RemoteVideo({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return <video ref={ref} autoPlay playsInline />;
}

export default CallRoomPage;
