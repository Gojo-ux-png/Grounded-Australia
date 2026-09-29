import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
test('fresh database migrates twice, accepts opt-in demo content and keeps explicit reviewer access',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'grounded-migration-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const path=join(dir,'test.sqlite');
  for(const operation of ['migrate','migrate','seed']){const result=spawnSync(process.execPath,['scripts/local-db.mjs',operation,'--database',path],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);}
  const db=new DatabaseSync(path);t.after(()=>db.close());
  assert.equal(db.prepare('SELECT COUNT(*) n FROM grounded_local_migrations').get().n,6);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM users WHERE demo=1 AND verified=0').get().n,5);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM users WHERE moderator=1').get().n,0);
  db.prepare("INSERT INTO user_follows VALUES ('a','b')").run();assert.throws(()=>db.prepare("INSERT INTO user_follows VALUES ('a','b')").run(),/UNIQUE/);
  const grant=spawnSync(process.execPath,['scripts/local-db.mjs','admin','unknown@example.test','--database',path],{encoding:'utf8'});assert.notEqual(grant.status,0);
});
