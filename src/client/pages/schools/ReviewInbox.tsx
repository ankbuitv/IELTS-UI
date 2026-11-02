import {useAsync} from '../../hooks/useAsync';
import {api} from '../../lib/api';
type Item={id:string;title:string;subject:string;group_name:string;author_name:string;created_at:string};
export function ReviewInbox({school,onReview}:{school:{id:string;name:string};onReview:()=>void}){
 const data=useAsync(()=>api.get<{total:number;items:Item[]}>(`/api/schools/${encodeURIComponent(school.id)}/pending-reviews`),[school.id]);
 return <div className="sd-window__body sd-audit"><header><h2>Hộp việc cần duyệt</h2><p>{school.name} · giáo án bạn có quyền xử lý</p><button type="button" disabled={data.loading} onClick={()=>void data.reload()}>Làm mới</button> <button type="button" onClick={onReview}>Mở duyệt giáo án</button></header><p>Chỉ tính giáo án chờ duyệt thuộc phạm vi của bạn và không bao gồm bài do chính bạn gửi. Kiểm tra chi tiết, tệp đính kèm và phê duyệt ở cửa sổ Duyệt giáo án.</p>{data.error&&<p role="alert">{data.error}</p>}{data.loading&&!data.data&&<p>Đang tải…</p>}{data.data&&<p>{data.data.total} việc đang chờ · hiển thị tối đa 100 việc cũ nhất.</p>}{data.data?.items.map(item=><article key={item.id}><strong>{item.title}</strong><span>{item.author_name} · {item.group_name}{item.subject?` · ${item.subject}`:''} · {new Date(item.created_at).toLocaleString('vi-VN')}</span></article>)}{data.data&&!data.data.total&&<p>Không có giáo án cần bạn duyệt.</p>}</div>;
}
