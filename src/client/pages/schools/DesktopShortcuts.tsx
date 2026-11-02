import {useEffect} from 'react';
export function DesktopShortcuts({onStart,onNotifications,onMinimize,onClose}:{onStart:()=>void;onNotifications:()=>void;onMinimize:()=>void;onClose:()=>void}){
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(!e.altKey||!e.shiftKey||e.ctrlKey||e.metaKey||e.repeat||document.querySelector('.sd-dialog-backdrop, [role="dialog"][aria-modal="true"]'))return;const target=e.target as HTMLElement|null;if(target?.closest('input,textarea,select,[contenteditable="true"]'))return;const actions:Record<string,()=>void>={s:onStart,n:onNotifications,m:onMinimize,w:onClose};const action=actions[e.key.toLowerCase()];if(action){e.preventDefault();action();}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[onStart,onNotifications,onMinimize,onClose]);
 return null;
}
export function ShortcutHelp(){return <details className="sd-shortcut-help"><summary>Phím tắt</summary><p>Alt + Shift + S: Start · N: thông báo · M: thu nhỏ cửa sổ trên cùng · W: đóng cửa sổ trên cùng.</p><small>Không áp dụng khi đang nhập hoặc mở hộp thoại; đóng bài/ cuộc gọi vẫn yêu cầu xác nhận.</small></details>;}
