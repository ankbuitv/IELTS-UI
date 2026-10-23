import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { describeError } from '../../lib/api';
import { useAsync } from '../../hooks/useAsync';
import { mentorApi } from '../../lib/mentor-api';
import { useAuth } from '../../context/AuthContext';
import { formatDateTime } from '../../lib/format';
import { Badge, Button, Card, EmptyState, Loading, TextInput, useToast } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { MentorAvatar } from '../../components/mentor/MentorBits';
import type { MentorClassMessage } from '@shared/mentor';

function formatCoins(coins: number): string {
  return coins <= 0 ? 'Free' : `${coins.toLocaleString('en-US')} coins`;
}

/**
 * A single classroom: roster, schedule, the group chat and one shared call
 * room the whole class can jump into.
 */
export function ClassDetailPage() {
  const { classId = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const [refreshKey, setRefreshKey] = useState(0);
  const { data, error, loading } = useAsync(
    useCallback(() => mentorApi.classDetail(classId), [classId, refreshKey]),
  );
  const klass = data?.class ?? null;

  // ---------------------------------------------------------------- roster
  const members = klass?.members ?? [];
  const isMentor = klass?.mentorId === user?.id;
  const isMember = isMentor || members.some((member) => member.userId === user?.id);

  // ---------------------------------------------------------------- chat
  const [messages, setMessages] = useState<MentorClassMessage[]>([]);
  const [chatBody, setChatBody] = useState('');
  const [chatBusy, setChatBusy] = useState(false);

  const loadMessages = useCallback(async () => {
    if (!classId) return;
    try {
      const result = await mentorApi.classMessages(classId);
      setMessages(result.messages);
    } catch {
      // Polling failure is non-fatal; the next tick retries.
    }
  }, [classId]);

  useEffect(() => {
    if (!isMember) return undefined;
    void loadMessages();
    const timer = setInterval(() => void loadMessages(), 4500);
    return () => clearInterval(timer);
  }, [isMember, loadMessages]);

  const send = async () => {
    if (!chatBody.trim()) return;
    setChatBusy(true);
    try {
      const result = await mentorApi.postClassMessage(classId, chatBody.trim());
      setMessages((current) => [...current, result.message]);
      setChatBody('');
    } catch (sendError) {
      toast.push(describeError(sendError), 'error');
    } finally {
      setChatBusy(false);
    }
  };

  // ---------------------------------------------------------------- call
  const [callBusy, setCallBusy] = useState(false);
  const joinCall = async () => {
    setCallBusy(true);
    try {
      const result = await mentorApi.classRoom(classId);
      navigate(`/sessions/${result.sessionId}/room`);
    } catch (callError) {
      toast.push(describeError(callError), 'error');
    } finally {
      setCallBusy(false);
    }
  };

  // ---------------------------------------------------------------- delete
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const canDelete = isMentor || user?.role === 'ADMIN';
  const removeClass = async () => {
    setDeleteBusy(true);
    try {
      await mentorApi.deleteClass(classId);
      toast.push('Class deleted.', 'success');
      navigate('/classes');
    } catch (deleteError) {
      toast.push(describeError(deleteError), 'error');
      setDeleteBusy(false);
      setDeleteArmed(false);
    }
  };

  if (loading && !klass) return <Loading label="Loading the classroom…" />;
  if (error || !klass) {
    return (
      <EmptyState icon="presentation" title="Class not found">
        <p className="small muted">{error ? describeError(error) : 'This class may have been removed.'}</p>
        <Link to="/classes" className="btn btn--secondary">
          <Icon name="chevronRight" size={14} />
          Back to classes
        </Link>
      </EmptyState>
    );
  }

  return (
    <div className="stack">
      <Link to="/classes" className="btn btn--ghost" style={{ alignSelf: 'flex-start' }}>
        <Icon name="chevronRight" size={14} />
        All classes
      </Link>

      <header className="mentor-hero mentor-hero--class">
        <div className="mentor-hero__copy">
          <div className="row">
            <span className="mchip mchip--coral">
              <Icon name="users" size={12} />
              CLASSROOM
            </span>
            <span className="mchip">
              <Icon name="star" size={12} />
              {klass.level}
            </span>
            {isMember ? <Badge tone="success">Member</Badge> : null}
          </div>
          <h1>{klass.title}</h1>
          <p className="lead">{klass.description}</p>
          <div className="row">
            <MentorAvatar
              name={klass.mentorName}
              userId={klass.mentorId}
              avatarUpdatedAt={klass.mentorAvatarUpdatedAt}
              online
            />
            <div>
              <div className="mentor-hero__mentor-name">{klass.mentorName}</div>
              <div className="tiny muted">{klass.memberCount} {klass.memberCount === 1 ? 'member' : 'members'}</div>
            </div>
          </div>
          <div className="row">
            <Button
              variant={klass.status !== 'OPEN' ? 'ghost' : 'primary'}
              disabled={klass.status !== 'OPEN' || callBusy}
              loading={callBusy}
              onClick={() => void joinCall()}
              title={klass.status !== 'OPEN' ? 'This class has ended.' : 'Open the class call room'}
            >
              <Icon name="video" size={15} />
              Join class call
            </Button>
            {!isMember ? (
              <Button
                variant="sun"
                onClick={async () => {
                  try {
                    await mentorApi.joinClass(klass.id);
                    toast.push('Welcome to the class!', 'success');
                    setRefreshKey((key) => key + 1);
                  } catch (joinError) {
                    toast.push(describeError(joinError), 'error');
                  }
                }}
              >
                <Icon name="calendar" size={15} />
                Join this class
              </Button>
            ) : null}
            <span className="tiny muted">
              Calls open in the shared class room — say hello in the chat first if you like.
            </span>
          </div>
          {canDelete ? (
            <div className="row" style={{ marginTop: 6 }}>
              {deleteArmed ? (
                <>
                  <Button variant="danger" loading={deleteBusy} onClick={() => void removeClass()}>
                    <Icon name="trash" size={14} />
                    Yes — delete “{klass.title}” forever
                  </Button>
                  <Button disabled={deleteBusy} onClick={() => setDeleteArmed(false)}>
                    Keep class
                  </Button>
                </>
              ) : (
                <Button variant="ghost" onClick={() => setDeleteArmed(true)}>
                  <Icon name="trash" size={14} />
                  Delete class
                </Button>
              )}
            </div>
          ) : null}
        </div>
        <aside className="mentor-hero__facts">
          <div>
            <span className="fact-label">Schedule</span>
            <span className="fact-value">{formatDateTime(klass.startsAt)} → {formatDateTime(klass.endsAt)}</span>
          </div>
          <div>
            <span className="fact-label">Seats</span>
            <span className="fact-value">
              {klass.memberCount}/{klass.capacity}
            </span>
          </div>
          <div>
            <span className="fact-label">Price</span>
            <span className="fact-value">{formatCoins(klass.priceCoins)}</span>
          </div>
          <div>
            <span className="fact-label">Status</span>
            <span className="fact-value">{klass.status !== 'OPEN' ? 'Closed' : 'Open'}</span>
          </div>
        </aside>
      </header>

      <div className="grid grid--2">
        <Card title="Group chat" hint="Everyone in the class sees this feed.">
          <div className="class-chat">
            {messages.length === 0 ? (
              <p className="tiny muted">No messages yet — break the ice.</p>
            ) : (
              messages.map((message) => (
                <div key={message.id} className={message.senderId === user?.id ? 'class-chat__row class-chat__row--self' : 'class-chat__row'}>
                  {message.senderId !== user?.id ? (
                    <MentorAvatar
                      name={message.senderName}
                      userId={message.senderId}
                      avatarUpdatedAt={message.senderAvatarUpdatedAt}
                      size="md"
                    />
                  ) : null}
                  <div>
                    {message.senderId !== user?.id ? (
                      <div className="class-chat__author">
                        {message.senderName} <span className="tiny muted">{formatDateTime(message.createdAt)}</span>
                      </div>
                    ) : (
                      <div className="class-chat__author class-chat__author--self">
                        You <span className="tiny muted">{formatDateTime(message.createdAt)}</span>
                      </div>
                    )}
                    <div className="class-chat__bubble">{message.body}</div>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <TextInput
              aria-label="Message the class"
              value={chatBody}
              onChange={(event) => setChatBody(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
              placeholder="Type a message to the class…"
            />
            <Button variant="primary" loading={chatBusy} onClick={() => void send()} disabled={!chatBody.trim()}>
              <Icon name="send" size={15} />
              Send
            </Button>
          </div>
        </Card>

        <Card title="Roster" hint={`${members.length} of ${klass.capacity} seats taken`}>
          <div className="chat-members">
            <div className="chat-member chat-member--lead">
              <MentorAvatar
                name={klass.mentorName}
                userId={klass.mentorId}
                avatarUpdatedAt={klass.mentorAvatarUpdatedAt}
                size="md"
              />
              <div>
                <strong>{klass.mentorName}</strong>
                <div className="tiny muted">Mentor · session lead</div>
              </div>
              <span className="member-since">Since {formatDateTime(klass.createdAt)}</span>
            </div>
            {members.map((member) => (
              <div className="chat-member" key={member.userId}>
                <MentorAvatar
                  name={member.displayName}
                  userId={member.userId}
                  avatarUpdatedAt={member.avatarUpdatedAt}
                  size="md"
                />
                <div>
                  <strong>{member.displayName}</strong>
                  <div className="tiny muted">Member</div>
                </div>
                <span className="member-since">Joined {formatDateTime(member.joinedAt)}</span>
              </div>
            ))}
            {members.length === 0 ? <p className="tiny muted">No members yet — share the class to fill the seats.</p> : null}
          </div>
        </Card>
      </div>
    </div>
  );
}
