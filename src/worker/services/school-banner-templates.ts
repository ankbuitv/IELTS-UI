import {recordAudit} from '../lib/audit';
import type {Env} from '../env';
import type {AuthUser} from '../lib/auth-types';
import {ApiError} from '../lib/errors';
import {newId,nowIso} from '../lib/ids';
import {requireSchoolOwner} from './school-service';

type TemplateInput = {name:string; title:string; message:string; theme:'blue'|'green'|'amber'};
export async function listBannerTemplates(env:Env,user:AuthUser,schoolId:string) {
  await requireSchoolOwner(env,user,schoolId);
  return (await env.DB.prepare('SELECT id,name,title,message,theme,updated_at FROM school_banner_templates WHERE school_id=? ORDER BY updated_at DESC,id DESC LIMIT 50').bind(schoolId).all()).results;
}
export async function saveBannerTemplate(env:Env,user:AuthUser,schoolId:string,id:string|null,input:TemplateInput) {
  await requireSchoolOwner(env,user,schoolId);
  const name=input.name.trim(),title=input.title.trim(),message=input.message.trim();
  if(!name||name.length>100||!title||title.length>120||message.length>500||!['blue','green','amber'].includes(input.theme))throw ApiError.validation('Tên, tiêu đề hoặc nội dung mẫu không hợp lệ.');
  const now=nowIso(), templateId=id??newId('sbt');
  const guard=`EXISTS (SELECT 1 FROM schools WHERE id=? AND owner_user_id=? AND status='APPROVED')`;
  const result=id
    ? await env.DB.prepare(`UPDATE school_banner_templates SET name=?,title=?,message=?,theme=?,updated_at=? WHERE id=? AND school_id=? AND ${guard}`).bind(name,title,message,input.theme,now,id,schoolId,schoolId,user.id).run()
    : await env.DB.prepare(`INSERT INTO school_banner_templates(id,school_id,name,title,message,theme,created_by,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,? WHERE ${guard} AND (SELECT COUNT(*) FROM school_banner_templates WHERE school_id=?)<50`).bind(templateId,schoolId,name,title,message,input.theme,user.id,now,now,schoolId,user.id,schoolId).run();
  if(!result.meta.changes) { if(id)throw ApiError.notFound('Không tìm thấy mẫu hoặc quyền truy cập đã thay đổi.'); throw ApiError.conflict('Tối đa 50 mẫu hoặc quyền truy cập đã thay đổi.'); }
  await recordAudit(env,{actorUserId:user.id,action:id?'SCHOOL_TEMPLATE_UPDATE':'SCHOOL_TEMPLATE_CREATE',entityType:'school',entityId:schoolId,metadata:{templateId}});
  return {id:templateId};
}
export async function deleteBannerTemplate(env:Env,user:AuthUser,schoolId:string,id:string) {
  await requireSchoolOwner(env,user,schoolId);
  const result=await env.DB.prepare(`DELETE FROM school_banner_templates WHERE id=? AND school_id=? AND EXISTS (SELECT 1 FROM schools WHERE id=? AND owner_user_id=? AND status='APPROVED')`).bind(id,schoolId,schoolId,user.id).run();
  if(!result.meta.changes)throw ApiError.notFound('Không tìm thấy mẫu hoặc quyền truy cập đã thay đổi.');
  await recordAudit(env,{actorUserId:user.id,action:'SCHOOL_TEMPLATE_DELETE',entityType:'school',entityId:schoolId,metadata:{templateId:id}});
}
