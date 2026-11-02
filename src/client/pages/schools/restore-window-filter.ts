export const safeIds=new Set(['today','resource-library','question-bank','teacher-progress','notifications','profile','calendar','school-overview','school-banner','school-permissions','subject-groups','school-calendar','lesson-plans','classes','schools','members','marking','admin-tests','admin-imports','admin-users','admin-schools','admin-settings','admin-attempts','admin-learn','admin-scoring']);
export function filterRestorable(data:unknown,permitted:string[]):string[]{
 if(!Array.isArray(data))return [];
 return [...new Set(data.filter((id):id is string=>typeof id==='string'&&safeIds.has(id)&&permitted.includes(id)))].slice(0,30);
}
