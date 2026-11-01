import {describe,expect,it} from 'vitest';
import {homeForRole,isFullScreenPath,isStaffDesktopPath,safeInternalPath} from '../../src/client/pages/schools/desktop-routing';
describe('staff desktop navigation',()=>{
  it('keeps students in the existing site and directs staff to their desktop',()=>{
    expect(homeForRole('STUDENT')).toBe('/dashboard');
    for(const role of ['TEACHER','MENTOR','ADMIN']) {
      expect(homeForRole(role)).toBe('/school-desktop');
      for(const path of ['/','/dashboard','/teacher','/admin/users','/classes/a','/notifications','/join?token=a'])expect(isStaffDesktopPath(role,path)).toBe(true);
    }
    expect(isStaffDesktopPath('STUDENT','/teacher')).toBe(false);
  });
  it('leaves authentication, calls and full-screen learning flows outside the desktop',()=>{
    for(const path of ['/login','/register','/auth/magic','/reset-password','/school-desktop','/sessions/abc/room?room=one','/exam/abc/review','/learn/lesson/one','/learn/review'])expect(isStaffDesktopPath('TEACHER',path)).toBe(false);
    expect(isFullScreenPath('/learn/review?x=1')).toBe(true);
    expect(isFullScreenPath('/learn/reviewed')).toBe(false);
  });
  it('only accepts internal navigation targets, retaining query and hash',()=>{
    expect(safeInternalPath('/teacher/classrooms/a?tab=files#top')).toBe('/teacher/classrooms/a?tab=files#top');
    for(const input of ['//attacker.example','https://attacker.example','/\\attacker.example','/admin\n'])expect(safeInternalPath(input)).toBeNull();
  });
});
