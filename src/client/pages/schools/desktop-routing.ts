/** Staff use the desktop for authenticated application routes. */
export function isStaffDesktopPath(role:string,path:string):boolean {
  if(role==='STUDENT')return false;
  const pathname=path.split(/[?#]/,1)[0] ?? '';
  return !['/login','/register','/auth/magic','/reset-password','/school-desktop'].includes(pathname);
}
/** Never let notification hrefs or auth return targets leave this site. */
export function safeInternalPath(path:string|null|undefined):string|null {
  return path?.startsWith('/') && !path.startsWith('//') && ![...path].some(char=>char === '\\' || char.charCodeAt(0) < 32) ? path : null;
}
export function homeForRole(role:string):string { return role==='STUDENT' ? '/dashboard' : '/school-desktop'; }
