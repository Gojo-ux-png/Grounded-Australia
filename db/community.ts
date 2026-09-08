import { env } from "cloudflare:workers";

const SESSION_COOKIE = "grounded_session";
const SESSION_SECONDS = 60 * 60 * 24 * 30;
const encoder = new TextEncoder();

function db() {
  if (!env.DB) throw new Error("Community database is unavailable.");
  return env.DB;
}

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, handle TEXT NOT NULL UNIQUE, name TEXT NOT NULL, initials TEXT NOT NULL, role TEXT NOT NULL, verified INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL, town TEXT NOT NULL, bio TEXT NOT NULL, specialties TEXT NOT NULL, years INTEGER NOT NULL DEFAULT 0, xp INTEGER NOT NULL DEFAULT 0, followers INTEGER NOT NULL DEFAULT 0, following INTEGER NOT NULL DEFAULT 0, base_likes INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS accounts (user_id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, password_salt TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS questions (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, author_id TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, category TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]', state TEXT NOT NULL, town TEXT NOT NULL, image_url TEXT, video_url TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, views INTEGER NOT NULL DEFAULT 0, selected_answer_id INTEGER)`,
  `CREATE TABLE IF NOT EXISTS answers (id INTEGER PRIMARY KEY AUTOINCREMENT, question_id INTEGER NOT NULL, author_id TEXT NOT NULL, body TEXT NOT NULL, citation_url TEXT, product_name TEXT, commercial INTEGER NOT NULL DEFAULT 0, image_url TEXT, base_score INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS comments (id INTEGER PRIMARY KEY AUTOINCREMENT, answer_id INTEGER NOT NULL, author_id TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS votes (user_id TEXT NOT NULL, answer_id INTEGER NOT NULL, value INTEGER NOT NULL CHECK(value IN (-1, 1)), PRIMARY KEY(user_id, answer_id))`,
  `CREATE TABLE IF NOT EXISTS bookmarks (user_id TEXT NOT NULL, question_id INTEGER NOT NULL, PRIMARY KEY(user_id, question_id))`,
  `CREATE TABLE IF NOT EXISTS question_follows (user_id TEXT NOT NULL, question_id INTEGER NOT NULL, PRIMARY KEY(user_id, question_id))`,
  `CREATE TABLE IF NOT EXISTS invitations (id INTEGER PRIMARY KEY AUTOINCREMENT, question_id INTEGER NOT NULL, inviter_id TEXT NOT NULL, expert_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(question_id, inviter_id, expert_id))`,
  `CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, reporter_id TEXT NOT NULL, target_type TEXT NOT NULL, target_id INTEGER NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS xp_events (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, kind TEXT NOT NULL, related_id INTEGER NOT NULL, points INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, kind, related_id))`,
  `CREATE INDEX IF NOT EXISTS questions_created_idx ON questions(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS answers_question_idx ON answers(question_id)`,
  `CREATE INDEX IF NOT EXISTS comments_answer_idx ON comments(answer_id)`,
  `CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id)`,
  `CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at)`,
];

const seedStatements = [
  `INSERT OR IGNORE INTO users VALUES ('farmer-ella','ella-murray','Ella Murray','EM','Farmer',0,'VIC','Shepparton','Third-generation orchardist learning to adapt a mixed pear and apple block to hotter summers.','Orchards, irrigation, farm succession',8,38,146,62,84)`,
  `INSERT OR IGNORE INTO users VALUES ('grower-tom','tom-brennan','Tom Brennan','TB','Experienced Contributor',0,'NSW','Dubbo','Mixed farmer. I share what has worked, what has failed, and the numbers in between.','Soil health, winter cereals, machinery',17,186,391,118,628)`,
  `INSERT OR IGNORE INTO users VALUES ('expert-priya','dr-priya-nair','Dr Priya Nair','PN','Expert',1,'QLD','Toowoomba','Independent agronomist working across the Darling Downs and northern New South Wales.','Plant pathology, pulses, integrated pest management',14,428,812,204,1384)`,
  `INSERT OR IGNORE INTO users VALUES ('farmer-jack','jack-wilson','Jack Wilson','JW','Experienced Contributor',0,'TAS','Smithton','Dairy farmer focused on pasture utilisation and practical herd health.','Dairy, pasture, animal health',21,244,510,177,911)`,
  `INSERT OR IGNORE INTO users VALUES ('expert-mei','mei-chen','Mei Chen','MC','Expert',1,'SA','Murray Bridge','Soil scientist helping dryland growers make better decisions with less guesswork.','Soil chemistry, salinity, nutrient management',12,365,730,193,1192)`,
  `INSERT OR IGNORE INTO questions (id,slug,author_id,title,body,category,tags,state,town,image_url,created_at,views,selected_answer_id) VALUES (1,'yellowing-wheat-after-wet-july','farmer-ella','Why is my wheat yellowing after a wet July — nitrogen loss or root disease?','The lower leaves are paling first across a 22-hectare paddock. We had 118 mm in July on a heavy clay loam, followed by two cold weeks. The crop is Scepter at GS30. Urea went out pre-sowing at 80 kg/ha. The yellowing is worse in shallow depressions but there are no obvious lesions on the crown. I can get a tissue test next week — what would you check first, and is a late nitrogen pass still worth considering?','Crops','["wheat","nitrogen","waterlogging"]','VIC','Horsham','https://images.unsplash.com/photo-1500937386664-56d1dfef3854?auto=format&fit=crop&w=1600&q=84','2026-09-03 06:25:00',1248,1)`,
  `INSERT OR IGNORE INTO questions (id,slug,author_id,title,body,category,tags,state,town,image_url,created_at,views,selected_answer_id) VALUES (2,'calf-scours-after-paddock-change','farmer-jack','Calves developed scours after moving paddocks — where should I start?','Six of 42 calves are loose and two are dull, 48 hours after moving onto the river flat. They are 5–7 weeks old and still with their dams. Water trough was cleaned before the move. I have isolated the dull calves and called our vet. What observations or samples will be most useful before they arrive?','Livestock','["calves","scours","biosecurity"]','TAS','Smithton','https://images.unsplash.com/photo-1652439830186-2246dcd2442c?auto=format&fit=crop&w=1600&q=84','2026-09-05 02:40:00',684,NULL)`,
  `INSERT OR IGNORE INTO questions (id,slug,author_id,title,body,category,tags,state,town,created_at,views,selected_answer_id) VALUES (3,'saline-patch-expanding-barley','grower-tom','A saline patch is expanding through my barley — what can I learn before summer?','The bare area has roughly doubled in three seasons and sits below a long slope. EC readings are patchy. I want to use this season to map the problem properly before deciding on drainage or a pasture phase.','Soil','["salinity","barley","soil-testing"]','SA','Murray Bridge','2026-09-04 23:10:00',391,3)`,
  `INSERT OR IGNORE INTO questions (id,slug,author_id,title,body,category,tags,state,town,created_at,views,selected_answer_id) VALUES (4,'low-cost-frost-monitoring-orchard','farmer-ella','What is a reliable low-cost frost monitoring setup for a small orchard?','I need alerts that still work when mobile reception drops out. The block has power at the pump shed but not at the low point where frost settles. Interested in setups people have actually run for more than one winter.','Technology','["frost","sensors","orchard"]','VIC','Shepparton','2026-09-01 21:15:00',219,NULL)`,
  `INSERT OR IGNORE INTO questions (id,slug,author_id,title,body,category,tags,state,town,created_at,views,selected_answer_id) VALUES (5,'cover-crop-before-summer-sorghum','grower-tom','Which cover crop mix leaves enough water for summer sorghum?','Looking for experiences from the Liverpool Plains after a wet finish. Biomass is useful, but stored moisture is the priority.','Crops','["cover-crops","sorghum","moisture"]','NSW','Gunnedah','2026-08-29 03:20:00',512,NULL)`,
  `INSERT OR IGNORE INTO answers (id,question_id,author_id,body,citation_url,base_score,created_at) VALUES (1,1,'expert-priya','The paddock pattern points first to transient waterlogging and nitrogen movement, but do not rule out crown disease from appearance alone. Dig plants from the yellow edge and a healthy area, wash the roots, and compare root volume and crown colour. Send paired plant and 0–30 cm soil samples so the lab result has a useful control. At GS30, a modest nitrogen correction can still protect tiller survival if the root system is active. I would wait for two drying days, then use a small strip to compare 25–35 kg N/ha before treating the whole paddock. Avoid traffic through the depressions while the clay is plastic.','https://www.agriculture.gov.au/agriculture-land/farm-food-drought/crops/wheat',46,'2026-09-03 09:45:00')`,
  `INSERT OR IGNORE INTO answers (id,question_id,author_id,body,base_score,created_at) VALUES (2,1,'grower-tom','We saw almost the same thing west of Dubbo in 2022. The useful check was spade depth: plants in the pale runs had half the root mass. A blanket urea pass looked tempting but the response was poor in the wettest strips. We mapped those separately and only treated the shoulders once they carried the spreader cleanly.',18,'2026-09-03 11:12:00')`,
  `INSERT OR IGNORE INTO answers (id,question_id,author_id,body,base_score,created_at) VALUES (3,3,'expert-mei','Map the surface expression now, then sample by landscape position rather than on a square grid. Pair EC with chloride, pH and texture, and record depth to any perched water after rain. That will tell you whether you are seeing salt accumulation, sodicity, or both. A summer EM survey is useful only after those ground-truth samples exist.',33,'2026-09-05 01:30:00')`,
  `INSERT OR IGNORE INTO answers (id,question_id,author_id,body,base_score,created_at) VALUES (4,2,'expert-priya','Keep the vet visit as the priority. Before they arrive, record rectal temperature, hydration, nursing behaviour and exactly which mobs and pens each calf has used. Fresh faecal samples from untreated calves are more useful than samples after medication. Use separate boots and feeding gear for the isolated pair.',27,'2026-09-05 04:05:00')`,
  `INSERT OR IGNORE INTO comments (id,answer_id,author_id,body,created_at) VALUES (1,1,'farmer-ella','This is exactly the sequence I needed. I can split the samples by the low runs and shoulders tomorrow.','2026-09-03 10:20:00')`,
  `INSERT OR IGNORE INTO comments (id,answer_id,author_id,body,created_at) VALUES (2,3,'grower-tom','Good point on landscape position. Our first grid blurred the seep line completely.','2026-09-05 03:11:00')`,
];

let ready: Promise<void> | null = null;

export function ensureCommunityDatabase() {
  ready ??= (async () => {
    const database = db();
    await database.batch(schemaStatements.map((statement) => database.prepare(statement)));
    await database.batch(seedStatements.map((statement) => database.prepare(statement)));
  })();
  return ready;
}

function rows<T>(result: D1Result<T>) {
  return result.results ?? [];
}

function cookieValue(request: Request, name: string) {
  const cookie = request.headers.get("cookie") ?? "";
  return cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) || null;
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomHex(length: number) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

async function sha256(value: string) {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

export async function hashPassword(password: string, salt: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", iterations: 150_000, salt: encoder.encode(salt) }, key, 256);
  return bytesToHex(new Uint8Array(bits));
}

export function newPasswordSalt() {
  return randomHex(16);
}

export async function passwordMatches(password: string, salt: string, expected: string) {
  const actual = await hashPassword(password, salt);
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  return difference === 0;
}

export async function currentUserId(request: Request) {
  await ensureCommunityDatabase();
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return null;
  const id = await sha256(token);
  const session = await db().prepare("SELECT user_id FROM sessions WHERE id = ? AND expires_at > ?")
    .bind(id, new Date().toISOString()).first<{ user_id: string }>();
  return session?.user_id ?? null;
}

export async function createSession(userId: string, request: Request) {
  const token = randomHex(32);
  const id = await sha256(token);
  const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000).toISOString();
  await db().batch([
    db().prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(new Date().toISOString()),
    db().prepare("INSERT INTO sessions (id,user_id,expires_at) VALUES (?,?,?)").bind(id, userId, expiresAt),
  ]);
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${SESSION_SECONDS}; SameSite=Lax; HttpOnly${secure}`;
}

export async function revokeSession(request: Request) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (token) await db().prepare("DELETE FROM sessions WHERE id = ?").bind(await sha256(token)).run();
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly${secure}`;
}

export async function snapshot(request: Request) {
  await ensureCommunityDatabase();
  const database = db();
  const [userRows, questionRows, answerRows, commentRows, voteRows, bookmarkRows, followRows, invitationRows] = await database.batch([
    database.prepare("SELECT * FROM users ORDER BY xp DESC"),
    database.prepare("SELECT * FROM questions ORDER BY datetime(created_at) DESC"),
    database.prepare("SELECT * FROM answers ORDER BY datetime(created_at) ASC"),
    database.prepare("SELECT * FROM comments ORDER BY datetime(created_at) ASC"),
    database.prepare("SELECT * FROM votes"),
    database.prepare("SELECT * FROM bookmarks"),
    database.prepare("SELECT * FROM question_follows"),
    database.prepare("SELECT * FROM invitations"),
  ]);

  return {
    currentUserId: await currentUserId(request),
    users: rows(userRows),
    questions: rows(questionRows).map((question: Record<string, unknown>) => ({
      ...question,
      tags: JSON.parse(String(question.tags ?? "[]")),
    })),
    answers: rows(answerRows),
    comments: rows(commentRows),
    votes: rows(voteRows),
    bookmarks: rows(bookmarkRows),
    follows: rows(followRows),
    invitations: rows(invitationRows),
  };
}

export function database() {
  return db();
}
