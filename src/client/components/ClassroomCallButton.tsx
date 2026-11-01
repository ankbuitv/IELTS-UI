import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, describeError } from '../lib/api';
import { Button, useToast } from './ui';
import { Icon } from './Icon';

/** Teachers create/reopen the room; students can enter once it exists. */
export function ClassroomCallButton({ classroomId, label = 'Vào phòng học' }: { classroomId: string; label?: string }) {
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const toast = useToast();
  return <Button variant="primary" loading={busy} onClick={async () => {
    setBusy(true);
    try {
      const room = await api.post<{ sessionId: string }>(`/api/classrooms/${encodeURIComponent(classroomId)}/room`, {});
      navigate(`/sessions/${encodeURIComponent(room.sessionId)}/room`);
    } catch (error) { toast.push(describeError(error), 'error'); setBusy(false); }
  }}><Icon name="video" size={15} /> {label}</Button>;
}
