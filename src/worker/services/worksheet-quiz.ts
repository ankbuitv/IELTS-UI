import {parseJson} from '../lib/ids';
/** Deterministic per student and worksheet, so refresh/resubmission never changes their order. This is not a secrecy mechanism. */
function rank(s:string){let h=2166136261;for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),16777619);return h>>>0;}
function reorder<T>(values:T[],seed:string,key:(v:T)=>string){return values.slice().sort((a,b)=>rank(seed+key(a))-rank(seed+key(b))||key(a).localeCompare(key(b)));}
type Row={id:string;options_json:string|null;[key:string]:unknown};
export function studentQuizQuestions(rows:Row[],student:string,work:string,shuffleQuestions:boolean,shuffleOptions:boolean){let result=rows.map(row=>{const {options_json,...safe}=row;const options=options_json===null?null:parseJson<string[]>(options_json,[]).map((text,index)=>({id:`choice:${index}`,text}));return {...safe,options:options&&shuffleOptions?reorder(options,`${work}:${student}:${row.id}:`,o=>o.id):options};});if(shuffleQuestions)result=reorder(result,`${work}:${student}:questions:`,q=>q.id);return result;}
