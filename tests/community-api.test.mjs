import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const origin=process.env.TEST_ORIGIN || 'http://localhost:3000';
if(!['localhost','127.0.0.1'].includes(new URL(origin).hostname)) throw new Error('Integration tests only run on a local disposable dataset.');
const dir=resolve('.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
const file=(await readdir(dir)).filter(name=>name.endsWith('.sqlite')&&name!=='metadata.sqlite');
assert.equal(file.length,1,'Choose the exact local database before testing.');
const db=new DatabaseSync(resolve(dir,file[0]));db.exec('PRAGMA busy_timeout=5000');
const prefix=`smoke-${crypto.randomUUID()}`;
const actors=[];
async function post(actor,body,status=200) {
  const response=await fetch(`${origin}/api/community`,{method:'POST',headers:{'content-type':'application/json',...(actor?.cookie?{cookie:actor.cookie}:{})},body:JSON.stringify(body)});
  const result=await response.json(); assert.equal(response.status,status,JSON.stringify(result));
  return {result,cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
async function get(actor,query='') {
  const response=await fetch(`${origin}/api/community?${query}`,{headers:actor?.cookie?{cookie:actor.cookie}:{}});
  assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);return response.json();
}
async function signup(label) {
  const actor={email:`${prefix}-${label}@example.test`,cookie:'',id:''};actors.push(actor);
  const {cookie}=await post(null,{action:'signUp',name:`Smoke ${label}`,email:actor.email,password:`Test-${crypto.randomUUID()}`,state:'VIC',town:'Horsham'},201);actor.cookie=cookie;
  actor.id=(await get(actor)).currentUserId;assert.equal(actor.id.length,41);return actor;
}
function cleanup() {
  const ids=actors.map(a=>a.id).filter(Boolean);if(!ids.length){db.close();return;}
  const slots=ids.map(()=>'?').join(',');
  db.exec('BEGIN');
  try {
    const qids=db.prepare(`SELECT id FROM questions WHERE author_id IN (${slots})`).all(...ids).map(q=>q.id);
    const aids=db.prepare(`SELECT id FROM answers WHERE author_id IN (${slots})`).all(...ids).map(a=>a.id);
    const qslots=qids.map(()=>'?').join(',')||'NULL',aslots=aids.map(()=>'?').join(',')||'NULL';
    db.prepare(`DELETE FROM answer_revisions WHERE answer_id IN (${aslots})`).run(...aids);
    for(const table of ['votes','bookmarks','question_follows','notifications','expert_applications','xp_events','accounts','sessions','account_tokens','uploads'])db.prepare(`DELETE FROM ${table} WHERE user_id IN (${slots})`).run(...ids);
    db.prepare(`DELETE FROM comments WHERE author_id IN (${slots})`).run(...ids);
    db.prepare(`DELETE FROM invitations WHERE question_id IN (${qslots})`).run(...qids);
    db.prepare(`DELETE FROM user_follows WHERE follower_id IN (${slots}) OR followed_id IN (${slots})`).run(...ids,...ids);
    db.prepare(`DELETE FROM moderation_log WHERE moderator_id IN (${slots})`).run(...ids);
    db.prepare(`DELETE FROM reports WHERE reporter_id IN (${slots})`).run(...ids);
    db.prepare(`DELETE FROM answers WHERE author_id IN (${slots})`).run(...ids);
    db.prepare(`DELETE FROM questions WHERE author_id IN (${slots})`).run(...ids);
    db.prepare(`DELETE FROM users WHERE id IN (${slots})`).run(...ids);
    db.exec('COMMIT');
  } catch(error){db.exec('ROLLBACK');throw error;} finally{db.close();}
}
test('real member flows, local search, review permissions and private state',async t=>{
  t.after(cleanup);
  const a=await signup('Farmer'),b=await signup('Expert'),c=await signup('Reviewer');
  db.prepare('UPDATE users SET moderator=1 WHERE id=?').run(c.id);
  const knowledge={action:'ask',kind:'knowledge',title:'Practical guide to healthy soil',body:'A practical soil guide with field observations and advice for local growers.',category:'Soil',state:'VIC',town:'Horsham',tags:'soil',context:{imageCaption:'Soil photo. Credit: Test photographer'},requestKey:crypto.randomUUID()};
  await post(a,knowledge,403);
  const published=(await post(c,knowledge,201)).result;
  let guide=(await get(null,'view=search&type=knowledge')).questions.find(q=>q.slug===published.slug);
  assert.equal(guide.context.kind,'knowledge');
  assert.equal(guide.context.imageCaption,knowledge.context.imageCaption);
  await post(a,{...knowledge,action:'editQuestion',questionId:guide.id},403);
  const updatedCaption='Updated soil photo. Credit: Test photographer. '+ 'x'.repeat(300);
  await post(c,{...knowledge,kind:undefined,action:'editQuestion',questionId:guide.id,title:'Updated practical guide to healthy soil',context:{imageCaption:updatedCaption}});
  guide=(await get(null,'view=question&slug='+published.slug)).questions[0];
  assert.equal(guide.context.kind,'knowledge');
  assert.equal(guide.context.imageCaption,updatedCaption.slice(0,300));
  assert.equal(guide.title,'Updated practical guide to healthy soil');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM moderation_log WHERE target_id=? AND action='edit'").get(String(guide.id)).n,1);
  await post(c,{...knowledge,kind:undefined,action:'editQuestion',questionId:guide.id,context:{}});
  assert.equal((await get(null,'view=question&slug='+published.slug)).questions[0].context.imageCaption,updatedCaption.slice(0,300));
  await post(c,{...knowledge,kind:undefined,action:'editQuestion',questionId:guide.id,context:{imageCaption:''}});
  assert.equal((await get(null,'view=question&slug='+published.slug)).questions[0].context.imageCaption,'');
  db.prepare('UPDATE users SET moderator=0 WHERE id=?').run(c.id);
  await post(c,{...knowledge,kind:undefined,action:'editQuestion',questionId:guide.id},403);
  db.prepare('UPDATE users SET moderator=1 WHERE id=?').run(c.id);

  await post(b,{action:'updateProfile',name:'Smoke regional specialist',role:'Agricultural professional',state:'VIC',town:'Horsham',years:12,bio:'Field crop adviser working with growers.',specialties:'Wheat, field trials',categories:['Crops'],serviceStates:['VIC'],verified:1,moderator:1,xp:99999});
  let bstate=await get(b);assert.equal(bstate.users.find(u=>u.id===b.id).verified,0);assert.equal(bstate.isModerator,false);assert.equal(bstate.users.find(u=>u.id===b.id).xp,0);
  await post(b,{action:'updateProfile',name:'Bad',role:'Farmer',state:'VIC',town:'X',years:999},400);
  await post(b,{action:'applyExpert',scope:'Crops',evidence:'Twelve years of crop advisory work. Public organization profile: https://example.org/field-adviser'});
  assert.equal((await get(a)).application,null);assert.equal((await get(a,'view=moderation')).applications.length,0);
  await post(a,{action:'reviewExpert',userId:b.id,decision:'approved',reason:'Verified professional experience.'},403);
  await post(c,{action:'reviewExpert',userId:b.id,decision:'approved',reason:'Professional crop advisory background checked against public organization records.'});
  assert.equal((await get(b)).users.find(u=>u.id===b.id).verified,1);
  db.prepare('UPDATE users SET categories=? WHERE id=?').run('[]',b.id);
  const specialist=await get(null,'view=search&type=experts&state=VIC&category=Crops&q=regional');assert.ok(specialist.peopleIds.includes(b.id));
  assert.ok(!(await get(null,'view=search&type=experts&state=WA&category=Crops&q=regional')).peopleIds.includes(b.id));
  const ask={action:'ask',requestKey:crypto.randomUUID(),title:`${prefix} Yellow leaves after recent rainfall`,body:'The lower leaves have changed colour in several patches. What observations would help narrow down the cause?',category:'Crops',tags:'wheat,field-trial',state:'VIC',town:'Horsham',context:{subject:'Wheat',stage:'GS30',conditions:'Recent rain'}};
  const {result:q}=await post(a,ask,201);assert.equal((await post(a,ask,201)).result.slug,q.slug);
  const qstate=await get(a,`view=question&slug=${q.slug}`),question=qstate.questions[0];assert.equal(question.context.stage,'GS30');
  assert.ok((await get(null,`q=Horsham&category=Crops&state=VIC`)).questions.some(x=>x.id===question.id));
  await post(a,{action:'setBookmark',questionId:question.id,active:true});await post(a,{action:'setFollow',questionId:question.id,active:true});
  await post(a,{action:'followUser',userId:b.id,active:true});await post(a,{action:'followUser',userId:b.id,active:true});
  assert.equal((await get(b)).users.find(u=>u.id===b.id).followers,1);
  for(const viewer of [null,b]){const state=await get(viewer);assert.ok(!state.bookmarks.some(x=>x.question_id===question.id));assert.ok(!state.follows.some(x=>x.question_id===question.id));assert.ok(!state.userFollows.includes(b.id));}
  assert.ok((await get(a,'view=me&tab=saved')).questions.some(x=>x.id===question.id));
  await post(a,{action:'inviteExpert',questionId:question.id,expertId:b.id});await post(a,{action:'inviteExpert',questionId:question.id,expertId:b.id});
  bstate=await get(b,'view=me&tab=invitations');assert.equal(bstate.invitations.filter(x=>x.question_id===question.id).length,1);assert.equal(bstate.notifications.filter(n=>n.href.endsWith(q.slug)).length,1);
  assert.ok(!(await get(c)).invitations.some(x=>x.question_id===question.id));
  const ownNotice=bstate.notifications.find(n=>n.href.endsWith(q.slug));await post(a,{action:'readNotice',id:ownNotice.id});assert.equal((await get(b)).notifications.find(n=>n.id===ownNotice.id).read_at,null);
  await post(b,{action:'readNotice',id:ownNotice.id});assert.ok((await get(b)).notifications.find(n=>n.id===ownNotice.id).read_at);
  const answer={action:'answer',requestKey:crypto.randomUUID(),questionId:question.id,body:'Compare affected and healthy areas and record the conditions before deciding on a treatment.',productName:'Field notebook',relationship:'purchased',citationUrl:'https://example.org/reference',videoUrl:'https://example.org/video'};
  for(const relationship of ['__proto__','constructor','toString']) await post(b,{...answer,relationship,requestKey:crypto.randomUUID()},400);
  const {result:ans}=await post(b,answer,201);assert.equal((await post(b,answer,201)).result.answerId,ans.answerId);
  assert.equal((await get(b)).users.find(u=>u.id===b.id).xp,10);
  assert.equal((await get(b)).invitations.find(i=>i.question_id===question.id).status,'answered');
  assert.equal((await get(a)).notifications.filter(n=>n.message.startsWith('New answer:')&&n.href.endsWith(q.slug)).length,1);
  await post(a,{action:'vote',answerId:ans.answerId,value:1});assert.equal((await get(null,`view=question&slug=${q.slug}`)).answers[0].score,1);
  await post(a,{action:'vote',answerId:ans.answerId,value:0});assert.equal((await get(null,`view=question&slug=${q.slug}`)).answers[0].score,0);
  await post(b,{action:'vote',answerId:ans.answerId,value:1},400);
  await post(a,{action:'selectBest',questionId:question.id,answerId:ans.answerId});await post(a,{action:'selectBest',questionId:question.id,answerId:ans.answerId});assert.equal((await get(b)).users.find(u=>u.id===b.id).xp,30);
  await post(b,{action:'editAnswer',answerId:ans.answerId,body:'Updated field advice after reviewing the site conditions and supporting records.',productName:'Field notebook',relationship:'gifted',citationUrl:'https://example.org/updated',videoUrl:''});
  const updated=await get(null,`view=question&slug=${q.slug}`);assert.equal(updated.answers[0].commercial,1);assert.equal(updated.answers[0].video_url,null);assert.equal(updated.revisions.length,1);assert.equal(updated.revisions[0].content.relationship,'purchased');
  await post(a,{action:'editAnswer',answerId:ans.answerId,body:'Attempted change to another member answer.'},403);
  await post(a,{action:'fieldOutcome',questionId:question.id,outcome:'improved',note:'We compared the patches and the affected area has started improving under the recorded conditions.'});
  await post(b,{action:'fieldOutcome',questionId:question.id,outcome:'resolved',note:'This should not change someone else field report.'},403);
  assert.equal((await get(null,`view=question&slug=${q.slug}`)).questions[0].outcome,'improved');
  const comment={action:'comment',requestKey:crypto.randomUUID(),answerId:ans.answerId,body:'Useful context, I will compare the patches tomorrow.'};await post(a,comment,201);await post(a,comment,201);
  const commentId=(await get(a,`view=question&slug=${q.slug}`)).comments[0].id;
  await post(a,{action:'report',targetType:'comment',targetId:commentId,reason:'Review this example comment for the test.'},201);
  let queue=await get(c,'view=moderation');const report=queue.reports.find(r=>r.target_id===commentId&&r.target_type==='comment');assert.ok(report);
  await post(a,{action:'moderate',reportId:report.id,decision:'hide',reason:'Not authorized'},403);
  await post(c,{action:'moderate',reportId:report.id,decision:'hide',reason:'Hidden during review test.'});assert.equal((await get(null,`view=question&slug=${q.slug}`)).comments.length,0);
  await post(c,{action:'moderate',reportId:report.id,decision:'restore',reason:'Restored after review test.'});assert.equal((await get(null,`view=question&slug=${q.slug}`)).comments.length,1);
  const {result:self}=await post(a,{...answer,requestKey:crypto.randomUUID(),body:'My own field update with sufficient detail for future growers.'},201);await post(a,{action:'selectBest',questionId:question.id,answerId:self.answerId});assert.equal((await get(a)).users.find(u=>u.id===a.id).xp,10);
  await post(a,{action:'selectBest',questionId:question.id,answerId:ans.answerId});await post(a,{action:'deleteAnswer',answerId:self.answerId});assert.equal((await get(a,`view=question&slug=${q.slug}`)).questions[0].selected_answer_id,ans.answerId);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM xp_events WHERE kind='best_answer' AND related_id=?").get(question.id).n,1);
  await post(a,{action:'report',targetType:'question',targetId:question.id,reason:'Whole question visibility test.'},201);queue=await get(c,'view=moderation');const qr=queue.reports.find(r=>r.target_type==='question'&&r.target_id===question.id);
  await post(c,{action:'moderate',reportId:qr.id,decision:'hide',reason:'Hidden during visibility test.'});const hidden=await get(null,`view=question&slug=${q.slug}`);assert.equal(hidden.questions.length,0);assert.equal(hidden.answers.length,0);assert.equal(hidden.comments.length,0);
  await post(b,{...answer,requestKey:crypto.randomUUID()},404);await post(c,{action:'moderate',reportId:qr.id,decision:'restore',reason:'Restored after visibility test.'});
  const many=db.prepare('INSERT INTO answers (question_id,author_id,body) VALUES (?,?,?)');
  for(let n=0;n<101;n++)many.run(question.id,b.id,'Additional field observation with context for the large discussion test.');
  const large=await get(null,`view=question&slug=${q.slug}`);assert.equal(large.answerPageIds.length,20);assert.equal(large.answerPages,6);assert.equal(large.questions[0].answer_count,102);
  const lastPage=await get(null,`view=question&slug=${q.slug}&answerPage=6`);assert.equal(lastPage.answerPageIds.length,2);
  const target=lastPage.answerPageIds[1];assert.ok((await get(null,`view=question&slug=${q.slug}&answer=${target}`)).answerPageIds.includes(target));
  assert.ok((await get(null)).answers.length<=24);
  const low=await post(a,{...answer,requestKey:crypto.randomUUID(),body:'A follow-up from the grower with observations and updated field notes.'},201);
  const history=await get(a,'view=me&tab=answers');assert.ok(history.answers.some(item=>item.id===low.result.answerId),'Own low-ranked answers remain in history');
  const verifyToken=crypto.randomUUID()+crypto.randomUUID(),verifyHash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifyToken))).toString('hex');
  db.prepare('INSERT INTO account_tokens (id,user_id,purpose,expires_at) VALUES (?,?,?,?)').run(verifyHash,a.id,'verify',new Date(Date.now()+60000).toISOString());
  await post(null,{action:'verifyEmail',token:verifyToken});assert.equal((await get(a)).emailVerified,true);
  await post(null,{action:'verifyEmail',token:verifyToken},400);

  assert.equal((await get(null,'page=1.1')).page,1);
  const privateState=await get(null);for(const name of ['votes','bookmarks','follows','invitations','notifications','applications','reports'])assert.equal(privateState[name].length,0);
  assert.ok(privateState.users.every(u=>!('moderator' in u)&&!('email' in u)&&!('password_hash' in u)));
  assert.equal(privateState.config.uploadsEnabled,process.env.TEST_UPLOADS_ENABLED!=='false');
  if(privateState.config.uploadsEnabled) {
  for(const mime of ['image/svg+xml','image/png']){const form=new FormData();form.set('image',new Blob(['<svg xmlns="http://www.w3.org/2000/svg"><script>bad()</script></svg>'],{type:mime}),'bad.png');const response=await fetch(`${origin}/api/upload`,{method:'POST',headers:{cookie:a.cookie},body:form});assert.equal(response.status,400);}
  const photo=new FormData();photo.set('image',new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6LZkAAAAASUVORK5CYII=','base64')],{type:'image/png'}),'test.png');
  const uploaded=await fetch(`${origin}/api/upload`,{method:'POST',headers:{cookie:a.cookie},body:photo});assert.equal(uploaded.status,201);const uploadedUrl=(await uploaded.json()).url;
  const served=await fetch(origin+uploadedUrl,{headers:{cookie:a.cookie}});assert.equal(served.status,200);assert.equal(served.headers.get('content-type'),'image/png');assert.equal(served.headers.get('x-content-type-options'),'nosniff');assert.match(served.headers.get('content-security-policy'),/sandbox/);
  assert.equal((await fetch(origin+uploadedUrl)).status,404,'Unattached images are private');
  await post(a,{...ask,action:'editQuestion',questionId:question.id,imageUrl:uploadedUrl});
  assert.equal((await fetch(origin+uploadedUrl)).status,200);
  await post(c,{action:'moderate',reportId:qr.id,decision:'hide',reason:'Media visibility check.'});
  assert.equal((await fetch(origin+uploadedUrl)).status,404,'Hidden media is no longer public');
  await post(c,{action:'moderate',reportId:qr.id,decision:'restore',reason:'Restore after media check.'});
  } else {
    assert.equal((await fetch(`${origin}/api/health`)).status,200);
    const before=db.prepare('SELECT COUNT(*) AS n FROM uploads').get().n;
    const response=await fetch(`${origin}/api/upload`,{method:'POST',headers:{cookie:a.cookie},body:new FormData()});
    assert.equal(response.status,503);assert.match((await response.json()).error,/not enabled/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM uploads').get().n,before);
    const imageUrl=`/api/media/${a.id}/${crypto.randomUUID()}.png`;
    assert.equal((await fetch(origin+imageUrl)).status,404);
    await post(a,{...ask,requestKey:crypto.randomUUID(),imageUrl},503);
    await post(a,{...ask,action:'editQuestion',questionId:question.id,imageUrl},503);
    await post(a,{...answer,requestKey:crypto.randomUUID(),imageUrl},503);
    await post(a,{action:'updateProfile',name:'Smoke A',role:'Farmer',state:'VIC',town:'Horsham',years:3,avatarUrl:imageUrl},503);
    const page=await fetch(`${origin}/questions/${question.slug}`,{headers:{cookie:a.cookie}});assert.equal(page.status,200);
    const html=await page.text();assert.match(html,/class="answer-editor"/,'Check the actual rendered answer form');
    assert.doesNotMatch(html,/<input[^>]*type="file"/,'Text-only answers do not offer photo upload');
  }
  const token=crypto.randomUUID()+crypto.randomUUID();
  const tokenHash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))).toString('hex');
  db.prepare('INSERT INTO account_tokens (id,user_id,purpose,expires_at) VALUES (?,?,?,?)').run(tokenHash,b.id,'reset',new Date(Date.now()+60000).toISOString());
  const newPassword=`Updated-${crypto.randomUUID()}`;
  await post(null,{action:'resetPassword',token,password:newPassword});
  assert.equal((await get(b)).currentUserId,null,'Reset revokes existing sessions');
  await post(null,{action:'resetPassword',token,password:newPassword},400);
  const signed=await post(null,{action:'signIn',email:b.email,password:newPassword});b.cookie=signed.cookie;
  assert.equal((await get(b)).emailVerified,true);
  assert.match(db.prepare('SELECT password_hash FROM accounts WHERE user_id=?').get(b.id).password_hash,/^scrypt-v1\$/);
  await post(b,{action:'signOutAll'});assert.equal((await get(b)).currentUserId,null);
  const raceToken=crypto.randomUUID()+crypto.randomUUID(),raceHash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raceToken))).toString('hex');
  db.prepare('INSERT INTO account_tokens (id,user_id,purpose,expires_at) VALUES (?,?,?,?)').run(raceHash,b.id,'reset',new Date(Date.now()+60000).toISOString());
  const [raceLogin]=await Promise.all([
    fetch(`${origin}/api/community`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'signIn',email:b.email,password:newPassword})}),
    post(null,{action:'resetPassword',token:raceToken,password:`Final-${crypto.randomUUID()}`})
  ]);
  assert.ok([200,401].includes(raceLogin.status));
  if(raceLogin.status===200)assert.equal((await get({cookie:raceLogin.headers.get('set-cookie').split(';')[0]})).currentUserId,null,'Concurrent old-password login must not survive a completed reset');

  const csrf=await fetch(`${origin}/api/community`,{method:'POST',headers:{'content-type':'application/json',origin:'https://different.example',cookie:a.cookie},body:JSON.stringify({action:'setBookmark',questionId:question.id,active:false})});assert.equal(csrf.status,403);
});
