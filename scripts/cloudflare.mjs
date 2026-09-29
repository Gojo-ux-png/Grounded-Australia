import {readFile,writeFile,readdir,mkdir,rm,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

export function validateConfig(config,environment) {
  if(!['staging','production'].includes(environment))throw new Error('Choose staging or production explicitly.');
  const target=config.env?.[environment];if(!target)throw new Error(`Missing ${environment} configuration.`);
  const url=new URL(target.vars?.SITE_URL || 'http://localhost');
  if(url.protocol!=='https:' || url.username || url.password || url.pathname!=='/' || url.search || url.hash || ['localhost','127.0.0.1','example.com'].includes(url.hostname) || url.hostname.endsWith('.example.com'))throw new Error('Set SITE_URL to the exact HTTPS origin for this environment.');
  if(target.vars.APP_ENV!==environment)throw new Error('APP_ENV must match the selected environment.');
  if(!target.name || target.name.includes('local'))throw new Error('Set an explicit Worker name.');
  const db=target.d1_databases?.find(b=>b.binding==='DB');
  if(!db || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(db.database_id) || db.database_id.startsWith('00000000') || db.migrations_dir!=='drizzle')throw new Error('Set the real D1 database ID and preserve migrations_dir: drizzle.');
  if(!Array.isArray(target.r2_buckets))throw new Error('Set r2_buckets to [] for text-only mode, or configure the MEDIA bucket.');
  const media=target.r2_buckets.find(b=>b.binding==='MEDIA');if(target.r2_buckets.length && (!media?.bucket_name || media.bucket_name.includes('site-creator')))throw new Error('Set the MEDIA bucket.');
  const storageUrl=target.vars.SUPABASE_URL,storageBucket=target.vars.SUPABASE_STORAGE_BUCKET;
  if(storageUrl || storageBucket) {
    const origin=new URL(storageUrl || 'http://localhost');
    if(origin.protocol!=='https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(origin.hostname) || origin.pathname!=='/' || origin.username || origin.password || origin.search || origin.hash || !/^grounded-australia-[a-z0-9-]+$/.test(storageBucket || ''))throw new Error('Set the hosted SUPABASE_URL and a dedicated grounded-australia storage bucket.');
    if(media)throw new Error('Choose Supabase Storage or R2 for this environment, not both.');
  }
  const other=config.env[environment==='staging'?'production':'staging'];
  if(other?.d1_databases?.some(b=>b.database_id===db.database_id) || (media && other?.r2_buckets?.some(b=>b.bucket_name===media.bucket_name)) || other?.name===target.name)throw new Error('Staging and production must use separate Workers, databases and buckets.');
  if(storageUrl && storageUrl===other?.vars?.SUPABASE_URL && storageBucket===other?.vars?.SUPABASE_STORAGE_BUCKET)throw new Error('Staging and production must use separate storage buckets.');
  if(!['true','false'].includes(target.vars.REGISTRATION_OPEN))throw new Error('Set REGISTRATION_OPEN explicitly.');
  if(target.vars.REGISTRATION_OPEN==='true') {
    if(!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(target.vars.EMAIL_FROM || '') || target.vars.EMAIL_FROM.endsWith('@example.com'))throw new Error('Set EMAIL_FROM to an address on your verified sending domain.');
    if(!target.send_email?.some(b=>b.name==='EMAIL'))throw new Error('Missing EMAIL binding.');
  }
  if(!target.vars.TURNSTILE_SITE_KEY || target.vars.TURNSTILE_SITE_KEY.includes('REPLACE') || /^[123]x0{10}/.test(target.vars.TURNSTILE_SITE_KEY))throw new Error('Set a real Turnstile site key, not a test key.');
  for(const name of ['READ_LIMITER','AUTH_LIMITER','WRITE_LIMITER','UPLOAD_LIMITER'])if(!target.ratelimits?.some(b=>b.name===name && b.simple.limit>0 && b.simple.limit<10000))throw new Error(`Configure ${name}.`);
  return target;
}
function run(args,options={}) {
  const result=spawnSync('pnpm',args,{stdio:'inherit',env:process.env,...options});
  if(result.status!==0)throw new Error(`Command failed: pnpm ${args.join(' ')}`);
  return result;
}
async function digest(roots) {
  const hash=createHash('sha256');
  async function visit(path) {
    let list;try{list=await readdir(path,{withFileTypes:true});}catch{hash.update(path);hash.update(await readFile(path));return;}
    for(const entry of list.sort((a,b)=>a.name.localeCompare(b.name)))if(entry.name!=='grounded-release.json')await visit(join(path,entry.name));
  }
  for(const path of roots)await visit(path);return hash.digest('hex');
}
const sourceFiles=['app','db','worker','build','drizzle','public','vite.config.ts','next.config.ts','wrangler.jsonc','package.json','pnpm-lock.yaml','tsconfig.json','pnpm-workspace.yaml','scripts/cloudflare.mjs'];
async function main() {
  const [action,environment,email]=process.argv.slice(2),config=JSON.parse(await readFile('wrangler.jsonc','utf8'));
  const target=validateConfig(config,environment);
  if(action==='check'){console.log(`${environment}: configuration is ready (${target.vars.REGISTRATION_OPEN==='true'?'registration open; verify sending domain':'preview; registration closed'}). Verify storage and required Worker secrets before release.`);return;}
  if(action==='build') {
    run(['run','build'],{env:{...process.env,CLOUDFLARE_ENV:environment}});
    const output=JSON.parse(await readFile('dist/server/wrangler.json','utf8'));
    if(output.name!==target.name || output.vars?.APP_ENV!==environment || output.d1_databases?.[0]?.database_id!==target.d1_databases[0].database_id)throw new Error('Build output does not match the selected environment.');
    await writeFile('dist/grounded-release.json',JSON.stringify({environment,source:await digest(sourceFiles),artifact:await digest(['dist'])},null,2));
    return;
  }
  if(action==='admin') {
    if(!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length>180)throw new Error('Pass the registered, verified reviewer email.');
    const path=`.wrangler/admin-${Date.now()}.sql`;await mkdir('.wrangler',{recursive:true});
    await writeFile(path,`UPDATE users SET moderator=1 WHERE demo=0 AND id IN (SELECT user_id FROM accounts WHERE email='${email.toLowerCase().replaceAll("'","''")}' AND email_verified_at IS NOT NULL);\nSELECT changes() AS granted;`);
    try {run(['exec','wrangler','d1','execute','DB','--remote','--config','wrangler.jsonc','--env',environment,'--file',path]);}finally{await rm(path,{force:true});}
    return;
  }
  if(!['dry-run','deploy'].includes(action))throw new Error('Use check, build, dry-run, deploy or admin.');
  const release=JSON.parse(await readFile('dist/grounded-release.json','utf8'));
  if(release.environment!==environment || release.source!==await digest(sourceFiles) || release.artifact!==await digest(['dist']))throw new Error('Source, configuration or artifacts changed. Build this environment again.');
  if(action==='dry-run'){run(['exec','wrangler','deploy','--config','dist/server/wrangler.json','--dry-run']);return;}
  await mkdir('.wrangler/backups',{recursive:true});
  const backup=`.wrangler/backups/${environment}-${Date.now()}.sql`;
  run(['exec','wrangler','d1','export','DB','--remote','--config','wrangler.jsonc','--env',environment,'--skip-confirmation','--output',backup],{stdio:'pipe',encoding:'utf8'});
  if(!(await stat(backup)).size)throw new Error('Database backup is empty. Migration and deployment were stopped.');
  run(['exec','wrangler','d1','migrations','apply','DB','--remote','--config','wrangler.jsonc','--env',environment]);
  run(['exec','wrangler','deploy','--config','dist/server/wrangler.json']);
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  process.env.WRANGLER_LOG_PATH ||= '.wrangler/wrangler.log';
  main().catch(error=>{console.error(error.message);process.exitCode=1;});
}
