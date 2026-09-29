import { DatabaseSync, backup } from 'node:sqlite';
import { readdir, readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const args=process.argv.slice(2);
const operation=args[0] || 'migrate';
const supplied=args.includes('--database') ? args[args.indexOf('--database')+1] : null;
const directory=resolve('.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
const files=supplied ? [] : (await readdir(directory).catch(()=>[])).filter(n=>n.endsWith('.sqlite') && n!=='metadata.sqlite');
if(!supplied && files.length!==1) throw new Error('Start pnpm dev once to create the local database, or pass --database with its exact SQLite path.');
const path=supplied ? resolve(supplied) : resolve(directory,files[0]);
const db=new DatabaseSync(path); db.exec('PRAGMA busy_timeout=5000;');
if(operation==='migrate') {
  await mkdir('.wrangler/backups',{recursive:true});
  await backup(db,resolve(`.wrangler/backups/before-${Date.now()}.sqlite`));
  db.exec('CREATE TABLE IF NOT EXISTS grounded_local_migrations (name TEXT PRIMARY KEY, sha TEXT NOT NULL)');
  for(const name of (await readdir('drizzle')).filter(n=>n.endsWith('.sql')).sort()) {
    const sql=await readFile(`drizzle/${name}`,'utf8');
    const sha=createHash('sha256').update(sql).digest('hex');
    const applied=db.prepare('SELECT sha FROM grounded_local_migrations WHERE name=?').get(name);
    if(applied) { if(applied.sha!==sha) throw new Error(`Applied migration changed: ${name}`); continue; }
    db.exec('BEGIN IMMEDIATE');
    try {
      for(const statement of sql.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean)) {
        // Adopt the original runtime-created database without recreating existing tables.
        const create=statement.match(/^CREATE TABLE [`"]?(\w+)/i);
        if(create && db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(create[1])) continue;
        const add=statement.match(/^ALTER TABLE [`"]?(\w+)[`"]? ADD [`"]?(\w+)/i);
        if(add && db.prepare(`PRAGMA table_info("${add[1]}")`).all().some(c=>c.name===add[2])) continue;
        const index=statement.match(/^CREATE (?:UNIQUE )?INDEX [`"]?(\w+)/i);
        if(index && db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name=?").get(index[1])) continue;
        db.exec(statement);
      }
      db.prepare('INSERT INTO grounded_local_migrations VALUES (?,?)').run(name,sha);
      db.exec('COMMIT'); console.log(`Applied ${name}`);
    } catch(error) { db.exec('ROLLBACK'); throw error; }
  }
}
if(operation==='seed') db.exec(await readFile('scripts/demo-seed.sql','utf8'));
if(operation==='migrate' || operation==='seed') {
  const demos=[['farmer-ella','Crops','VIC'],['grower-tom','Soil','NSW'],['farmer-jack','Livestock','TAS'],['expert-priya','Crops','QLD'],['expert-mei','Soil','SA']];
  for(const [id,field,state] of demos) {
    if(!db.prepare('SELECT 1 FROM users WHERE id=? AND demo=0 AND NOT EXISTS (SELECT 1 FROM accounts WHERE user_id=?)').get(id,id)) continue;
    // Remove known demo baselines once; retain any subsequent local views.
    const baselines={1:1248,2:684,3:391,4:219,5:512};
    for(const [questionId,views] of Object.entries(baselines)) db.prepare('UPDATE questions SET views=MAX(0,views-?) WHERE id=? AND author_id=?').run(views,Number(questionId),id);
    db.prepare("UPDATE users SET demo=1,verified=0,role=?,xp=0,followers=0,following=0,base_likes=0,categories=?,service_states=? WHERE id=?").run(id.startsWith('expert')?'Agricultural professional':'Farmer',JSON.stringify([field]),JSON.stringify([state]),id);
  }
}
if(operation==='admin') {
  const email=args[1]; if(!email || email.startsWith('--')) throw new Error('Usage: node scripts/local-db.mjs admin registered-email');
  const result=db.prepare('UPDATE users SET moderator=1 WHERE id=(SELECT user_id FROM accounts WHERE email=?)').run(email.toLowerCase());
  if(!result.changes) throw new Error('Register that account locally first. No account was changed.');
  console.log('Local reviewer access granted to the registered account.');
}
if(!['migrate','seed','admin'].includes(operation)) throw new Error('Choose migrate, seed or admin.');
db.close();
