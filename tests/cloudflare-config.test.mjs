import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateConfig} from '../scripts/cloudflare.mjs';
const source=JSON.parse(await readFile('wrangler.jsonc','utf8'));
test('release validation rejects placeholders, shared data and wrong environments',()=>{
  const placeholder=structuredClone(source);placeholder.env.production.vars.SITE_URL='https://example.com';
  assert.throws(()=>validateConfig(placeholder,'production'),/SITE_URL/);
  assert.throws(()=>validateConfig(source,'local'),/explicitly/);
  const config=structuredClone(source),env=config.env.production;
  env.vars.SITE_URL='https://grounded.test';env.vars.EMAIL_FROM='hello@grounded.test';env.vars.TURNSTILE_SITE_KEY='real-site-key';env.d1_databases[0].database_id='f003c70d-5bc8-4fe5-913b-7bb1f6abeb01';
  env.vars.SUPABASE_URL='';env.vars.SUPABASE_STORAGE_BUCKET='';
  assert.equal(validateConfig(config,'production').name,'grounded-australia');
  delete env.r2_buckets;
  assert.throws(()=>validateConfig(config,'production'),/text-only/);
  env.r2_buckets=[{binding:'MEDIA',bucket_name:'grounded-media-production'}];
  assert.equal(validateConfig(config,'production').name,'grounded-australia');
  env.r2_buckets[0].bucket_name=config.env.staging.r2_buckets[0].bucket_name;
  assert.throws(()=>validateConfig(config,'production'),/separate/);
});

test('Supabase release keeps storage private by configuration and explicitly closes registration without email',()=>{
 const config=structuredClone(source),env=config.env.production;
 env.vars.SUPABASE_URL='https://grounded-test.supabase.co';env.vars.SUPABASE_STORAGE_BUCKET='grounded-australia-production';env.r2_buckets=[];env.vars.REGISTRATION_OPEN='false';env.vars.EMAIL_FROM='';env.send_email=[];
 assert.equal(validateConfig(config,'production'),env);
 env.vars.TURNSTILE_SITE_KEY='';assert.equal(validateConfig(config,'production'),env);
 env.vars.TURNSTILE_SITE_KEY='real-site-key';env.vars.REGISTRATION_OPEN='true';assert.throws(()=>validateConfig(config,'production'),/EMAIL_FROM/);
 env.vars.EMAIL_FROM='hello@grounded.test';assert.throws(()=>validateConfig(config,'production'),/EMAIL binding/);
 env.send_email=[{name:'EMAIL'}];assert.equal(validateConfig(config,'production'),env);
 env.vars.SUPABASE_URL='https://attacker.test';assert.throws(()=>validateConfig(config,'production'),/SUPABASE_URL/);
 env.vars.SUPABASE_URL='https://grounded-test.supabase.co';env.r2_buckets=[{binding:'MEDIA',bucket_name:'grounded-images'}];assert.throws(()=>validateConfig(config,'production'),/not both/);
});
