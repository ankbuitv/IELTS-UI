import { describe, expect, it } from 'vitest';
import { resolveSchoolSelection } from '../../src/client/pages/schools/school-selection';

const active = (id: string) => ({id, status:'APPROVED', member_status:'ACTIVE'});
describe('desktop school selection', () => {
  it('asks for a school only when there are multiple active memberships and no valid choice', () => {
    expect(resolveSchoolSelection([], 'missing')).toMatchObject({approved:[], selected:undefined, needsChoice:false});
    expect(resolveSchoolSelection([active('a')], '')).toMatchObject({selected:{id:'a'}, needsChoice:false});
    expect(resolveSchoolSelection([active('a'),active('b')], '')).toMatchObject({selected:undefined, needsChoice:true});
    expect(resolveSchoolSelection([active('a'),active('b')], 'b')).toMatchObject({selected:{id:'b'}, needsChoice:false});
    expect(resolveSchoolSelection([active('a'),active('b')], 'removed')).toMatchObject({selected:undefined, needsChoice:true});
  });
  it('does not restore a pending school, invitation or removed membership', () => {
    const schools=[active('a'),active('b'),{id:'c',status:'PENDING',member_status:'ACTIVE'},{id:'d',status:'APPROVED',member_status:'INVITED'},{id:'e',status:'APPROVED',member_status:'REMOVED'}];
    for (const id of ['c','d','e']) expect(resolveSchoolSelection(schools,id)).toMatchObject({selected:undefined,needsChoice:true});
    expect(resolveSchoolSelection(schools,'a').approved.map(s=>s.id)).toEqual(['a','b']);
  });
});
