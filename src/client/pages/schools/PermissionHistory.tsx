import {useAsync} from '../../hooks/useAsync';
import {api} from '../../lib/api';
type Row={id:string;createdAt:string;actorId:string|null;actorEmail:string|null;targetId:string|null;before:string[]|null;after:string[]};
const labels:Record<string,string>={MANAGE_GROUPS:'Quản lý tổ',MANAGE_CALENDAR:'Quản lý lịch',REVIEW_ALL:'Duyệt giáo án'};
const render=(values:string[]|null)=>values===null?'Không ghi nhận':values.length?values.map(v=>labels[v]??v).join(', '):'Không có quyền';
export function PermissionHistory({schoolId,members,version}:{schoolId:string;members:Array<{user_id:string;email:string;display_name:string|null}>;version:number}){
 const data=useAsync(()=>api.get<{history:Row[]}>(`/api/schools/${encodeURIComponent(schoolId)}/permission-history`),[schoolId,version]);
 return <section className="sd-permission-history"><h3>Lịch sử quyền trường</h3><p>100 thay đổi gần nhất cho các quyền quản lý trường. Những bản ghi cũ có thể không có trạng thái trước; không bao gồm các loại quyền khác.</p>{data.error&&<p role="alert">{data.error}</p>}{data.loading&&!data.data&&<p>Đang tải…</p>}{data.data?.history.map(row=><article key={row.id}><strong>{new Date(row.createdAt).toLocaleString('vi-VN')}</strong><span>Người đổi: {row.actorEmail??row.actorId??'Không xác định'}</span><span>Nhân sự: {members.find(m=>m.user_id===row.targetId)?.display_name||members.find(m=>m.user_id===row.targetId)?.email||row.targetId||'Không xác định'}</span><small>Trước: {render(row.before)}</small><small>Sau: {render(row.after)}</small></article>)}{data.data&&!data.data.history.length&&<p>Chưa có lịch sử quyền.</p>}</section>;
}
