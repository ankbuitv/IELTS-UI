import { useEffect, useState } from 'react';
import { api, describeError } from '../lib/api';
import { prepareLogo } from '../lib/prepare-logo';
import { Button } from './ui';

type Logo = {mime:string;data_b64:string};
export function ClassLogo({type,id,editable=false,name}:{type:'teacher'|'mentor';id:string;editable?:boolean;name:string}) {
  const [logo,setLogo]=useState<Logo|null>(null); const [error,setError]=useState(''); const [busy,setBusy]=useState(false);
  const path=`/api/class-logos/${type}/${encodeURIComponent(id)}`;
  useEffect(()=>{let active=true;void api.get<{logo:Logo|null}>(path).then(data=>{if(active)setLogo(data.logo);}).catch(()=>{if(active)setLogo(null);});return()=>{active=false;};},[path]);
  return <div className="class-logo">{logo?<img src={`data:${logo.mime};base64,${logo.data_b64}`} alt={`Logo lớp ${name}`}/>:<span className="class-logo__fallback" aria-label={`Lớp ${name}`}>{name.trim().slice(0,1).toLocaleUpperCase()}</span>}{editable?<div className="class-logo__controls"><label className="class-logo__upload">{busy?'Đang tải…':'Đổi logo lớp'}<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={e=>{const file=e.currentTarget.files?.[0];e.currentTarget.value='';if(!file)return;setBusy(true);setError('');void prepareLogo(file).then(async image=>{await api.post(path,image);setLogo({mime:image.mime,data_b64:image.base64});}).catch(e=>setError(describeError(e))).finally(()=>setBusy(false));}} /></label>{logo?<Button size="sm" disabled={busy} onClick={()=>{setBusy(true);void api.delete(path).then(()=>setLogo(null)).catch(e=>setError(describeError(e))).finally(()=>setBusy(false));}}>Xóa logo</Button>:null}{error?<span role="alert">{error}</span>:null}</div>:null}</div>;
}
