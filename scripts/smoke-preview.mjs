import {spawn,spawnSync} from 'node:child_process';
import {setTimeout} from 'node:timers/promises';
import {readFile,writeFile} from 'node:fs/promises';
const origin='http://127.0.0.1:4175';
try {await fetch(origin,{signal:AbortSignal.timeout(500)});throw new Error('Port 4175 is in use. Stop that server before testing.');}
catch(error){if(error.message.startsWith('Port'))throw error;}
const configPath='dist/server/wrangler.json',original=await readFile(configPath,'utf8');
const config=JSON.parse(original);
if(config.vars?.APP_ENV!=='local')throw new Error('Build the local environment before running preview tests.');
const withoutMedia=process.argv.includes('--without-media');
const closed=process.argv.includes('--closed-registration');
if(withoutMedia)config.r2_buckets=[];
if(closed){config.vars.REGISTRATION_OPEN='false';config.vars.EMAIL_FROM='';config.send_email=[];}
if(withoutMedia||closed)await writeFile(configPath,JSON.stringify(config));
const server=spawn('pnpm',['preview','--port','4175'],{detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
let output='';server.stdout.on('data',chunk=>{output=(output+chunk).slice(-5000);});server.stderr.on('data',chunk=>{output=(output+chunk).slice(-5000);});
function run(args,env=process.env) {const result=spawnSync('pnpm',args,{stdio:'inherit',env});if(result.status!==0)throw new Error(`Failed: pnpm ${args.join(' ')}`);}
try {
  let ready=false;
  for(let attempt=0;attempt<60;attempt++) {
    if(server.exitCode!==null)throw new Error(output);
    try {await fetch(`${origin}/api/health`,{signal:AbortSignal.timeout(500)});ready=true;break;}catch{await setTimeout(500);}
  }
  if(!ready)throw new Error(`Preview did not start. ${output}`);
  run(['db:local']);
  const health=await fetch(`${origin}/api/health`);if(health.status!==200)throw new Error(`Preview health: ${health.status}`);
  if(closed) {
    const snapshot=await (await fetch(`${origin}/api/community`)).json();
    if(snapshot.config.registrationOpen || snapshot.config.emailEnabled)throw new Error('Preview account features are not closed');
    for(const [action,status] of [['signUp',403],['requestReset',503],['requestVerification',503]]) {
      const response=await fetch(`${origin}/api/community`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action})});
      if(response.status!==status)throw new Error(`${action} was not blocked in preview`);
    }
    if(!(await (await fetch(origin)).text()).includes('New member registration opens'))throw new Error('Preview banner missing');
    if(!(await (await fetch(`${origin}/robots.txt`)).text()).includes('Disallow: /'))throw new Error('Preview indexing is not disabled');
  } else run(['test:integration'],{...process.env,TEST_ORIGIN:origin,TEST_UPLOADS_ENABLED:withoutMedia?'false':'true'});
  console.log('Built Worker smoke checks passed.');
} catch(error){console.error(error.message);process.exitCode=1;}
finally {
  try {if(server.exitCode===null){if(process.platform==='win32')server.kill();else process.kill(-server.pid,'SIGTERM');}}
  finally {if(withoutMedia||closed)await writeFile(configPath,original);}
}
