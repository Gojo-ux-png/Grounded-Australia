import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {validateConfig} from './cloudflare.mjs';

// Bootstrap only a new, explicitly designated operator. Existing accounts use cf:admin.
export function adminSetup(email,origin) {
  email=email.trim().toLowerCase();
  if(!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email)||email.length>180)throw new Error('Provide a valid administrator email.');
  const id=`user-${randomUUID()}`,token=randomUUID()+randomUUID(),expires=new Date(Date.now()+30*60*1000).toISOString();
  const quote=value=>`'${value.replaceAll("'","''")}'`;
  const hash=createHash('sha256').update(token).digest('hex');
  const sql=`INSERT INTO users (id,handle,name,initials,role,verified,state,town,bio,specialties,moderator)
SELECT ${quote(id)},${quote('admin-'+randomUUID().slice(0,8))},'Grounded Admin','GA','Community administrator',0,'','','','',1
WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE email=${quote(email)});
INSERT INTO accounts (user_id,email,password_hash,password_salt)
SELECT ${quote(id)},${quote(email)},${quote('scrypt-v1$'+randomBytes(32).toString('hex'))},${quote(randomBytes(16).toString('hex'))}
WHERE EXISTS (SELECT 1 FROM users WHERE id=${quote(id)});
INSERT INTO account_tokens (id,user_id,purpose,expires_at)
SELECT ${quote(hash)},${quote(id)},'reset',${quote(expires)} WHERE EXISTS (SELECT 1 FROM accounts WHERE user_id=${quote(id)});
SELECT COUNT(*) AS created FROM accounts WHERE user_id=${quote(id)};`;
  return {userId:id,sql,url:`${origin}/auth?mode=reset#token=${token}`,expires,email};
}
async function main() {
  const [environment,email]=process.argv.slice(2);
  const config=validateConfig(JSON.parse(await readFile('wrangler.jsonc','utf8')),environment);
  const setup=adminSetup(email||'',config.vars.SITE_URL);
  await mkdir('.wrangler',{recursive:true});
  const sqlPath=`.wrangler/admin-setup-${Date.now()}.sql`;
  await writeFile(sqlPath,setup.sql,{mode:0o600});
  try {
    const result=spawnSync('pnpm',['exec','wrangler','d1','execute','DB','--remote','--config','wrangler.jsonc','--env',environment,'--file',sqlPath,'--json'],{encoding:'utf8',env:{...process.env,WRANGLER_LOG_PATH:'.wrangler/wrangler.log'}});
    if(result.status!==0)throw new Error('Administrator provisioning failed. Check the private Wrangler log.');
    const check=spawnSync('pnpm',['exec','wrangler','d1','execute','DB','--remote','--config','wrangler.jsonc','--env',environment,'--command',`SELECT COUNT(*) AS created FROM accounts WHERE user_id='${setup.userId}'`,'--json'],{encoding:'utf8',env:{...process.env,WRANGLER_LOG_PATH:'.wrangler/wrangler.log'}});
    if(check.status!==0)throw new Error('Could not verify administrator provisioning. Check the private Wrangler log.');
    const start=check.stdout.search(/^\s*\[/m);
    const response=JSON.parse(check.stdout.slice(start,check.stdout.lastIndexOf(']')+1));
    if(!response.some(item=>item.results?.some(row=>row.created===1)))throw new Error('No new account created. Existing accounts must use cf:admin; their passwords were not changed.');
    const output='.wrangler/admin-setup.md';
    await writeFile(output,`管理员账号：${setup.email}\n\n[设置登录密码](${setup.url})\n\n链接一次有效，过期时间：${setup.expires}。设置后使用该邮箱及新密码登录。\n`,{mode:0o600});
    console.log(`Administrator created. Private setup link saved to ${output}; expires ${setup.expires}.`);
  } finally {await rm(sqlPath,{force:true});}
}
if(process.argv[1]===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
