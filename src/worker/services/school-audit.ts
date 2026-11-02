import type {Env} from '../env';
import type {AuthUser} from '../lib/auth-types';
import {requireSchoolOwner} from './school-service';
/** Deliberately limited to school-level operations; no learner work or private notes. */
const allowed=['SCHOOL_REGISTER','SCHOOL_APPROVED','SCHOOL_REJECTED','SCHOOL_TEACHER_INVITE','SCHOOL_TEACHER_CREATE','SCHOOL_INVITE_ACCEPT','SCHOOL_INVITE_DECLINE','SCHOOL_MEMBER_REMOVE','SCHOOL_LOGO_UPDATE','SCHOOL_CLASS_LINK','SCHOOL_CLASS_UNLINK','SCHOOL_CLASS_TRANSFER','SCHOOL_BANNER_SAVE','SCHOOL_BANNER_DELETE','SCHOOL_PERMISSIONS_SET','SCHOOL_TEMP_GRANT','SCHOOL_TEMP_REVOKE','SCHOOL_GROUP_CREATE','SCHOOL_GROUP_UPDATE','SCHOOL_GROUP_DELETE','SCHOOL_EVENT_CREATE','SCHOOL_EVENT_UPDATE','SCHOOL_EVENT_DELETE','SCHOOL_TEMPLATE_CREATE','SCHOOL_TEMPLATE_UPDATE','SCHOOL_TEMPLATE_DELETE'] as const;
export async function listSchoolAudit(env:Env,user:AuthUser,schoolId:string){
 await requireSchoolOwner(env,user,schoolId);
 const rows=await env.DB.prepare(`SELECT a.id,a.created_at,a.action,a.actor_user_id,a.metadata_json,u.email AS actor_email FROM admin_audit_logs a LEFT JOIN users u ON u.id=a.actor_user_id WHERE a.entity_type='school' AND a.entity_id=? AND a.action IN (${allowed.map(()=>'?').join(',')}) ORDER BY a.created_at DESC,a.id DESC LIMIT 100`).bind(schoolId,...allowed).all<{id:string;created_at:string;action:string;actor_user_id:string|null;actor_email:string|null;metadata_json:string}>();
 return rows.results.map(({metadata_json,...row})=>{let meta:Record<string,unknown>={};try{const parsed:unknown=JSON.parse(metadata_json);if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))meta=parsed as Record<string,unknown>;}catch{/* Old malformed rows have no target. */}const pairs=[['userId','Nhân sự'],['classroomId','Lớp'],['groupId','Tổ'],['eventId','Sự kiện'],['templateId','Mẫu']] as const;const target=pairs.find(([key])=>typeof meta[key]==='string');return {...row,targetType:target?.[1]??null,targetId:target?meta[target[0]]:null};});
}
