import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {adminSetup} from '../scripts/provision-admin.mjs';
test('administrator setup is private, single-use, and does not reset existing accounts',async()=>{
  const db=new DatabaseSync(':memory:');
  try {
    for(const name of (await readdir('drizzle')).filter(n=>n.endsWith('.sql')).sort())db.exec(await readFile('drizzle/'+name,'utf8'));
    const setup=adminSetup("admin.o'neil@example.test",'https://example.test');db.exec(setup.sql);
    assert.equal(db.prepare('SELECT moderator FROM users').get().moderator,1);
    assert.equal(db.prepare('SELECT email_verified_at FROM accounts').get().email_verified_at,null);
    const token=new URLSearchParams(new URL(setup.url).hash.slice(1)).get('token');
    const record=db.prepare('SELECT * FROM account_tokens').get();assert.equal(record.id,createHash('sha256').update(token).digest('hex'));
    assert.equal(record.purpose,'reset');assert.equal(record.used_at,null);
    const old=db.prepare('SELECT * FROM accounts').get();
    db.exec(adminSetup(old.email,'https://example.test').sql);
    assert.deepEqual(db.prepare('SELECT * FROM accounts').get(),old);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n,1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM account_tokens').get().n,1);
    assert.throws(()=>adminSetup('invalid','https://example.test'));
  } finally {db.close();}
});
