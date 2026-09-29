import assert from 'node:assert/strict';
import {test} from 'node:test';
const origin=process.env.TEST_ORIGIN || 'http://localhost:3000';
if(!['localhost','127.0.0.1'].includes(new URL(origin).hostname))throw new Error('HTML checks only run against a local preview.');
test('public page server rendering includes the working surface and question metadata',async()=>{
  const response=await fetch(origin);assert.equal(response.status,200);const html=await response.text();
  assert.match(html,/Find answers for your patch/);assert.match(html,/Mobile navigation/);assert.doesNotMatch(html,/2,400\+ practical answers/);
  const data=await (await fetch(`${origin}/api/community`)).json();
  const question=data.questions.find(q=>q.demo);
  if(question){const detail=await fetch(`${origin}/questions/${question.slug}`);assert.equal(detail.status,200);const text=await detail.text();assert.match(text,/<title>/);assert.ok(text.includes(question.slug));assert.match(text,/Answers at a glance|Full question and field background/);}
  assert.equal((await fetch(origin+'/api/health')).status,200);
  assert.equal((await fetch(origin+'/questions/does-not-exist')).status,404);
  assert.match(await (await fetch(origin+'/robots.txt')).text(),/Disallow: \//);
  assert.equal((await fetch(origin+'/sitemap.xml')).status,200);
  for(const path of ['/ask','/auth','/search?type=experts','/me','/moderation','/rewards'])assert.equal((await fetch(origin+path)).status,200,path);
});
