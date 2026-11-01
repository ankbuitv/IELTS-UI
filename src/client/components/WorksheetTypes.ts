export type Work={id:string;title:string;deadline_at:string|null;status:'ACTIVE'|'CLOSED';created_at:string;submitted?:number;version?:number|null;state?:string|null};
export type Question={id:string;position:number;skill:string;topic:string;question:string;reference_answer?:string};
export type Answer={questionId:string;answer:string};
export type Comment={questionId:string;start:number;end:number;text:string};
export type Version={id:string;version:number;state:'SUBMITTED'|'RETURNED';answers_json:string;feedback_json:string;created_at:string;reviewed_at:string|null};
export function parseArray<T>(json:string):T[]{try{const data:unknown=JSON.parse(json);return Array.isArray(data)?data as T[]:[];}catch{return[];}}
