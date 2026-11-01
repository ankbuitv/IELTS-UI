import { useNotificationFeed } from '../../components/NotificationBell';
import { Icon } from '../../components/Icon';
import { safeInternalPath } from './desktop-routing';
import { formatDateTime } from '../../lib/format';

export function DesktopNotifications({onOpen,feedState}:{onOpen:(path:string)=>void;feedState:ReturnType<typeof useNotificationFeed>}) {
  const {feed,error,loading,reload,markRead,markAll}=feedState;
  return <div className="sd-window__body"><div className="sd-appbar"><button onClick={()=>void reload()}><Icon name="rotate" size={15}/> Làm mới</button><button disabled={!feed?.unread} onClick={()=>void markAll()}><Icon name="check" size={15}/> Đánh dấu tất cả đã đọc</button></div><div className="sd-appheading"><div><b>Thông báo</b><small>Tin về lớp học, buổi học và tài khoản của bạn</small></div><span>{feed?.unread ?? 0} chưa đọc</span></div>{error && <p className="sd-message" role="alert">{error}</p>}{loading && !feed ? <p className="sd-message">Đang tải thông báo…</p> : <div className="sd-notifications">{feed?.items.map(item=><button className={`sd-notification${item.readAt?'':' is-unread'}`} key={item.id} onClick={()=>{void markRead(item);const path=safeInternalPath(item.href);if(path)onOpen(path);}}><span className="sd-notification__icon"><Icon name="bell" size={17}/></span><span><b>{item.title}</b>{item.body && <span>{item.body}</span>}<small>{formatDateTime(item.createdAt)}{item.readAt?'':' · Chưa đọc'}</small></span>{item.href && <Icon name="chevronRight" size={16}/>}</button>)}{!error&&!feed?.items.length&&<p className="sd-message">Bạn chưa có thông báo nào.</p>}</div>}<div className="sd-status">Thông báo được cập nhật định kỳ</div></div>;
}
