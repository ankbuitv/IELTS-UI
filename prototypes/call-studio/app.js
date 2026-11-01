const icon = (name, size=17) => {
  const shapes = {
    mic:'<path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4M8 22h8"/>',
    video:'<rect x="3" y="5" width="13" height="14" rx="3"/><path d="m16 10 5-3v10l-5-3"/>',
    screen:'<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4M9 10l3-3 3 3M12 7v7"/>',
    chat:'<path d="M20 11a7 7 0 0 1-7 7H7l-4 3v-6a7 7 0 1 1 17-4Z"/>',
    people:'<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 5v1"/>',
    hand:'<path d="M8 12V4a2 2 0 0 1 4 0v5-6a2 2 0 0 1 4 0v6-4a2 2 0 0 1 4 0v9c0 4-3 7-7 7h-1c-3 0-5-1-7-4l-2-3a2 2 0 0 1 3-2l2 2Z"/>',
    more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    phone:'<path d="M4 15c4-4 12-4 16 0l-2 4-4-2v-2h-4v2l-4 2-2-4Z"/>',
    grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    arrow:'<path d="M7 17 17 7M8 7h9v9"/>',
    file:'<path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6"/>',
    sound:'<path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4"/>',
    chevron:'<path d="m9 18 6-6-6-6"/>',
    clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    edit:'<path d="m4 20 4-.8L19 8l-3-3L5 16zM14 7l3 3"/>',
    link:'<path d="m10 13 4-4M7 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M17 8l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"/>',
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes[name] || shapes.more}</svg>`;
};
const variants = [
  {name:'Focus',kind:'focus',layout:'focus',desc:'Người nói nổi bật, mọi điều khiển gọn gàng ở phía dưới.',meta:'Tập trung người nói',accent:'#cba6f7'},
  {name:'Classroom',kind:'lesson',layout:'classroom',desc:'Giáo viên là trọng tâm, học viên xếp thành dải bên phải.',meta:'Dải học viên bên phải',accent:'#cba6f7'},
  {name:'Gallery',kind:'grid',layout:'gallery',desc:'Mọi người có diện tích bằng nhau trong một bố cục cân bằng.',meta:'Lưới cân bằng',accent:'#b4befe'},
  {name:'Conversation',kind:'focus',layout:'conversation',desc:'Hai người lớn cạnh nhau, lý tưởng cho một buổi 1–1.',meta:'Gặp gỡ 1–1',accent:'#89b4fa'},
  {name:'Study room',kind:'lesson',layout:'study',desc:'Không gian học có hội thoại bên cạnh, không rời phòng call.',meta:'Call + chat',accent:'#cba6f7'},
  {name:'Presentation',kind:'lesson',layout:'presentation',desc:'Tài liệu lớn ở giữa, các gương mặt luôn hiện bên cạnh.',meta:'Ưu tiên trình chiếu',accent:'#89b4fa'},
  {name:'Theatre',kind:'focus',layout:'theatre',desc:'Người đang nói chiếm trọn sân khấu, dải video nằm ngang.',meta:'Sân khấu rộng',accent:'#f5c2e7'},
  {name:'Seminar',kind:'lesson',layout:'seminar',desc:'Khung giảng dạy sáng rõ cùng danh sách người tham gia.',meta:'Lớp thảo luận',accent:'#a6e3a1'},
  {name:'Compact',kind:'grid',layout:'compact',desc:'Mật độ vừa phải, các ô video lớn và thanh công cụ tiết kiệm chỗ.',meta:'Lưới gọn',accent:'#cba6f7'},
  {name:'Spotlight',kind:'focus',layout:'spotlight',desc:'Một khung chính lớn với video nhỏ nổi ở góc.',meta:'Khung chính + tự xem',accent:'#89dceb'},
  {name:'Notes',kind:'lesson',layout:'notes',desc:'Vừa trao đổi vừa theo dõi ghi chú ngay trong phòng.',meta:'Ghi chú bên cạnh',accent:'#f9e2af'},
  {name:'Orbit',kind:'grid',layout:'orbit',desc:'Bố cục đa người với đường viền nhấn người đang nói.',meta:'Lưới nhấn người nói',accent:'#a6e3a1'},
  {name:'Sidekick',kind:'focus',layout:'sidekick',desc:'Khung chính thoáng, công cụ được đặt dọc phía trái.',meta:'Thanh công cụ dọc',accent:'#b4befe'},
  {name:'Split screen',kind:'lesson',layout:'split',desc:'Tài liệu và giáo viên chia đôi không gian làm việc.',meta:'Chia đôi tài liệu',accent:'#89b4fa'},
  {name:'Workspace',kind:'lesson',layout:'workspace',desc:'Cảm giác lớp học có kênh, chat và nội dung trình bày.',meta:'Kênh lớp học',accent:'#cba6f7'},
  {name:'Roundtable',kind:'grid',layout:'roundtable',desc:'Một nhóm nhỏ với tất cả thành viên được đặt ngang hàng.',meta:'Thảo luận nhóm',accent:'#f2cdcd'},
  {name:'Filmstrip',kind:'focus',layout:'filmstrip',desc:'Video chính cùng dải thành viên nhỏ nằm phía trên.',meta:'Dải video phía trên',accent:'#89dceb'},
  {name:'Lesson board',kind:'lesson',layout:'board',desc:'Tập trung vào bảng và mục tiêu buổi học, video nằm dưới.',meta:'Bảng bài học',accent:'#a6e3a1'},
  {name:'Studio',kind:'focus',layout:'studio',desc:'Không gian tối giản, thanh điều khiển nằm ở cạnh màn hình.',meta:'Tối giản',accent:'#cba6f7'},
  {name:'All together',kind:'grid',layout:'together',desc:'Lưới nhóm lớn với phần thông tin lớp học rõ ràng.',meta:'Lớp đông người',accent:'#f5c2e7'},
];
const people = [
  {name:'Cô Linh',sub:'Giáo viên',image:'linh.jpg'},
  {name:'Minh Anh',sub:'Học viên',image:'anh.jpg'},
  {name:'Hoàng Minh',sub:'Học viên',image:'minh.jpg'},
  {name:'Bạn',sub:'Bạn',image:null},
];
const person = (p, cls='') => `<div class="person ${cls} ${p.image?'has-image':'avatar-person'}">${p.image?`<img src="assets/${p.image}" alt="">`:`<div class="avatar-letter">B</div>`}<div class="person-name"><span>${p.name}</span>${p.sub==='Giáo viên'?'<i>Chủ trì</i>':''}</div><span class="person-mic">${icon('mic',11)}</span></div>`;
const doc = () => `<div class="shared-doc"><div class="doc-top"><span>${icon('file',13)} TÀI LIỆU ĐANG CHIA SẺ</span><span>●</span></div><div class="doc-paper"><span class="doc-eyebrow">SPEAKING PRACTICE / PART 2</span><h3>Describe a place<br>you enjoy visiting.</h3><p>You should say:</p><ul><li>where the place is</li><li>when you usually go there</li><li>what you do there</li></ul><div class="doc-divider"></div><small>And explain why you enjoy spending time there.</small></div><div class="doc-bottom"><span>IELTS Speaking · Part 2</span><span>1 / 3</span></div></div>`;
const chat = (v) => `<aside class="room-panel"><div class="panel-head"><strong>${v.layout==='notes'?'Ghi chú buổi học':v.layout==='seminar'?'Thành viên':'Trò chuyện'}</strong><span>×</span></div><div class="panel-tabs"><span class="selected">${v.layout==='notes'?'Ghi chú':'Tin nhắn'}</span><span>${v.layout==='seminar'?'Vai trò':'Tệp'}</span></div><div class="panel-content">${v.layout==='notes'?'<div class="panel-note"><small>HÔM NAY</small><strong>Speaking · Part 2</strong><p>Chuẩn bị ý trong 1 phút. Chú ý phát triển lý do và ví dụ cụ thể.</p><span>✓ &nbsp; Bài tập về nhà: luyện cue card</span></div>':`<div class="chat-item"><b>CL</b><div><strong>Cô Linh <time>10:24</time></strong><p>Mọi người đã sẵn sàng chưa?</p></div></div><div class="chat-item"><b>MA</b><div><strong>Minh Anh <time>10:25</time></strong><p>Dạ rồi ạ! Mình bắt đầu nhé.</p></div></div><div class="chat-item self-chat"><b>HM</b><div><strong>Hoàng Minh <time>10:26</time></strong><p>Em đã xem tài liệu rồi ạ.</p></div></div>`}</div><div class="panel-compose">${v.layout==='notes'?'Thêm ghi chú…':'Viết tin nhắn…'} <span>➤</span></div></aside>`;
function room(v) {
  const isDoc = ['presentation','split','workspace','board'].includes(v.layout);
  const hasPanel = ['study','seminar','notes','workspace'].includes(v.layout);
  const primary = isDoc?doc():person(people[0],'primary-person');
  const peers = isDoc ? people.map((p,i)=>person(p,`p${i}`)).join('') : people.slice(1).map((p,i)=>person(p,`p${i+1}`)).join('');
  const buttons = [['mic','Mic'],['video','Camera'],['screen','Chia sẻ'],['chat','Chat'],['hand','Giơ tay'],['people','Mọi người'],['more','Thêm']];
  return `<div class="room room--${v.layout}" style="--accent:${v.accent}"><div class="room-top"><div class="room-brand"><img src="assets/logo.svg" alt=""><span class="room-live">LIVE</span></div><div class="room-title"><strong>IELTS Speaking · Part 2</strong><span>${icon('clock',11)} 24:18</span></div><div class="room-top-right"><span class="room-quality"><i></i> Ổn định</span><span class="room-count">${icon('people',14)} 4</span><span class="room-invite">+ Mời</span></div></div><div class="room-body"><div class="stage"><div class="stage-primary">${primary}</div><div class="stage-peers">${peers}</div><div class="stage-label"><span></span> ${isDoc?'Cô Linh đang trình chiếu':'Buổi học đang diễn ra'}</div></div>${hasPanel?chat(v):''}</div><div class="room-controls"><div class="room-context"><b>IELTS Speaking</b><small>4 người tham gia</small></div><div class="controls">${buttons.map(([id,label])=>`<div class="control ${id==='chat'&&hasPanel?'is-active':''}" title="${label}"><span>${icon(id,18)}</span><small>${label}</small></div>`).join('')}<div class="control hangup" title="Rời phòng"><span>${icon('phone',19)}</span><small>Rời phòng</small></div></div><div class="room-end">${icon('grid',16)} <span>Bố cục</span></div></div></div>`;
}
let current = 0, filter = 'all';
const gallery = document.getElementById('gallery');
function createGallery(){
  gallery.innerHTML = variants.map((v,i)=>`<button class="sample ${i===current?'is-selected':''}" data-index="${i}" aria-label="Xem mẫu ${String(i+1).padStart(2,'0')}: ${v.name}" aria-pressed="${i===current}"><div class="thumb"><div class="thumb-inner">${room(v)}</div></div><div class="sample-info"><span><b>${String(i+1).padStart(2,'0')}</b><strong>${v.name}</strong></span><span class="sample-arrow">${icon('arrow',15)}</span></div><p>${v.meta}</p></button>`).join('');
  gallery.querySelectorAll('.sample').forEach(button=>button.addEventListener('click',()=>{select(Number(button.dataset.index));if(window.matchMedia('(max-width: 760px)').matches) document.querySelector('.preview-area').scrollIntoView({behavior:'smooth',block:'start'});}));
  applyFilter(); scaleThumbs();
}
function scaleThumbs(){document.querySelectorAll('.thumb').forEach(el=>{const inner=el.querySelector('.thumb-inner'); inner.style.transform=`scale(${el.clientWidth/960})`;});}
function select(i){current=(i+variants.length)%variants.length;const v=variants[current]; document.getElementById('current-index').textContent=String(current+1).padStart(2,'0');document.getElementById('current-name').textContent=v.name;document.getElementById('current-desc').textContent=v.desc;document.getElementById('counter').textContent=`${current+1} / ${variants.length}`;document.getElementById('active-room').innerHTML=room(v);document.getElementById('selected-message').textContent='';document.querySelectorAll('.sample').forEach(el=>{const active=Number(el.dataset.index)===current;el.classList.toggle('is-selected',active);el.setAttribute('aria-pressed',String(active));});scalePreview();}
function scalePreview(){const el=document.getElementById('preview-scale');const w=el.clientWidth;const frame=document.getElementById('active-room');frame.style.transform=`scale(${w/960})`;el.style.height=`${w*540/960}px`;}
function applyFilter(){document.querySelectorAll('.sample').forEach(el=>el.hidden=filter!=='all'&&variants[Number(el.dataset.index)].kind!==filter);}
document.getElementById('filters').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;filter=b.dataset.filter;document.querySelectorAll('#filters button').forEach(el=>{const on=el===b;el.classList.toggle('active',on);el.setAttribute('aria-pressed',String(on));});applyFilter();scaleThumbs();});
document.getElementById('previous').addEventListener('click',()=>select(current-1));
document.getElementById('next').addEventListener('click',()=>select(current+1));
document.getElementById('choose').addEventListener('click',()=>{const message=`Mình chọn mẫu ${String(current+1).padStart(2,'0')} – ${variants[current].name}`;const output=document.getElementById('selected-message');output.textContent=`Bạn chọn mẫu ${String(current+1).padStart(2,'0')} – ${variants[current].name}. Nhắn số mẫu này cho mình nhé!`;if(navigator.clipboard?.writeText) navigator.clipboard.writeText(message).then(()=>{if(output.textContent.includes(variants[current].name)) output.textContent=`Đã sao chép: “${message}”. Gửi câu này cho mình nhé!`;}).catch(()=>{});});
window.addEventListener('resize',()=>{scalePreview();scaleThumbs();});
createGallery();select(0);
