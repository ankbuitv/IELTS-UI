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
  const [selection, setSelection] = useState('unchanged');
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
      setSchools(approved); setSelection('unchanged'); setOpen(true);
    } catch (error) { toast.push(describeError(error), 'error'); } finally { setBusy(false); }
  };
  return <><Button variant="primary" loading={busy} onClick={() => void start()}><Icon name="video" size={15} /> {label}</Button>
    <Modal open={open} title="Chọn nhận diện buổi học" onClose={()=>setOpen(false)} actions={<><Button onClick={()=>setOpen(false)}>Hủy</Button><Button variant="primary" loading={busy} onClick={()=>void enter(selection==='unchanged'?undefined:selection==='none'?null:selection)}>Vào phòng</Button></>}>
      <p>Chọn logo lớp hoặc logo trường đã duyệt. Đây vẫn là phòng của lớp; không thể đổi nhận diện khi phòng đang có người.</p>
      <Field label="Nhận diện phòng học">{id=><Select id={id} value={selection} onChange={e=>setSelection(e.target.value)}><option value="unchanged">Giữ lựa chọn hiện tại (nếu có)</option><option value="none">Theo lớp · dùng logo lớp</option>{schools.map(s=><option key={s.id} value={s.id}>Theo trường · {s.name}</option>)}</Select>}</Field>
    </Modal></>;
}
