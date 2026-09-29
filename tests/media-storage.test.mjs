import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkMedia,getMedia,putMedia,uploadsEnabled} from '../app/lib/media-storage.ts';
const env={APP_ENV:'production',SUPABASE_URL:'https://grounded-test.supabase.co',SUPABASE_STORAGE_BUCKET:'grounded-australia-production',SUPABASE_SECRET_KEY:'sb_secret_test'};
test('private Supabase adapter protects credentials, preserves bytes and rejects unsafe responses',async()=>{
 const original=globalThis.fetch,calls=[];let response;
 globalThis.fetch=async(url,init)=>{calls.push({url:String(url),init});return response;};
 try {
  assert.equal(uploadsEnabled(env),true);assert.equal(uploadsEnabled({...env,SUPABASE_SECRET_KEY:''}),false);
  response=Response.json({id:env.SUPABASE_STORAGE_BUCKET,public:false,file_size_limit:5242880,allowed_mime_types:['image/png']});await checkMedia(env);
  assert.equal(calls.at(-1).init.headers.get('apikey'),'sb_secret_test');assert.equal(calls.at(-1).init.headers.has('Authorization'),false);assert.equal(calls.at(-1).init.redirect,'manual');
  response=Response.json({id:env.SUPABASE_STORAGE_BUCKET,public:true,file_size_limit:5242880,allowed_mime_types:['image/png']});await assert.rejects(checkMedia(env),/Private/);
  const bytes=new Uint8Array([137,80,78,71]);response=Response.json({Key:'ok'});await putMedia(env,'member/photo.png',bytes,'image/png');
  assert.equal(calls.at(-1).init.method,'POST');assert.equal(calls.at(-1).init.headers.get('x-upsert'),'false');assert.deepEqual(new Uint8Array(await calls.at(-1).init.body.arrayBuffer()),bytes);
  response=new Response(bytes,{headers:{'content-type':'image/png','set-cookie':'bad=value','access-control-allow-origin':'*'}});const photo=await getMedia(env,'member/photo.png');
  assert.deepEqual(new Uint8Array(await photo.arrayBuffer()),bytes);assert.match(photo.headers.get('cache-control'),/no-store/);assert.match(photo.headers.get('content-security-policy'),/sandbox/);assert.equal(photo.headers.has('set-cookie'),false);assert.equal(photo.headers.has('access-control-allow-origin'),false);
  response=new Response('<script>bad()</script>',{headers:{'content-type':'text/html'}});assert.equal((await getMedia(env,'member/photo.png')).status,415);
  response=new Response(null,{status:404});assert.equal((await getMedia(env,'member/photo.png')).status,404);
  response=Response.json({statusCode:'404',code:'NoSuchKey'},{status:400});assert.equal((await getMedia(env,'member/photo.png')).status,404);
  response=new Response('private upstream error',{status:403});await assert.rejects(getMedia(env,'member/photo.png'),/storage unavailable/);
  for (const operation of [()=>checkMedia(env),()=>getMedia(env,'member/photo.png'),()=>putMedia(env,'member/photo.png',bytes,'image/png')]) {
   response=new Response(null,{status:302,headers:{location:'https://attacker.test'}});await assert.rejects(operation(),/storage unavailable/);
   assert.equal(calls.at(-1).init.redirect,'manual');assert.equal(new URL(calls.at(-1).url).origin,env.SUPABASE_URL);
  }
  response=Response.json({});await putMedia({...env,SUPABASE_SECRET_KEY:'legacy-jwt'},'member/photo.png',bytes,'image/png');assert.equal(calls.at(-1).init.headers.get('Authorization'),'Bearer legacy-jwt');
  const before=calls.length;await assert.rejects(putMedia(env,'../other/photo.png',bytes,'image/png'),/Invalid/);await assert.rejects(checkMedia({...env,SUPABASE_URL:'https://attacker.test'}),/configuration/);assert.equal(calls.length,before);
 } finally {globalThis.fetch=original;}
});
