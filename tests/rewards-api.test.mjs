import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

const origin = process.env.TEST_ORIGIN || 'http://localhost:3000';
if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname)) {
  throw new Error('Rewards integration tests only run against a local disposable dataset.');
}
const directory = resolve('.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
const files = (await readdir(directory)).filter(name => name.endsWith('.sqlite') && name !== 'metadata.sqlite');
assert.equal(files.length, 1, 'Choose the exact local database before testing.');
const db = new DatabaseSync(resolve(directory, files[0]));
db.exec('PRAGMA busy_timeout=5000');
const prefix = `rewards-test-${randomUUID()}`;
const actors = [];

// Accounts cannot sign in: only this local fixture knows the short-lived session cookies.
function actor(label, { verified = true, demo = false, moderator = false, account = true } = {}) {
  const id = `user-${randomUUID()}`, email = `${prefix}-${label}@example.test`;
  const value = { id, email, cookie: `grounded_session=${randomBytes(32).toString('hex')}` };
  actors.push(value);
  db.prepare(`INSERT INTO users (id,handle,name,initials,role,state,town,bio,specialties,demo,moderator)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id, `${prefix}-${label}`, `Rewards ${label}`, 'RT', 'Farmer', 'VIC', 'Horsham', 'Local integration test member.', 'Wheat', Number(demo), Number(moderator));
  if (account) db.prepare('INSERT INTO accounts (user_id,email,password_hash,password_salt,email_verified_at) VALUES (?,?,?,?,?)')
    .run(id, email, 'not-a-valid-password-hash', 'not-a-valid-password-salt', verified ? new Date().toISOString() : null);
  const session = createHash('sha256').update(value.cookie.split('=')[1]).digest('hex');
  db.prepare('INSERT INTO sessions (id,user_id,expires_at) VALUES (?,?,?)').run(session, id, new Date(Date.now() + 3_600_000).toISOString());
  return value;
}

async function request(path, member, body, expected = 200) {
  const response = await fetch(`${origin}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(member ? { cookie: member.cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (expected !== null) assert.ok((Array.isArray(expected) ? expected : [expected]).includes(response.status), `${path} ${body?.action || 'GET'}: ${response.status} ${JSON.stringify(result)}`);
  if (path.startsWith('/api/rewards')) assert.match(response.headers.get('cache-control') || '', /no-store/, 'Private API responses must not be cached.');
  return { status: response.status, result };
}
const community = (member, body, status = 200) => request('/api/community', member, body, status);
const post = (member, body, status = [200, 201]) => request('/api/rewards', member, body, status);
const snapshot = async (member, query = '') => (await request(`/api/rewards${query}`, member)).result;
const wallet = async member => (await snapshot(member)).wallet;
const order = async (member, id) => (await snapshot(member)).orders.find(item => item.id === id);

async function ask(member, label) {
  const { result } = await community(member, {
    action: 'ask', requestKey: randomUUID(), title: `${prefix} ${label} wheat observations`,
    body: 'These wheat plants show uneven growth after rainfall. Which field observations should I record before choosing a treatment?',
    category: 'Crops', tags: 'wheat', state: 'VIC', town: 'Horsham', context: { subject: 'Wheat' },
  }, 201);
  return db.prepare('SELECT id,slug FROM questions WHERE slug=? AND author_id=?').get(result.slug, member.id);
}
async function answer(member, question) {
  return (await community(member, {
    action: 'answer', requestKey: randomUUID(), questionId: question.id,
    body: 'Compare affected and healthy plants, record soil moisture and drainage, and keep dated field notes before deciding on treatment.',
    relationship: 'none',
  }, 201)).result.answerId;
}
async function report(member, type, id) {
  await community(member, { action: 'report', targetType: type, targetId: id, reason: 'Local rewards visibility integration test.' }, 201);
  return db.prepare('SELECT id FROM reports WHERE reporter_id=? AND target_type=? AND target_id=? ORDER BY id DESC LIMIT 1').get(member.id, type, id).id;
}
const moderate = (admin, reportId, decision) => community(admin, { action: 'moderate', reportId, decision, reason: 'Review rewards eligibility after this visibility change.' });

async function save(admin, label, points, stock, existing = {}) {
  const fields = {
    name: `${prefix} ${label}`, description: 'A local test reward with manual fulfilment.', kind: 'product',
    points, totalStock: stock, active: true, partner: 'Integration test partner',
    fulfillment: 'The moderator arranges fulfilment after reviewing the request.', ...existing,
  };
  await post(admin, { action: 'saveReward', ...fields });
  const reward = (await snapshot(admin, '?view=admin')).admin.catalog.find(item => item.name === fields.name);
  assert.ok(reward, 'Saved reward must appear in the moderator catalog.');
  return reward;
}
async function redeem(member, reward, { key = randomUUID(), expected = [200, 201], ...extra } = {}) {
  // Confirm the catalog snapshot the member saw; do not silently refresh price or fulfilment terms.
  const response = await post(member, { action: 'redeem', rewardId: reward.id, expectedPoints: reward.points, expectedRevision: reward.revision, requestKey: key, ...extra }, expected);
  const saved = db.prepare('SELECT id FROM reward_orders WHERE user_id=? AND request_key=?').get(member.id, key);
  return { ...response, id: saved?.id, key };
}

function cleanup() {
  const ids = actors.map(member => member.id);
  if (!ids.length) { db.close(); return; }
  const slots = ids.map(() => '?').join(',');
  db.exec('BEGIN');
  try {
    db.prepare(`DELETE FROM reward_order_events WHERE order_id IN (SELECT id FROM reward_orders WHERE user_id IN (${slots}))`).run(...ids);
    db.prepare(`DELETE FROM reward_orders WHERE user_id IN (${slots})`).run(...ids);
    db.prepare('DELETE FROM reward_items WHERE name LIKE ?').run(`${prefix}%`);
    db.prepare(`DELETE FROM answer_revisions WHERE answer_id IN (SELECT id FROM answers WHERE author_id IN (${slots}))`).run(...ids);
    for (const table of ['votes', 'bookmarks', 'question_follows', 'notifications', 'expert_applications', 'xp_events', 'accounts', 'sessions', 'account_tokens', 'uploads']) {
      db.prepare(`DELETE FROM ${table} WHERE user_id IN (${slots})`).run(...ids);
    }
    db.prepare(`DELETE FROM comments WHERE author_id IN (${slots})`).run(...ids);
    db.prepare(`DELETE FROM invitations WHERE question_id IN (SELECT id FROM questions WHERE author_id IN (${slots}))`).run(...ids);
    db.prepare(`DELETE FROM user_follows WHERE follower_id IN (${slots}) OR followed_id IN (${slots})`).run(...ids, ...ids);
    db.prepare(`DELETE FROM moderation_log WHERE moderator_id IN (${slots})`).run(...ids);
    db.prepare(`DELETE FROM reports WHERE reporter_id IN (${slots})`).run(...ids);
    db.prepare(`DELETE FROM answers WHERE author_id IN (${slots})`).run(...ids);
    db.prepare(`DELETE FROM questions WHERE author_id IN (${slots})`).run(...ids);
    db.prepare(`DELETE FROM users WHERE id IN (${slots})`).run(...ids);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  finally { db.close(); }
}

test('rewards use eligible contributions, atomic balances, private orders and final fulfilment states', async t => {
  t.after(cleanup);
  assert.equal((await snapshot(null)).config.local, true, 'Never write fixture data through a deployed Worker.');
  const farmer = actor('farmer'), expert = actor('expert'), other = actor('other'), admin = actor('admin', { moderator: true });
  const unverified = actor('unverified', { verified: false }), demo = actor('demo', { demo: true }), noAccount = actor('no-account', { account: false });

  await t.test('one answer award per question, current votes and accepted answer, visibility reversals', async () => {
    const question = await ask(farmer, 'scoring');
    const first = await answer(expert, question), followup = await answer(expert, question);
    assert.equal((await wallet(expert)).answerPoints, 10, 'Multiple answers to one question cannot farm base points.');
    await community(farmer, { action: 'vote', answerId: first, value: 1 });
    assert.equal((await wallet(expert)).votePoints, 2);
    await community(farmer, { action: 'vote', answerId: first, value: 1 });
    assert.equal((await wallet(expert)).votePoints, 2, 'Repeated upvote is not an additional reward.');
    await community(unverified, { action: 'vote', answerId: first, value: 1 });
    await community(demo, { action: 'vote', answerId: first, value: 1 });
    assert.equal((await wallet(expert)).votePoints, 2, 'Unverified and demo votes do not earn points.');
    await community(farmer, { action: 'selectBest', questionId: question.id, answerId: first });
    await community(farmer, { action: 'selectBest', questionId: question.id, answerId: first });
    assert.equal((await wallet(expert)).earned, 32);
    const alternative = await answer(other, question);
    await community(farmer, { action: 'selectBest', questionId: question.id, answerId: alternative });
    assert.equal((await wallet(expert)).bestAnswerPoints, 0);
    assert.equal((await wallet(other)).bestAnswerPoints, 20);
    await community(farmer, { action: 'vote', answerId: first, value: 0 });
    assert.equal((await wallet(expert)).votePoints, 0);
    await community(farmer, { action: 'vote', answerId: first, value: -1 });
    assert.equal((await wallet(expert)).votePoints, 0, 'Downvotes cannot mint points.');
    const answerReport = await report(farmer, 'answer', first);
    await moderate(admin, answerReport, 'hide');
    assert.equal((await wallet(expert)).answerPoints, 10, 'Another visible answer preserves the one question award.');
    await community(expert, { action: 'deleteAnswer', answerId: followup });
    assert.equal((await wallet(expert)).earned, 0);
    await moderate(admin, answerReport, 'restore');
    assert.equal((await wallet(expert)).answerPoints, 10);
    const questionReport = await report(expert, 'question', question.id);
    await moderate(admin, questionReport, 'hide');
    assert.equal((await wallet(expert)).earned, 0);
    assert.equal((await wallet(other)).earned, 0, 'Hidden questions revoke accepted and answer points.');
    await moderate(admin, questionReport, 'restore');
    assert.equal((await wallet(other)).earned, 30);
    const own = await answer(farmer, question);
    await community(expert, { action: 'vote', answerId: own, value: 1 });
    await community(farmer, { action: 'selectBest', questionId: question.id, answerId: own });
    assert.equal((await wallet(farmer)).earned, 0, 'Self questions do not generate answer, vote or accepted rewards.');
    assert.equal((await wallet(other)).bestAnswerPoints, 0);
    const demoQuestion = await ask(demo, 'demonstration');
    await answer(expert, demoQuestion);
    await answer(demo, question);
    assert.equal((await wallet(expert)).earned, 10, 'Answering demo content earns nothing.');
    assert.equal((await wallet(demo)).earned, 0);
    db.prepare('UPDATE accounts SET email_verified_at=NULL WHERE user_id=?').run(expert.id);
    assert.equal((await wallet(expert)).earned, 0, 'Even local previews require a verified reward recipient.');
    db.prepare('UPDATE accounts SET email_verified_at=? WHERE user_id=?').run(new Date().toISOString(), expert.id);
    db.prepare('UPDATE accounts SET email_verified_at=NULL WHERE user_id=?').run(farmer.id);
    assert.equal((await wallet(expert)).earned, 0, 'Unverified askers cannot create reward-bearing questions.');
    db.prepare('UPDATE accounts SET email_verified_at=? WHERE user_id=?').run(new Date().toISOString(), farmer.id);
    db.prepare('UPDATE users SET xp=99999,base_likes=99999 WHERE id=?').run(expert.id);
    assert.equal((await wallet(expert)).earned, 10, 'Legacy XP and likes are not redeemable currency.');
  });

  const shop = actor('shopper'), contender = actor('contender'), balanceRacer = actor('balance-racer');
  for (let index = 0; index < 6; index++) {
    const question = await ask(farmer, `earning-${index}`);
    await answer(shop, question);
    if (index < 2) { await answer(contender, question); await answer(balanceRacer, question); }
  }
  assert.equal((await wallet(shop)).earned, 60);
  const item = await save(admin, 'field notebook', 10, 4);
  const alternateItem = await save(admin, 'different reward', 10, 3);
  assert.equal(item.revision, 1);

  await t.test('verified real account required, no client price or identity override, demo unavailable', async () => {
    for (const member of [unverified, demo, noAccount]) {
      const state = await snapshot(member);
      assert.equal(state.canRedeem, false);
      await redeem(member, item, { expected: 403 });
    }
    await post(null, { action: 'redeem', rewardId: item.id, expectedPoints: item.points, expectedRevision: item.revision, requestKey: randomUUID() }, 401);
    await post(shop, { action: 'redeem', rewardId: item.id, expectedRevision: item.revision, requestKey: randomUUID() }, 400);
    await post(shop, { action: 'redeem', rewardId: item.id, expectedPoints: item.points, requestKey: randomUUID() }, 400);
    await redeem(shop, item, { expectedPoints: 1.5, expected: 400 });
    await redeem(shop, item, { expectedRevision: 1.5, expected: 400 });
    await redeem(farmer, item, { expected: 409, points: 0, balance: 99999, userId: shop.id });
    assert.equal((await wallet(farmer)).spent, 0);
    const demoReward = (await snapshot(shop)).catalog.find(reward => reward.demo === 1);
    assert.ok(demoReward, 'The migration provides clearly identified non-redeemable demonstration rewards.');
    await redeem(shop, demoReward, { expected: [400, 409] });
    const unavailable = await save(admin, 'unavailable', 10, 1, { active: false });
    await redeem(shop, unavailable, { expected: [404, 409] });
    await post(shop, { action: 'saveReward', name: 'Attempted moderator override', points: 1, totalStock: 100, active: true }, 403);
    for (const viewer of [null, shop, unverified]) await request('/api/rewards?view=admin', viewer, undefined, 403);
    const csrf = await fetch(`${origin}/api/rewards`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie: shop.cookie, origin: 'https://different.example' },
      body: JSON.stringify({ action: 'redeem', rewardId: item.id, expectedPoints: item.points, expectedRevision: item.revision, requestKey: randomUUID() }),
    });
    assert.equal(csrf.status, 403);
  });

  await t.test('idempotent order, server-owned snapshot, private state, cancellation releases once', async () => {
    const first = await redeem(shop, item, { points: 1, userId: farmer.id, note: 'Private delivery instructions for the moderator.' });
    assert.ok(first.id);
    const saved = await order(shop, first.id);
    assert.equal(saved.points, 10, 'Price is taken from the server catalog.');
    assert.equal(saved.user_id, shop.id, 'Identity is taken from the session.');
    assert.equal(saved.item_name, item.name);
    assert.equal(saved.item_kind, 'product');
    assert.equal(saved.reward_revision, item.revision);
    assert.equal(saved.status, 'pending');
    assert.equal(saved.events.length, 1);
    const repeated = await redeem(shop, item, { key: first.key, note: saved.note });
    assert.equal(repeated.id, first.id);
    assert.equal((await wallet(shop)).spent, 10);
    await redeem(shop, item, { key: first.key, note: 'Different delivery details with the same request key.', expected: 409 });
    await redeem(shop, alternateItem, { key: first.key, expected: 409 });
    const repriced = await save(admin, 'renamed field notebook', 25, 4, { id: item.id, kind: 'coupon' });
    assert.equal(repriced.revision, item.revision + 1);
    const beforeStalePrice = await wallet(shop);
    const beforeStaleOrders = db.prepare('SELECT COUNT(*) n FROM reward_orders WHERE user_id=?').get(shop.id).n;
    const stalePrice = await redeem(shop, item, { expected: 409 });
    assert.equal(stalePrice.id, undefined, 'A confirmation for the old catalog price cannot create an order.');
    await redeem(shop, repriced, { expectedPoints: saved.points, expected: 409 });
    assert.deepEqual(await wallet(shop), beforeStalePrice, 'Rejecting an outdated price does not debit points.');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM reward_orders WHERE user_id=?').get(shop.id).n, beforeStaleOrders);
    const historicalRetry = await redeem(shop, item, { key: first.key, expectedPoints: saved.points, expectedRevision: saved.reward_revision, note: saved.note });
    assert.equal(historicalRetry.id, first.id, 'A retry uses the historic order price even after catalog pricing changes.');
    await redeem(shop, item, { key: first.key, expectedPoints: 25, note: saved.note, expected: 409 });
    await redeem(shop, item, { key: first.key, expectedRevision: repriced.revision, note: saved.note, expected: 409 });
    const changedTerms = await save(admin, 'renamed collection coupon', 25, 4, {
      id: item.id, kind: 'coupon', fulfillment: 'The test coupon now requires collection at a different location.',
    });
    assert.equal(changedTerms.revision, repriced.revision + 1);
    const staleTerms = await redeem(shop, repriced, { expected: 409 });
    assert.equal(staleTerms.id, undefined, 'Changed name and fulfilment conditions require new confirmation even at the same price.');
    assert.deepEqual(await wallet(shop), beforeStalePrice);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM reward_orders WHERE user_id=?').get(shop.id).n, beforeStaleOrders);
    const afterChange = await order(shop, first.id);
    assert.equal(afterChange.points, 10);
    assert.equal(afterChange.item_name, item.name);
    assert.equal(afterChange.item_kind, 'product', 'Catalog changes do not rewrite existing orders.');
    for (const viewer of [null, farmer]) {
      const state = await snapshot(viewer, `?userId=${shop.id}`);
      assert.equal(state.orders.length, 0);
      assert.equal(state.activities.length, 0);
      assert.equal(state.admin, undefined);
      assert.doesNotMatch(JSON.stringify(state), /Private delivery instructions/);
      if (!viewer) assert.equal(state.wallet, null);
      else assert.equal(state.wallet.earned, 0);
    }
    const adminState = await snapshot(admin, '?view=admin');
    const queueOrder = adminState.admin.orders.find(value => value.id === first.id);
    assert.equal(queueOrder.contact_email, shop.email);
    assert.equal(queueOrder.note, saved.note);
    await post(farmer, { action: 'cancelOrder', orderId: first.id }, [403, 404]);
    await post(farmer, { action: 'reviewOrder', orderId: first.id, status: 'fulfilled', fulfillmentNote: 'Unauthorized fulfilment.' }, 403);
    await post(shop, { action: 'cancelOrder', orderId: first.id });
    await post(shop, { action: 'cancelOrder', orderId: first.id });
    const cancelled = await order(shop, first.id);
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.events.filter(event => event.status === 'cancelled').length, 1);
    assert.equal((await wallet(shop)).spent, 0);
    assert.equal((await snapshot(shop)).catalog.find(value => value.id === item.id).remaining_stock, 4);
    await post(admin, { action: 'reviewOrder', orderId: first.id, status: 'fulfilled', fulfillmentNote: 'Cannot fulfil a cancelled order.' }, 409);
  });

  await t.test('simultaneous redemptions cannot oversell or overspend', async () => {
    const last = await save(admin, 'last notebook', 10, 1);
    const requests = await Promise.all([redeem(shop, last, { expected: null }), redeem(contender, last, { expected: null })]);
    assert.equal(requests.filter(value => [200, 201].includes(value.status)).length, 1);
    assert.equal(requests.filter(value => value.status === 409).length, 1);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM reward_orders WHERE reward_id=? AND status='pending'").get(last.id).n, 1);
    assert.equal((await snapshot(shop)).catalog.find(value => value.id === last.id).remaining_stock, 0);
    await post(admin, {
      action: 'saveReward', id: last.id, name: last.name, description: last.description,
      kind: last.kind, points: last.points, totalStock: 0, active: true,
      partner: last.partner, fulfillment: last.fulfillment,
    }, 409);
    const expensiveA = await save(admin, 'balance race A', 15, 2), expensiveB = await save(admin, 'balance race B', 15, 2);
    const raced = await Promise.all([redeem(balanceRacer, expensiveA, { expected: null }), redeem(balanceRacer, expensiveB, { expected: null })]);
    assert.equal(raced.filter(value => [200, 201].includes(value.status)).length, 1);
    assert.equal(raced.filter(value => value.status === 409).length, 1);
    assert.equal((await wallet(balanceRacer)).available, 5);
    assert.equal((await wallet(balanceRacer)).spent, 15);
    const concurrentKey = randomUUID();
    const duplicate = await Promise.all([redeem(shop, alternateItem, { key: concurrentKey }), redeem(shop, alternateItem, { key: concurrentKey })]);
    assert.equal(duplicate[0].id, duplicate[1].id);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM reward_orders WHERE user_id=? AND request_key=?').get(shop.id, concurrentKey).n, 1);
  });

  await t.test('fulfil and reject are auditable terminal states; revoked earnings cannot fund new orders', async () => {
    const fulfilled = await redeem(shop, alternateItem);
    await post(admin, { action: 'reviewOrder', orderId: fulfilled.id, status: 'fulfilled', fulfillmentNote: 'Private collection code TEST-LOCAL-ONLY.' });
    await post(admin, { action: 'reviewOrder', orderId: fulfilled.id, status: 'fulfilled', fulfillmentNote: 'Private collection code TEST-LOCAL-ONLY.' });
    const finished = await order(shop, fulfilled.id);
    assert.equal(finished.status, 'fulfilled');
    assert.match(finished.fulfillment_note, /TEST-LOCAL-ONLY/);
    assert.equal(finished.events.filter(event => event.status === 'fulfilled').length, 1);
    await post(shop, { action: 'cancelOrder', orderId: fulfilled.id }, 409);
    await post(admin, { action: 'reviewOrder', orderId: fulfilled.id, status: 'rejected', reason: 'Terminal status cannot change.' }, 409);
    const before = await wallet(shop);
    const rejected = await redeem(shop, alternateItem);
    await post(admin, { action: 'reviewOrder', orderId: rejected.id, status: 'rejected', reason: 'The local test item is unavailable.' });
    await post(admin, { action: 'reviewOrder', orderId: rejected.id, status: 'rejected', reason: 'The local test item is unavailable.' });
    assert.equal((await wallet(shop)).spent, before.spent);
    assert.equal((await order(shop, rejected.id)).status, 'rejected');
    assert.equal((await order(shop, rejected.id)).events.filter(event => event.status === 'rejected').length, 1);
    await post(admin, { action: 'reviewOrder', orderId: rejected.id, status: 'fulfilled', fulfillmentNote: 'Rejected orders cannot be fulfilled.' }, 409);
    await post(shop, { action: 'cancelOrder', orderId: rejected.id }, 409);
    assert.doesNotMatch(JSON.stringify(await snapshot(farmer)), /TEST-LOCAL-ONLY|local test item is unavailable/);
    const reviewerQuestion = await ask(farmer, 'reviewer contribution');
    await answer(admin, reviewerQuestion);
    const reviewerOrder = await redeem(admin, alternateItem);
    await post(admin, { action: 'reviewOrder', orderId: reviewerOrder.id, status: 'fulfilled', fulfillmentNote: 'Cannot approve my own order.' }, 403);
    assert.equal((await order(admin, reviewerOrder.id)).status, 'pending');
    await post(admin, { action: 'cancelOrder', orderId: reviewerOrder.id });
    // Revoke earned contributions after one real debit: the balance must not reset or allow more spending.
    db.prepare('UPDATE answers SET hidden=1 WHERE author_id=?').run(balanceRacer.id);
    const revoked = await wallet(balanceRacer);
    assert.equal(revoked.earned, 0);
    assert.equal(revoked.spent, 15);
    assert.equal(revoked.available, 0);
    assert.equal(revoked.deficit, 15);
    await redeem(balanceRacer, alternateItem, { expected: 409 });
  });
});
