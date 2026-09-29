import { currentUserId, database, isModerator } from "@/db/community";
import { isLocal, registrationOpen, RequestError } from "@/app/lib/runtime";
import type { RewardActivity, RewardEvent, RewardItem, RewardOrder, RewardsSnapshot, RewardWallet } from "@/app/lib/rewards-model";

// Current eligible contributions are reversible; XP and legacy xp_events are independent.
// ponytail: calculate from source rows for MVP; materialize only if measured query cost requires it.
export const rewardPointsSql = `WITH reward_actor AS (SELECT ? AS user_id), eligible_answers AS (
  SELECT a.id, a.author_id, a.question_id, a.created_at, q.slug, q.title, q.selected_answer_id
  FROM answers a JOIN reward_actor r ON r.user_id=a.author_id
  JOIN users recipient ON recipient.id=a.author_id AND recipient.demo=0
  JOIN accounts recipient_account ON recipient_account.user_id=recipient.id AND recipient_account.email_verified_at IS NOT NULL
  JOIN questions q ON q.id=a.question_id AND q.hidden=0 AND q.author_id<>a.author_id
  JOIN users asker ON asker.id=q.author_id AND asker.demo=0
  JOIN accounts asker_account ON asker_account.user_id=asker.id AND asker_account.email_verified_at IS NOT NULL
  WHERE a.hidden=0 AND a.deleted=0
), contributions AS (
  SELECT 'answer-'||a.id AS id, 'answer' AS kind, 10 AS points, a.question_id,
    a.slug AS question_slug, a.title AS question_title, a.id AS answer_id, a.created_at
  FROM eligible_answers a WHERE a.id=(SELECT MIN(first.id) FROM eligible_answers first WHERE first.question_id=a.question_id)
  UNION ALL
  SELECT 'votes-'||a.id, 'vote', COUNT(*)*2, a.question_id, a.slug, a.title, a.id, a.created_at
  FROM eligible_answers a JOIN votes v ON v.answer_id=a.id AND v.value=1 AND v.user_id<>a.author_id
  JOIN users voter ON voter.id=v.user_id AND voter.demo=0
  JOIN accounts voter_account ON voter_account.user_id=voter.id AND voter_account.email_verified_at IS NOT NULL
  GROUP BY a.id
  UNION ALL
  SELECT 'best-'||a.id, 'bestAnswer', 20, a.question_id, a.slug, a.title, a.id, a.created_at
  FROM eligible_answers a WHERE a.selected_answer_id=a.id
), reward_totals AS (
  SELECT COALESCE(SUM(points),0) AS earned,
    COALESCE(SUM(CASE WHEN kind='answer' THEN points ELSE 0 END),0) AS answerPoints,
    COALESCE(SUM(CASE WHEN kind='vote' THEN points ELSE 0 END),0) AS votePoints,
    COALESCE(SUM(CASE WHEN kind='bestAnswer' THEN points ELSE 0 END),0) AS bestAnswerPoints,
    (SELECT COALESCE(SUM(points),0) FROM reward_orders WHERE user_id=(SELECT user_id FROM reward_actor) AND status IN ('pending','fulfilled')) AS spent
  FROM contributions
)`;

const itemColumns = `i.id,i.revision,i.name,i.description,i.kind,i.points,i.total_stock,i.active,i.demo,i.partner,i.fulfillment,i.created_at,i.updated_at,
  MAX(0,i.total_stock-(SELECT COUNT(*) FROM reward_orders o WHERE o.reward_id=i.id AND o.status IN ('pending','fulfilled'))) AS remaining_stock`;
const orderColumns = "o.id,o.user_id,o.reward_id,o.reward_revision,o.item_name,o.item_kind,o.points,o.status,o.note,o.fulfillment_note,o.created_at,o.updated_at,o.reviewed_by";

export async function rewardIdentity(actor: string | null) {
  const account = actor ? await database().prepare("SELECT u.demo,a.email_verified_at FROM users u JOIN accounts a ON a.user_id=u.id WHERE u.id=?")
    .bind(actor).first<{ demo: number; email_verified_at: string | null }>() : null;
  return { emailVerified: Boolean(account?.email_verified_at), canRedeem: Boolean(account && !account.demo && account.email_verified_at) };
}

async function withEvents(orders: Omit<RewardOrder, "events">[]): Promise<RewardOrder[]> {
  if (!orders.length) return [];
  const events = (await database().prepare(`SELECT id,order_id,status,note,created_at FROM reward_order_events WHERE order_id IN (${orders.map(() => "?").join(",")}) ORDER BY created_at,id`)
    .bind(...orders.map(order => order.id)).all<RewardEvent & { order_id: string }>()).results;
  return orders.map(order => ({ ...order, events: events.filter(event => event.order_id === order.id)
    .map(event => ({ id: event.id, status: event.status, note: event.note, created_at: event.created_at })) }));
}

export async function rewardsSnapshot(request: Request): Promise<RewardsSnapshot> {
  const db = database();
  const actor = await currentUserId(request);
  const identity = await rewardIdentity(actor);
  const moderator = await isModerator(actor);
  const adminView = new URL(request.url).searchParams.get("view") === "admin";
  if (adminView && (!moderator || !identity.canRedeem)) throw new RequestError("Verified reviewer access required.", 403);
  const catalog = (await db.prepare(`SELECT ${itemColumns} FROM reward_items i WHERE i.active=1 ORDER BY i.demo,i.points,i.name LIMIT 200`).all<RewardItem>()).results;
  let wallet: RewardWallet | null = null;
  let activities: RewardActivity[] = [];
  let orders: RewardOrder[] = [];
  if (actor) {
    wallet = await db.prepare(`${rewardPointsSql} SELECT *,earned-spent AS balance,MAX(0,earned-spent) AS available,MAX(0,spent-earned) AS deficit FROM reward_totals`)
      .bind(actor).first<RewardWallet>();
    activities = (await db.prepare(`${rewardPointsSql} SELECT * FROM contributions ORDER BY created_at DESC,id DESC LIMIT 100`).bind(actor).all<RewardActivity>()).results;
    orders = await withEvents((await db.prepare(`SELECT ${orderColumns} FROM reward_orders o WHERE o.user_id=? ORDER BY o.created_at DESC,o.id DESC LIMIT 50`).bind(actor).all<Omit<RewardOrder, "events">>()).results);
  }
  const snapshot: RewardsSnapshot = { config: { local: isLocal(), registrationOpen: registrationOpen() }, currentUserId: actor,
    isModerator: moderator, ...identity, wallet, catalog, activities, orders };
  if (adminView) {
    const allCatalog = (await db.prepare(`SELECT ${itemColumns} FROM reward_items i ORDER BY i.active DESC,i.created_at DESC LIMIT 200`).all<RewardItem>()).results;
    const adminOrders = await withEvents((await db.prepare(`SELECT ${orderColumns},u.name AS user_name,
      CASE WHEN a.email_verified_at IS NOT NULL THEN a.email ELSE NULL END AS contact_email
      FROM reward_orders o JOIN users u ON u.id=o.user_id LEFT JOIN accounts a ON a.user_id=o.user_id
      ORDER BY CASE WHEN o.status='pending' THEN 0 ELSE 1 END,o.created_at DESC,o.id DESC LIMIT 100`).all<Omit<RewardOrder, "events">>()).results);
    snapshot.admin = { catalog: allCatalog, orders: adminOrders };
  }
  return snapshot;
}

function stringField(value: unknown, name: string, max: number, required = false) {
  if (value === undefined && !required) return "";
  if (typeof value !== "string" || value.trim().length > max || (required && !value.trim())) throw new RequestError(`Check ${name}.`);
  return value.trim();
}
function idField(value: unknown, name: string) {
  const id = stringField(value, name, 100, true);
  if (!/^[a-zA-Z0-9-]{8,100}$/.test(id)) throw new RequestError(`Check ${name}.`);
  return id;
}
function integerField(value: unknown, name: string, min: number, max = 1000000) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) throw new RequestError(`Check ${name}.`);
  return value;
}
async function ownOrder(id: string, actor: string) {
  const order = await database().prepare(`SELECT ${orderColumns} FROM reward_orders o WHERE o.id=? AND o.user_id=?`).bind(id, actor).first<Omit<RewardOrder, "events">>();
  return order ? (await withEvents([order]))[0] : null;
}

export async function redeemReward(actor: string, body: Record<string, unknown>) {
  const db = database();
  const rewardId = idField(body.rewardId, "reward");
  const expectedPoints = integerField(body.expectedPoints, "confirmed points", 1);
  const expectedRevision = integerField(body.expectedRevision, "confirmed reward version", 1, Number.MAX_SAFE_INTEGER);
  const requestKey = idField(body.requestKey, "request key");
  if (requestKey.length < 16) throw new RequestError("Refresh the form and try again.");
  const note = stringField(body.note, "note (up to 500 characters)", 500);
  const id = crypto.randomUUID();
  // The INSERT checks the confirmed offer, identity, balance and stock in one database statement.
  await db.batch([
    db.prepare(`${rewardPointsSql}
      INSERT INTO reward_orders (id,user_id,reward_id,reward_revision,item_name,item_kind,points,request_key,note)
      SELECT ?,r.user_id,i.id,i.revision,i.name,i.kind,i.points,?,? FROM reward_items i,reward_actor r,reward_totals t
      WHERE i.id=? AND i.points=? AND i.revision=? AND i.active=1 AND i.demo=0 AND t.earned-t.spent>=i.points
        AND EXISTS (SELECT 1 FROM users u JOIN accounts a ON a.user_id=u.id WHERE u.id=r.user_id AND u.demo=0 AND a.email_verified_at IS NOT NULL)
        AND i.total_stock>(SELECT COUNT(*) FROM reward_orders o WHERE o.reward_id=i.id AND o.status IN ('pending','fulfilled'))
      ON CONFLICT(user_id,request_key) DO NOTHING`).bind(actor, id, requestKey, note, rewardId, expectedPoints, expectedRevision),
    db.prepare("INSERT INTO reward_order_events (id,order_id,actor_id,status) SELECT ?,id,user_id,'pending' FROM reward_orders WHERE id=?").bind(crypto.randomUUID(), id),
  ]);
  const existing = await db.prepare("SELECT id,reward_id,reward_revision,note,points FROM reward_orders WHERE user_id=? AND request_key=?").bind(actor, requestKey).first<{ id: string; reward_id: string; reward_revision: number; note: string; points: number }>();
  if (existing) {
    if (existing.reward_id !== rewardId || existing.note !== note || existing.points !== expectedPoints || existing.reward_revision !== expectedRevision) throw new RequestError("This request key was already used for a different redemption. Refresh and try again.", 409);
    return { ok: true, order: await ownOrder(existing.id, actor) };
  }
  const item = await db.prepare("SELECT active,demo,points,revision FROM reward_items WHERE id=?").bind(rewardId).first<{ active: number; demo: number; points: number; revision: number }>();
  if (!item) throw new RequestError("Reward not found.", 404);
  if (item.demo) throw new RequestError("This is a preview example and cannot be redeemed.", 409);
  if (item.points !== expectedPoints) throw new RequestError("The points price has changed. Refresh and confirm the current price.", 409);
  if (item.revision !== expectedRevision) throw new RequestError("This reward has changed. Refresh and confirm its current details.", 409);
  throw new RequestError("This reward is unavailable, sold out, or your available points are too low. Refresh and check your balance.", 409);
}

export async function cancelRewardOrder(actor: string, body: Record<string, unknown>) {
  const id = idField(body.orderId, "order");
  const db = database();
  const results = await db.batch([
    db.prepare("INSERT INTO reward_order_events (id,order_id,actor_id,status) SELECT ?,id,?,'cancelled' FROM reward_orders WHERE id=? AND user_id=? AND status='pending'")
      .bind(crypto.randomUUID(), actor, id, actor),
    db.prepare("UPDATE reward_orders SET status='cancelled',updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=? AND status='pending'").bind(id, actor),
  ]);
  const order = await ownOrder(id, actor);
  if (!order) throw new RequestError("Order not found.", 404);
  if (!results[1].meta.changes && order.status !== "cancelled") throw new RequestError("Only pending orders can be cancelled.", 409);
  return { ok: true, order };
}

export async function saveReward(body: Record<string, unknown>) {
  const db = database();
  const id = body.id === undefined ? crypto.randomUUID() : idField(body.id, "reward");
  const name = stringField(body.name, "reward name", 100, true);
  const description = stringField(body.description, "description", 2000, true);
  const kind = stringField(body.kind, "reward kind", 20, true);
  if (!["product", "coupon", "consultation"].includes(kind)) throw new RequestError("Choose a reward kind.");
  const points = integerField(body.points, "points", 1);
  const stock = integerField(body.totalStock, "total stock", 0);
  if (typeof body.active !== "boolean") throw new RequestError("Choose whether this reward is active.");
  const partner = stringField(body.partner, "partner", 150);
  const fulfillment = stringField(body.fulfillment, "fulfillment instructions", 2000, true);
  if (body.id === undefined) {
    await db.prepare("INSERT INTO reward_items (id,name,description,kind,points,total_stock,active,partner,fulfillment) VALUES (?,?,?,?,?,?,?,?,?)")
      .bind(id, name, description, kind, points, stock, body.active ? 1 : 0, partner, fulfillment).run();
  } else {
    const result = await db.prepare(`UPDATE reward_items SET name=?,description=?,kind=?,points=?,total_stock=?,active=?,partner=?,fulfillment=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND ?>=(SELECT COUNT(*) FROM reward_orders WHERE reward_id=? AND status IN ('pending','fulfilled'))`)
      .bind(name, description, kind, points, stock, body.active ? 1 : 0, partner, fulfillment, id, stock, id).run();
    if (!result.meta.changes) throw new RequestError("Reward not found, or total stock is below reserved and fulfilled orders.", 409);
  }
  const reward = await db.prepare(`SELECT ${itemColumns} FROM reward_items i WHERE i.id=?`).bind(id).first<RewardItem>();
  return { ok: true, reward };
}

export async function reviewRewardOrder(actor: string, body: Record<string, unknown>) {
  const id = idField(body.orderId, "order");
  const status = stringField(body.status, "order status", 20, true);
  if (status !== "fulfilled" && status !== "rejected") throw new RequestError("Choose fulfilled or rejected.");
  const note = stringField(body.fulfillmentNote ?? body.reason, "fulfillment note or rejection reason", 1000, true);
  const db = database();
  const results = await db.batch([
    db.prepare("INSERT INTO reward_order_events (id,order_id,actor_id,status,note) SELECT ?,id,?,?,? FROM reward_orders WHERE id=? AND user_id<>? AND status='pending'")
      .bind(crypto.randomUUID(), actor, status, note, id, actor),
    db.prepare("UPDATE reward_orders SET status=?,fulfillment_note=?,reviewed_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id<>? AND status='pending'")
      .bind(status, note, actor, id, actor),
  ]);
  const order = await db.prepare(`SELECT ${orderColumns} FROM reward_orders o WHERE o.id=?`).bind(id).first<Omit<RewardOrder, "events">>();
  if (!order) throw new RequestError("Order not found.", 404);
  if (order.user_id === actor) throw new RequestError("Another reviewer must process your order.", 403);
  if (!results[1].meta.changes && (order.status !== status || order.fulfillment_note !== note)) throw new RequestError("This order has already been processed. Refresh the queue.", 409);
  return { ok: true, order: (await withEvents([order]))[0] };
}
