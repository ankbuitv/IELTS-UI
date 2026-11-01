import { useAsync } from '../hooks/useAsync';
import { api } from '../lib/api';

type Banner={school_id:string;school_name:string;title:string;message:string;theme:'blue'|'green'|'amber';image_mime:string|null;image_b64:string|null};
export function SchoolBanners() {
  const {data}=useAsync(()=>api.get<{banners:Banner[]}>('/api/schools/my-banners'),[]);
  if(!data?.banners.length)return null;
  return <section className="school-banners" aria-label="Thông báo từ trường">{data.banners.map(b=><article className={`school-banner school-banner--${b.theme}`} key={b.school_id}>{b.image_mime&&b.image_b64&&<img src={`data:${b.image_mime};base64,${b.image_b64}`} alt=""/>}<div><small>{b.school_name}</small><strong>{b.title}</strong><p>{b.message}</p></div></article>)}</section>;
}
