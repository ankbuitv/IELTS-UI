import {listCallSummaries,saveCallSummary,deleteCallSummary} from '@worker/services/call-summaries';
import { describe, expect, it } from 'vitest';
import schemaSql from '@worker/lib/runtime-schema.sql';
import { joinRoom, leaveRoom, postSignal, roomState, setHandRaised, setScreenShare, setMentorClassBrand } from '@worker/services/mentor-service';
import {createPoll,answerPoll,closePoll,listPolls,getWhiteboard,saveWhiteboard,createBreakouts,listBreakouts,closeBreakouts,broadcastBreakouts,liveQuestions,askLiveQuestion,changeLiveQuestion} from '@worker/services/live-class-service';
import type { Env } from '@worker/env';
import type { AuthUser } from '@worker/lib/auth-types';

interface Statement { get(...params: unknown[]): unknown; all(...params: unknown[]): unknown[]; run(...params: unknown[]): unknown }
interface SqliteDb { exec(sql: string): void; prepare(sql: string): Statement; close(): void }
function adapter(db: SqliteDb) {
  return { prepare(sql: string) { const statement = db.prepare(sql); let params: unknown[] = [];
    const bound = { bind(...values: unknown[]) { params = values; return bound; },
      async first<T>() { return (statement.get(...params) as T | undefined) ?? null; },
      async all<T>() { return { results: statement.all(...params) as T[] }; },
      async run() { const result = statement.run(...params) as { changes: number }; return { meta: { changes: Number(result.changes) } }; } }; return bound;
  }, async batch(statements: Array<{run:()=>Promise<unknown>}>) { const results=[]; for (const statement of statements) results.push(await statement.run()); return results; } };
}
function user(id: string, role: AuthUser['role']): AuthUser {
  return { id, role, email: `${id}@example.test`, username: null, status: 'ACTIVE', displayName: id, avatarUrl: null, createdAt: '', lastLoginAt: null };
}

describe('call signalling and presence', () => {
  it('orders random IDs by sequence, filters targets and never rejoins on poll', async () => {
    const specifier = 'node:sqlite';
    const sqlite = await import(/* @vite-ignore */ specifier).catch(() => null) as { DatabaseSync: new (path: string) => SqliteDb } | null;
    if (!sqlite) return;
    const db = new sqlite.DatabaseSync(':memory:');
    try {
      db.exec(schemaSql); db.exec('PRAGMA foreign_keys = OFF');
      db.exec(`INSERT INTO users (id,email,role,status,created_at,updated_at) VALUES
        ('teacher','t@test','TEACHER','ACTIVE','now','now'),('student','s@test','STUDENT','ACTIVE','now','now'),('other','o@test','STUDENT','ACTIVE','now','now'),('school','school@test','TEACHER','ACTIVE','now','now'),('admin','admin@test','ADMIN','ACTIVE','now','now');
        INSERT INTO user_profiles (user_id,display_name,created_at,updated_at) VALUES ('student','Nguyễn Học Viên','now','now');
        INSERT INTO classrooms (id,name,teacher_id,join_code,status,created_at,updated_at) VALUES ('class','Class','teacher','1234','ACTIVE','now','now');
        INSERT INTO classroom_members (id,classroom_id,user_id,role,status,joined_at,updated_at) VALUES
          ('m1','class','student','STUDENT','ACTIVE','now','now'),('m2','class','other','STUDENT','ACTIVE','now','now');
        INSERT INTO mentor_sessions (id,mentor_id,student_id,kind,status,topic,starts_at,ends_at,created_at,updated_at) VALUES ('room','teacher','teacher','CLASS','ACTIVE','Class','now','later','now','now');
        INSERT INTO classroom_call_rooms (classroom_id,session_id,created_at) VALUES ('class','room','now');
        INSERT INTO schools(id,name,address,contact_email,owner_user_id,status,created_at,updated_at) VALUES('school','School','Address','s@test','school','APPROVED','now','now');
        INSERT INTO school_members(id,school_id,user_id,role,status,created_at,updated_at) VALUES('sm','school','teacher','TEACHER','ACTIVE','now','now');
        INSERT INTO school_call_brand(session_id,school_id,selected_by,updated_at) VALUES('room','school','teacher','now');`);
      const env = { DB: adapter(db) } as unknown as Env;
      const schoolOwner = user('school','TEACHER'); const admin = user('admin', 'ADMIN'); const host = user('teacher', 'TEACHER'); const student = user('student', 'STUDENT'); const other = user('other', 'STUDENT');
      expect((await roomState(env, student, 'room', null)).participants).toHaveLength(0);
      const joining = await joinRoom(env, student, 'room');
      await joinRoom(env, host, 'room'); await joinRoom(env, other, 'room'); await joinRoom(env,admin,'room'); await joinRoom(env,schoolOwner,'room');
      const draft=await saveCallSummary(env,host,'room',null,'Buổi một','Private notes',false);expect(await listCallSummaries(env,student,'room')).toEqual([]);await expect(saveCallSummary(env,student,'room',draft,'X','no',true)).rejects.toMatchObject({status:403});await saveCallSummary(env,host,'room',draft,'Buổi một','Shared summary',true);expect(await listCallSummaries(env,student,'room')).toMatchObject([{title:'Buổi một',body:'Shared summary'}]);await saveCallSummary(env,host,'room',draft,'Buổi một','Private again',false);expect(await listCallSummaries(env,student,'room')).toEqual([]);await deleteCallSummary(env,host,'room',draft);expect(await listCallSummaries(env,host,'room')).toEqual([]);
      await askLiveQuestion(env,student,'room','main','Câu hỏi trong buổi học');const questions=await liveQuestions(env,host,'room','main') as Array<{id:string;status:string;body:string}>;expect(questions).toMatchObject([{body:'Câu hỏi trong buổi học',status:'OPEN'}]);const q=questions[0]!;await expect(changeLiveQuestion(env,student,'room','main',q.id,'ANSWERED')).rejects.toMatchObject({status:403});await expect(changeLiveQuestion(env,other,'room','main',q.id,'DELETE')).rejects.toMatchObject({status:404});await changeLiveQuestion(env,host,'room','main',q.id,'ANSWERED');expect(await liveQuestions(env,student,'room','main')).toMatchObject([{status:'ANSWERED'}]);await changeLiveQuestion(env,student,'room','main',q.id,'DELETE');expect(await liveQuestions(env,host,'room','main')).toEqual([]);await leaveRoom(env,other,'room');await expect(liveQuestions(env,other,'room','main')).rejects.toMatchObject({status:403});await joinRoom(env,other,'room');
      await expect(setScreenShare(env,student,'room','main',true)).rejects.toMatchObject({status:403});
      await setScreenShare(env,host,'room','main',true);
      await expect(setScreenShare(env,admin,'room','main',true)).rejects.toMatchObject({status:409});
      expect((await roomState(env,host,'room',null,'main',{cam:true,mic:true,screen:true})).screenShare?.userId).toBe('teacher');
      db.exec("UPDATE call_screen_shares SET updated_at='2000-01-01T00:00:00.000Z'");
      await setScreenShare(env,admin,'room','main',true);
      expect((await roomState(env,student,'room',null)).participants.find(p=>p.userId==='teacher')?.screenOn).toBe(false);
      await setScreenShare(env,host,'room','main',false); // a former presenter cannot release someone else's lease
      expect((await roomState(env,student,'room',null)).screenShare?.userId).toBe('admin');
      await setScreenShare(env,admin,'room','main',false);
      await setScreenShare(env,schoolOwner,'room','main',true); await setScreenShare(env,schoolOwner,'room','main',false);
      const claims = await Promise.allSettled([setScreenShare(env,host,'room','main',true),setScreenShare(env,admin,'room','main',true)]);
      expect(claims.filter(x=>x.status==='fulfilled')).toHaveLength(1);
      expect(claims.filter(x=>x.status==='rejected')).toHaveLength(1);
      await setScreenShare(env,host,'room','main',false); await setScreenShare(env,admin,'room','main',false);
      // Deliberately reverse lexical ID order: a random ID must never be used as a cursor.
      db.exec(`INSERT INTO mentor_signals(id,session_id,sender_id,target_id,room_key,kind,payload,created_at) VALUES
        ('sig_z','room','teacher','student','main','OFFER','one','now'),
        ('sig_a','room','teacher','other','main','OFFER','private','now'),
        ('sig_b','room','teacher','student','main','CANDIDATE','two','now'),
        ('sig_c','room','teacher',NULL,'main','REACTION','wave','now');`);
      const received = await roomState(env, student, 'room', joining.signalCursor, 'main', { cam: false, mic: true, screen: true });
      expect(received.signals.map((s) => s.id)).toEqual(['sig_z', 'sig_b', 'sig_c']);
      expect(received.participants.find((p) => p.userId === 'student')).toMatchObject({ displayName: 'Nguyễn Học Viên', camOn: false, screenOn: false });
      expect((await roomState(env, student, 'room', received.signalCursor)).signals).toHaveLength(0);
      await expect(createBreakouts(env,student,'room',{count:2,minutes:5})).rejects.toMatchObject({status:403});
      const breakout = await createBreakouts(env,host,'room',{count:2,minutes:5});
      expect(breakout.rooms).toHaveLength(2);
      expect(breakout.rooms.flatMap(r=>r.members).map(m=>m.userId)).toEqual(expect.arrayContaining(['student','other']));
      await expect(createBreakouts(env,host,'room',{count:2,minutes:5})).rejects.toMatchObject({status:409});
      const studentRoom=(await listBreakouts(env,student,'room')).myRoom!;
      const anotherRoom=breakout.rooms.find(r=>r.id!==studentRoom.id)!;
      await expect(roomState(env,student,'room',null,anotherRoom.roomKey)).rejects.toMatchObject({status:403});
      await expect(roomState(env,host,'room',null,anotherRoom.roomKey)).resolves.toMatchObject({roomKey:anotherRoom.roomKey});
      await expect(broadcastBreakouts(env,student,'room','main','Hello')).rejects.toMatchObject({status:403});
      await joinRoom(env,student,'room',studentRoom.roomKey);
      expect(await broadcastBreakouts(env,host,'room','main','Please return')).toEqual({sent:3});
      expect((await roomState(env,student,'room',null,studentRoom.roomKey)).messages.some(m=>m.body==='Thông báo tới các nhóm: Please return')).toBe(true);
      await joinRoom(env,student,'room','main');
      db.exec("UPDATE class_breakouts SET ends_at='2000-01-01T00:00:00.000Z'");
      expect((await listBreakouts(env,student,'room')).open).toBe(false);
      await expect(roomState(env,student,'room',null,studentRoom.roomKey)).rejects.toMatchObject({status:400});
      const replacement=await createBreakouts(env,host,'room',{count:2,minutes:5});
      expect(replacement.rooms.some(r=>breakout.rooms.some(old=>old.roomKey===r.roomKey))).toBe(false);
      await closeBreakouts(env,host,'room');
      const stroke={color:'#ffffff',width:4,points:[[0,0],[0.5,0.5]]};
      expect((await getWhiteboard(env,student,'room')).revision).toBe(0);
      expect(await saveWhiteboard(env,student,'room','main',0,[stroke])).toMatchObject({saved:true,revision:1});
      expect(await saveWhiteboard(env,host,'room','main',0,[])).toMatchObject({saved:false,revision:1});
      await expect(saveWhiteboard(env,student,'room','main',1,[])).rejects.toMatchObject({status:403});
      const stroke2={color:'#ff0000',width:4,points:[[0,1],[0.5,0.7]]};
      expect(await saveWhiteboard(env,other,'room','main',1,[stroke,stroke2])).toMatchObject({saved:true,revision:2});
      await expect(saveWhiteboard(env,student,'room','main',2,[stroke2,stroke])).rejects.toMatchObject({status:403});
      expect(await saveWhiteboard(env,host,'room','main',2,[])).toMatchObject({saved:true,revision:3});
      await expect(createPoll(env,student,'room','main',{kind:'POLL',question:'Question?',options:['One','Two']})).rejects.toMatchObject({status:403});
      await expect(createPoll(env,host,'room','main',{kind:'QUIZ',question:'Question?',options:['One',''],correctIndex:0})).rejects.toMatchObject({status:400});
      const poll=await createPoll(env,host,'room','main',{kind:'QUIZ',question:'Question?',options:['One','Two'],correctIndex:1});
      await expect(createPoll(env,host,'room','main',{kind:'POLL',question:'Another?',options:['One','Two']})).rejects.toMatchObject({status:409});
      expect((await listPolls(env,student,'room'))[0]?.correctIndex).toBeNull();
      await expect(answerPoll(env,host,'room',poll.id,0)).rejects.toMatchObject({status:403});
      const vote=await answerPoll(env,student,'room',poll.id,0); expect(vote).toMatchObject({myChoice:0,totalVotes:1,correctIndex:null});
      await expect(answerPoll(env,student,'room',poll.id,1)).rejects.toMatchObject({status:409});
      await expect(closePoll(env,student,'room',poll.id)).rejects.toMatchObject({status:403});
      expect(await closePoll(env,host,'room',poll.id)).toMatchObject({status:'CLOSED',correctIndex:1,totalVotes:1});
      await expect(answerPoll(env,other,'room',poll.id,1)).rejects.toMatchObject({status:409});
      await leaveRoom(env,other,'room');
      const nextPoll=await createPoll(env,host,'room','main',{kind:'POLL',question:'Again?',options:['One','Two']});
      await expect(answerPoll(env,other,'room',nextPoll.id,1)).rejects.toMatchObject({status:409});
      await closePoll(env,host,'room',nextPoll.id); await joinRoom(env,other,'room');
      await setHandRaised(env, student, 'room', true);
      let hand = (await roomState(env, host, 'room', null)).participants.find((p) => p.userId === 'student');
      expect(hand?.handRaised).toBe(true); expect(hand?.handRaisedAt).toMatch(/^\d{4}-/);
      const firstHandTime = hand?.handRaisedAt;
      await setHandRaised(env, student, 'room', true);
      hand = (await roomState(env, host, 'room', null)).participants.find((p) => p.userId === 'student');
      expect(hand?.handRaisedAt).toBe(firstHandTime);
      await setHandRaised(env, student, 'room', false);
      hand = (await roomState(env, host, 'room', null)).participants.find((p) => p.userId === 'student');
      expect(hand).toMatchObject({handRaised:false,handRaisedAt:null});
      await setHandRaised(env, other, 'room', true);
      await setHandRaised(env, student, 'room', true);
      expect((await roomState(env,host,'room',null)).participants.find(p=>p.userId==='other')?.handRaisedAt).toBeTruthy();
      await joinRoom(env,student,'room');
      expect((await roomState(env,host,'room',null)).participants.find(p=>p.userId==='student')).toMatchObject({handRaised:false,handRaisedAt:null});
      await expect(postSignal(env, student, 'room', { kind: 'KICK', targetId: host.id, payload: '' })).rejects.toMatchObject({ status: 403 });
      await leaveRoom(env, student, 'room');
      await roomState(env, student, 'room', received.signalCursor); // in-flight poll after leave
      expect((await roomState(env, host, 'room', null)).participants.some((p) => p.userId === 'student')).toBe(false);
    } finally { db.close(); }
  });
  it('allows only the mentor to choose an approved school and prevents switching during a live call', async () => {
    const specifier='node:sqlite';
    const sqlite=await import(/* @vite-ignore */ specifier).catch(()=>null) as {DatabaseSync:new(path:string)=>SqliteDb}|null;
    if(!sqlite)return;
    const db=new sqlite.DatabaseSync(':memory:');
    try {
      db.exec(schemaSql); db.exec('PRAGMA foreign_keys=OFF');
      db.exec(`INSERT INTO users(id,email,role,status,created_at,updated_at) VALUES('mentor','m@test','MENTOR','ACTIVE','now','now'),('student','s@test','STUDENT','ACTIVE','now','now');
        INSERT INTO mentor_classes(id,mentor_id,title,status,starts_at,ends_at,created_at,updated_at) VALUES('class','mentor','Class','OPEN','2027-01-01','2027-01-02','now','now');
        INSERT INTO mentor_sessions(id,mentor_id,student_id,class_id,kind,status,topic,starts_at,ends_at,created_at,updated_at) VALUES('room','mentor','mentor','class','CLASS','ACTIVE','Class','now','later','now','now');
        INSERT INTO schools(id,name,address,contact_email,owner_user_id,status,created_at,updated_at) VALUES('school','School','Address','s@test','mentor','APPROVED','now','now');
        INSERT INTO school_members(id,school_id,user_id,role,status,created_at,updated_at) VALUES('sm','school','mentor','OWNER','ACTIVE','now','now');`);
      const env={DB:adapter(db)} as unknown as Env, mentor=user('mentor','MENTOR'), student=user('student','STUDENT');
      await expect(setMentorClassBrand(env,student,'class','school')).rejects.toMatchObject({status:403});
      await expect(setMentorClassBrand(env,mentor,'class','school')).resolves.toEqual({sessionId:'room'});
      db.exec(`INSERT INTO mentor_room_presence(session_id,user_id,joined_at,last_seen_at,hand_raised,room_key,cam_on,mic_on,screen_on) VALUES('room','mentor','now','${new Date().toISOString()}',0,'main',1,1,0)`);
      await expect(setMentorClassBrand(env,mentor,'class',null)).rejects.toMatchObject({status:409});
      db.exec('DELETE FROM mentor_room_presence');
      await expect(setMentorClassBrand(env,mentor,'class',null)).resolves.toEqual({sessionId:'room'});
    } finally {db.close();}
  });

});
