import { describe, expect, it } from 'vitest';
import { selectCallFocus } from '../../src/client/lib/call-layout';

const base = {
  layout: 'auto' as const, isClass: true, selfId: 'student', hostId: 'teacher', selfScreenOn: false,
  peers: [{ userId: 'teacher' }, { userId: 'student2' }],
  participants: [{ userId: 'teacher', screenOn: false }, { userId: 'student2', screenOn: false }],
};
describe('class call focus', () => {
  it('features the host when there is no presentation', () => {
    expect(selectCallFocus(base)).toEqual({ featuredId: 'teacher', selfPresenting: false, selfFocus: false });
  });
  it('features a presentation instead of the host', () => {
    expect(selectCallFocus({ ...base, participants: [{ userId: 'student2', screenOn: true }] }).featuredId).toBe('student2');
  });
  it('features the local presentation and otherwise the local host', () => {
    const teacher = { ...base, selfId: 'teacher', peers: [{ userId: 'student' }] };
    expect(selectCallFocus({ ...teacher, selfScreenOn: true }).selfPresenting).toBe(true);
    expect(selectCallFocus(teacher).selfFocus).toBe(true);
  });
  it('does not focus a missing host or disconnected presenter', () => {
    expect(selectCallFocus({ ...base, peers: [], participants: [{ userId: 'teacher', screenOn: true }] }).featuredId).toBeUndefined();
  });
  it('honours grid and leaves non-class rooms unpinned', () => {
    expect(selectCallFocus({ ...base, layout: 'grid', selfScreenOn: true })).toEqual({ selfPresenting: false, selfFocus: false });
    expect(selectCallFocus({ ...base, isClass: false }).featuredId).toBeUndefined();
  });
});
