import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, describeError } from '../lib/api';
import { Button, Field, Modal, Select, useToast } from './ui';
import { Icon } from './Icon';

type School = { id: string; name: string; status: string; member_status: string };
/** Teachers choose an approved school before starting; students join the existing room. */
export function ClassroomCallButton({ classroomId, label = 'Vào phòng học', canChooseSchool = false }: { classroomId: string; label?: string; canChooseSchool?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [schools, setSchools] = useState<School[]>([]);
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState('personal');
  const navigate = useNavigate();
  const toast = useToast();
  const enter = async (schoolId?: string | null) => {
    setBusy(true);
    try {
      const room = await api.post<{ sessionId: string }>(`/api/classrooms/${encodeURIComponent(classroomId)}/room`, schoolId === undefined ? {} : { schoolId });
      setOpen(false); navigate(`/sessions/${encodeURIComponent(room.sessionId)}/room`);
    } catch (error) { toast.push(describeError(error), 'error'); } finally { setBusy(false); }
  };
  const start = async () => {
    if (!canChooseSchool) { await enter(); return; }
    setBusy(true);
    try {
      const data = await api.get<{schools:School[]}>('/api/schools');
      const approved = data.schools.filter(s => s.status === 'APPROVED' && s.member_status === 'ACTIVE');
      if (!approved.length) { await enter(); return; }
      setSchools(approved); setSelection('personal'); setOpen(true);
    } catch (error) { toast.push(describeError(error), 'error'); } finally { setBusy(false); }
  };
  return <><Button variant="primary" loading={busy} onClick={() => void start()}><Icon name="video" size={15} /> {label}</Button>
    <Modal open={open} title="Chọn tư cách mở phòng" onClose={()=>setOpen(false)} actions={<><Button onClick={()=>setOpen(false)}>Hủy</Button><Button variant="primary" loading={busy} onClick={()=>void enter(selection==='personal'?null:selection)}>Vào phòng</Button></>}>
      <p>Bạn muốn mở phòng với tư cách cá nhân hay đại diện một trường? Đây vẫn là phòng của lớp; tư cách không thể thay đổi khi phòng đang có người.</p>
      <Field label="Tư cách mở phòng">{id=><Select id={id} value={selection} onChange={e=>setSelection(e.target.value)}><option value="personal">Cá nhân</option>{schools.map(s=><option key={s.id} value={s.id}>Đại diện trường · {s.name}</option>)}</Select>}</Field>
    </Modal></>;
}
