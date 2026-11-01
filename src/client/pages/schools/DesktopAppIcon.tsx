import type { ReactNode } from 'react';
import { Icon, type IconName } from '../../components/Icon';

// Purpose-drawn app symbols, rather than text badges on repeated glyphs.
const symbols: Record<string, ReactNode> = {
  'school-overview': <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c4 4 4 14 0 18M12 3c-4 4-4 14 0 18M5 7h14M5 17h14"/></>,
  'school-banner': <><rect x="3" y="4" width="18" height="14" rx="2"/><circle cx="8" cy="9" r="1.5"/><path d="m5 16 4-4 3 3 3-4 4 5M8 21h8"/></>,
  'teacher-progress': <><path d="M4 20V4M4 20h17M7 15l4-4 3 2 5-7M16 6h3v3"/></>,
  'lesson-reviews': <><path d="M5 3h10l4 4v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM15 3v5h4M7 14l2 2 5-5"/></>,
  'school-permissions': <><path d="m12 2 8 3v6c0 5-3 8-8 11-5-3-8-6-8-11V5z"/><rect x="9" y="10" width="6" height="5" rx="1"/><path d="M10 10V8a2 2 0 0 1 4 0v2"/></>,
  'subject-groups': <><path d="m12 3 9 4-9 4-9-4 9-4ZM3 12l9 4 9-4M3 17l9 4 9-4"/><circle cx="12" cy="7" r="1"/></>,
  notifications: <><path d="M5 17h14l-2-3V9a5 5 0 0 0-10 0v5zM10 20a2 2 0 0 0 4 0"/><path d="M18 4l2-2M4 4 2 2"/></>,
  profile: <><circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-4 3-6 7-6s7 2 7 6"/><circle cx="12" cy="12" r="10"/></>,
  'school-app-reviews': <><path d="M5 21V3M5 4h12l-2 3 2 3H5M9 16l2 2 5-5"/></>,
  'school-calendar': <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18M8 14h3M8 17h3M15 14v3M13.5 15.5h3"/></>,
  'lesson-plans': <><path d="M5 3h11l3 3v15H5zM16 3v4h3M8 11h8M8 14h8M8 17h5"/></>,
  classes: <><path d="M3 4h18v11H3zM8 19h8M12 15v4"/><circle cx="8" cy="9" r="1"/><circle cx="12" cy="9" r="1"/><circle cx="16" cy="9" r="1"/></>,
  schools: <><path d="M3 21h18M5 21V9l7-5 7 5v12M9 21v-5h6v5M9 10h.01M15 10h.01M12 10h.01"/></>,
  members: <><circle cx="9" cy="8" r="3"/><path d="M3 19c0-3 2-5 6-5s6 2 6 5M16 5a3 3 0 0 1 0 6M17 14c2 .5 4 2 4 5"/></>,
  assignments: <><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2M8 9l1 1 2-2M13 9h3M8 15l1 1 2-2M13 15h3"/></>,
  messages: <><path d="M3 4h15a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-4 4v-4H3zM7 8h9M7 12h6"/></>,
  files: <><path d="M3 6h7l2 2h9v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 10h18"/></>,
  marking: <><path d="M4 20h4L20 8a2.8 2.8 0 0 0-4-4L4 16zM14 6l4 4M4 20h16"/></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18M7 14h2M11 14h2M15 14h2M7 17h2M11 17h2"/></>,
  wallpaper: <><rect x="3" y="4" width="18" height="14" rx="2"/><path d="m4 16 5-5 3 3 3-3 5 5M8 21h8"/><circle cx="16" cy="8" r="1.5"/></>,
  sessions: <><rect x="3" y="5" width="13" height="14" rx="2"/><path d="m16 10 5-3v10l-5-3zM8 9v6l4-3z"/></>,
  learn: <><path d="M3 5c4-2 7-1 9 1 2-2 5-3 9-1v13c-4-2-7-1-9 1-2-2-5-3-9-1zM12 6v13"/><path d="M6 9h3M15 9h3"/></>,
  'mentor-console': <><path d="M3 5h18v12H3zM12 17v4M8 21h8M8 13l3-3 2 2 3-4"/></>,
  'mentor-earnings': <><circle cx="12" cy="12" r="9"/><path d="M15 8c-1-2-6-2-6 1 0 3 6 1 6 4s-5 3-6 1M12 5v13"/></>,
  practice: <><path d="M5 3h14v18H5zM8 7h8M8 11h8M8 15h4"/><path d="m15 17 2 2 4-5"/></>,
  history: <><path d="M4 8a9 9 0 1 1-1 4M3 3v5h5M12 7v5l4 2"/></>,
  vocabulary: <><path d="M4 4h14v16H4zM7 7h8M7 11h8M7 15h5M20 6v14M18 20h2"/></>,
  dictionary: <><path d="M4 3h13v18H4zM7 7h7M7 11h5M7 15h4"/><circle cx="17" cy="15" r="3"/><path d="m19 17 3 3"/></>,
  speaking: <><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6M3 9c-1 2-1 4 0 6M21 9c1 2 1 4 0 6"/></>,
  drills: <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/><path d="m16 8 5-5M18 3h3v3"/></>,
  mentors: <><path d="m2 8 10-5 10 5-10 5zM6 10v5c4 3 8 3 12 0v-5M21 9v6"/><circle cx="12" cy="19" r="2"/></>,
  'study-room': <><path d="M5 21V4h11v17M3 21h18M16 8h3v13M12 12h.01M8 7h4M8 10h2"/></>,
  admin: <><path d="m12 2 8 3v6c0 5-3 8-8 11-5-3-8-6-8-11V5zM8 12h8M12 8v8"/></>,
  'admin-tests': <><path d="M5 3h14v18H5zM8 7h8M8 11h8M8 15h3"/><circle cx="16" cy="16" r="2"/></>,
  'admin-imports': <><path d="M4 14v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5M12 16V3M8 7l4-4 4 4"/></>,
  'admin-users': <><circle cx="8" cy="8" r="3"/><path d="M3 19c0-3 2-5 5-5s5 2 5 5M17 7v6M14 10h6M15 19h6"/></>,
  'admin-schools': <><path d="M3 21h18M5 21V9l7-5 7 5v12M8 15h3M8 18h3M14 15l2 2 4-4"/></>,
  'admin-settings': <><circle cx="12" cy="12" r="3"/><path d="m10 2-1 3-3 1-2-1-2 4 2 2v3l-2 2 2 4 3-1 2 1 1 2h4l1-2 3-1 2 1 2-4-2-2v-3l2-2-2-4-3 1-2-1-1-3z"/></>,
  'admin-attempts': <><path d="M4 5h16M4 10h16M4 15h9M4 20h7"/><circle cx="17" cy="17" r="3"/><path d="M17 15v2l1 1"/></>,
  'admin-learn': <><path d="M3 5c4-2 7-1 9 1 2-2 5-3 9-1v13c-4-2-7-1-9 1-2-2-5-3-9-1zM12 6v13"/><path d="M6 9h3M6 12h3M15 9h3M15 12h3"/></>,
  'admin-scoring': <><path d="M5 3h14v18H5zM8 7h8M8 11h3M8 15h3M14 14l2 2 3-4"/></>,
};
export function DesktopAppIcon({id, fallback, size=24}:{id:string;fallback:IconName;size?:number}) {
 const symbol=symbols[id];
 if(!symbol)return <Icon name={fallback} size={size}/>;
 return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{symbol}</svg>;
}
