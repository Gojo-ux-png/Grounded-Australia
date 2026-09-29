import { uploadsEnabled } from "@/app/lib/media-storage";
import { env } from "cloudflare:workers";
import { scrypt, timingSafeEqual } from "node:crypto";
import { isLocal, RequestError } from "@/app/lib/runtime";

const SESSION_COOKIE = "grounded_session";
const SESSION_SECONDS = 60 * 60 * 24 * 30;
const encoder = new TextEncoder();

function db() {
  if (!env.DB) throw new Error("Community database is unavailable.");
  return env.DB;
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

export async function sha256(value: string) {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

// 16 MiB scrypt, OWASP N=2^14/r=8/p=5; fits the Workers isolate budget.
export async function hashPassword(password: string, salt: string) {
  const result = await new Promise<Buffer>((resolve,reject)=>scrypt(password,salt,32,{N:16384,r:8,p:5,maxmem:32*1024*1024},(error,key)=>error?reject(error):resolve(key)));
  return `scrypt-v1$${result.toString("hex")}`;
}
export function newPasswordSalt() { return randomHex(16); }
export async function passwordMatches(password: string, salt: string, expected: string) {
  let actual: string;
  if (expected.startsWith("scrypt-v1$")) actual = await hashPassword(password,salt);
  else {
    // Legacy MVP hashes remain readable locally. Production starts with a fresh DB.
    if (!isLocal()) return false;
    const key=await crypto.subtle.importKey("raw",encoder.encode(password),"PBKDF2",false,["deriveBits"]);
    actual=bytesToHex(new Uint8Array(await crypto.subtle.deriveBits({name:"PBKDF2",hash:"SHA-256",iterations:150000,salt:encoder.encode(salt)},key,256)));
  }
  const a=encoder.encode(actual),b=encoder.encode(expected);
  return a.length===b.length && timingSafeEqual(a,b);
}

export async function currentUserId(request: Request) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const id = await sha256(token);
  const session = await db().prepare("SELECT user_id FROM sessions WHERE id = ? AND expires_at > ?")
    .bind(id, new Date().toISOString()).first<{ user_id: string }>();
  return session?.user_id ?? null;
}

export async function createSession(userId: string, request: Request, expectedHash: string) {
  const token = randomHex(32);
  const id = await sha256(token);
  const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000).toISOString();
  const result=await db().batch([
    db().prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(new Date().toISOString()),
    db().prepare("INSERT INTO sessions (id,user_id,expires_at) SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM accounts WHERE user_id=? AND password_hash=?)").bind(id,userId,expiresAt,userId,expectedHash),
    db().prepare("DELETE FROM sessions WHERE user_id=? AND id<>? AND id NOT IN (SELECT id FROM sessions WHERE user_id=? AND id<>? ORDER BY created_at DESC,id DESC LIMIT 9)").bind(userId,id,userId,id),
  ]);
  if(!result[1].meta.changes)throw new RequestError("Your credentials changed. Sign in again.",401);
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${SESSION_SECONDS}; SameSite=Lax; HttpOnly${secure}`;
}

export async function revokeSession(request: Request) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (token) await db().prepare("DELETE FROM sessions WHERE id = ?").bind(await sha256(token)).run();
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly${secure}`;
}

const visibleAnswer = "a.hidden = 0 AND a.deleted = 0 AND EXISTS (SELECT 1 FROM questions q WHERE q.id = a.question_id AND q.hidden = 0)";
const publicUser = `u.id,u.handle,u.name,u.initials,u.role,u.verified,u.state,u.town,u.bio,u.specialties,u.years,u.avatar_url,u.categories,u.service_states,u.verified_scope,u.verification_basis,u.verified_at,u.demo,
 (SELECT COUNT(*) FROM user_follows WHERE followed_id=u.id) AS followers,
 (SELECT COUNT(*) FROM user_follows WHERE follower_id=u.id) AS following,
 (SELECT COUNT(*) FROM answers a WHERE a.author_id=u.id AND ${visibleAnswer}) AS answer_count,
 (SELECT COUNT(*) FROM answers a JOIN questions q ON q.selected_answer_id=a.id WHERE a.author_id=u.id AND ${visibleAnswer}) AS best_count,
 (SELECT COUNT(*) FROM votes v JOIN answers a ON a.id=v.answer_id WHERE a.author_id=u.id AND v.value=1 AND ${visibleAnswer}) AS likes,
 ((SELECT COUNT(*)*10 FROM answers a WHERE a.author_id=u.id AND ${visibleAnswer}) +
 (SELECT COUNT(*)*2 FROM votes v JOIN answers a ON a.id=v.answer_id WHERE a.author_id=u.id AND v.value=1 AND ${visibleAnswer}) +
 (SELECT COUNT(*)*20 FROM answers a JOIN questions q ON q.selected_answer_id=a.id WHERE a.author_id=u.id AND q.author_id<>u.id AND ${visibleAnswer})) AS xp`;

export async function isModerator(userId: string | null) {
  return Boolean(userId && await db().prepare("SELECT 1 FROM users WHERE id=? AND moderator=1").bind(userId).first());
}

export async function snapshot(request: Request) {
  const database = db();
  const actor = await currentUserId(request);
  const moderator = await isModerator(actor);
  const params = new URL(request.url).searchParams;
  const mode = params.get("view") || "home";
  const page = Math.max(1, Math.min(100000, Math.floor(Number(params.get("page"))) || 1));
  const query = (params.get("q") || "").trim().toLowerCase().slice(0,180);
  const state = params.get("state") || "";
  const category = params.get("category") || "";
  const includeDemo = isLocal() || env.REGISTRATION_OPEN === "false";
  const where = ["q.hidden=0"];
  if (!includeDemo) where.push("q.author_id IN (SELECT id FROM users WHERE demo=0)");
  const values: unknown[] = [];
  const profile = params.get("handle") ? await database.prepare("SELECT id FROM users WHERE handle=? AND (? OR demo=0)").bind(params.get("handle"),includeDemo?1:0).first<{id:string}>() : null;
  if (mode === "question") { where.push("q.slug=?"); values.push(params.get("slug") || ""); }
  else if (mode === "profile") { where.push("(q.author_id=? OR q.id IN (SELECT question_id FROM answers WHERE author_id=? AND hidden=0 AND deleted=0))"); values.push(profile?.id || "", profile?.id || ""); }
  else if (mode === "me") {
    const tab = params.get("tab") || "questions";
    const clause: Record<string,string> = {
      questions: "q.author_id=?", answers: "q.id IN (SELECT question_id FROM answers WHERE author_id=? AND hidden=0 AND deleted=0)",
      saved: "q.id IN (SELECT question_id FROM bookmarks WHERE user_id=?)", following: "q.id IN (SELECT question_id FROM question_follows WHERE user_id=?)",
      invitations: "q.id IN (SELECT question_id FROM invitations WHERE expert_id=?)"
    };
    where.push(clause[tab] || "q.author_id=?"); values.push(actor || "");
  } else {
    if(params.get("type")==="knowledge") where.push("json_extract(q.context,'$.kind')='knowledge'");
    if(query) { where.push("instr(lower(q.title || ' ' || q.body || ' ' || q.tags || ' ' || q.town || ' ' || q.state),?)>0"); values.push(query); }
    if(state) { where.push("q.state=?"); values.push(state); }
    if(category) { where.push("q.category=?"); values.push(category); }
    if(params.get("status")==="unanswered") where.push("NOT EXISTS (SELECT 1 FROM answers a WHERE a.question_id=q.id AND a.hidden=0 AND a.deleted=0)");
    if(params.get("status")==="expert") where.push("EXISTS (SELECT 1 FROM answers a JOIN users u ON u.id=a.author_id WHERE a.question_id=q.id AND a.hidden=0 AND a.deleted=0 AND u.verified=1 AND u.demo=0 AND u.verified_scope=q.category)");
  }
  const filter = where.join(" AND ");
  const count = await database.prepare(`SELECT COUNT(*) total FROM questions q WHERE ${filter}`).bind(...values).first<{total:number}>();
  const ordering = params.get("sort")==="answered" ? "answer_count DESC,q.created_at DESC" : params.get("sort")==="popular" ? "q.views DESC,q.created_at DESC" : "q.created_at DESC,q.id DESC";
  const questionRows = rows(await database.prepare(`SELECT q.*,u.demo,
    (SELECT COUNT(*) FROM answers a WHERE a.question_id=q.id AND a.hidden=0 AND a.deleted=0) AS answer_count,
    (SELECT COUNT(*) FROM question_follows WHERE question_id=q.id) AS follow_count
    FROM questions q JOIN users u ON u.id=q.author_id WHERE ${filter} ORDER BY ${ordering} LIMIT 12 OFFSET ?`).bind(...values,(page-1)*12).all());
  const ids = questionRows.map(q => q.id);
  const slots = ids.map(()=>"?").join(",") || "NULL";
  const requestedAnswerPage=Math.max(1,Math.min(100000,Math.floor(Number(params.get("answerPage")))||1));
  const historyAuthor=mode==="profile"?profile?.id:mode==="me"&&params.get("tab")==="answers"?actor:null;
  const answerValues=historyAuthor?[...ids,historyAuthor]:ids;
  const answerCte=`WITH scored AS (SELECT a.*,COALESCE((SELECT SUM(value) FROM votes WHERE answer_id=a.id),0) AS score,
    (SELECT COUNT(*) FROM comments WHERE answer_id=a.id AND hidden=0) AS comment_count
    FROM answers a WHERE a.question_id IN (${slots}) AND a.hidden=0 AND a.deleted=0 ${historyAuthor?"AND a.author_id=?":""}),
    ranked AS (SELECT scored.*,ROW_NUMBER() OVER (PARTITION BY question_id ORDER BY (id=(SELECT selected_answer_id FROM questions WHERE id=scored.question_id)) DESC,score DESC,id) AS rn FROM scored)`;
  const target=params.get("answer") && mode==="question" ? await database.prepare(`${answerCte} SELECT rn FROM ranked WHERE id=?`).bind(...answerValues,Number(params.get("answer"))||0).first<{rn:number}>() : null;
  const answerPage=target?Math.ceil(target.rn/20):requestedAnswerPage;
  const answerRows=rows(await database.prepare(`${answerCte} SELECT * FROM ranked WHERE ${mode==="question"?"(rn BETWEEN ? AND ?) OR rn<=2":(historyAuthor?"rn<=20":"rn<=2")} ORDER BY question_id,rn`).bind(...answerValues,...(mode==="question"?[(answerPage-1)*20+1,answerPage*20]:[])).all());
  const answerPageIds=answerRows.filter(a=>Number(a.rn)>(answerPage-1)*20 && Number(a.rn)<=answerPage*20).map(a=>a.id);
  const answerIds = answerRows.map(a=>a.id);
  const answerSlots = "SELECT value FROM json_each(?)";
  const commentAnswer=Number(params.get("commentAnswer"))||0,commentPage=Math.max(1,Math.min(100000,Math.floor(Number(params.get("commentPage")))||1));
  const commentRows=mode==="question"?rows(await database.prepare(`WITH ranked AS (SELECT c.*,ROW_NUMBER() OVER(PARTITION BY answer_id ORDER BY id) rn FROM comments c WHERE c.answer_id IN (${answerSlots}) AND c.hidden=0) SELECT * FROM ranked WHERE (answer_id=? AND rn BETWEEN ? AND ?) OR (answer_id<>? AND rn<=20)`).bind(JSON.stringify(answerIds),commentAnswer,(commentPage-1)*20+1,commentPage*20,commentAnswer).all()):[];
  const personWhere = [includeDemo?"1=1":"u.demo=0"]; const personValues: unknown[] = [];
  if(query) { personWhere.push("instr(lower(u.name || ' ' || u.handle || ' ' || u.bio || ' ' || u.specialties || ' ' || u.town || ' ' || u.state),?)>0"); personValues.push(query); }
  if(state) { personWhere.push("(u.state=? OR EXISTS (SELECT 1 FROM json_each(u.service_states) WHERE value=?))"); personValues.push(state,state); }
  if(category) { personWhere.push(params.get("type")==="experts" ? "u.verified_scope=?" : "EXISTS (SELECT 1 FROM json_each(u.categories) WHERE value=?)"); personValues.push(category); }
  if(mode==="question") { personWhere.push("u.verified=1 AND u.demo=0 AND u.verified_scope=?"); personValues.push(questionRows[0]?.category || ""); }
  if(params.get("type")==="experts") personWhere.push("u.verified=1 AND u.demo=0");
  const directoryMode=mode==="search" && ["experts","people"].includes(params.get("type") || "") || mode==="leaderboard";
  const directoryCount=await database.prepare(`SELECT COUNT(*) total FROM users u WHERE ${personWhere.join(" AND ")}`).bind(...personValues).first<{total:number}>();
  const directorySort=mode==="question" ? "CASE WHEN u.state=? OR EXISTS (SELECT 1 FROM json_each(u.service_states) WHERE value=?) THEN 0 ELSE 1 END, xp DESC,u.name" : "xp DESC,u.name";
  const directoryBindings=mode==="question" ? [...personValues,questionRows[0]?.state || "",questionRows[0]?.state || ""] : personValues;
  const directory = rows(await database.prepare(`SELECT ${publicUser} FROM users u WHERE ${personWhere.join(" AND ")} ORDER BY ${directorySort} LIMIT 24 OFFSET ?`).bind(...directoryBindings,directoryMode?(page-1)*24:0).all());
  const references = [...new Set([actor,profile?.id,...questionRows.map(q=>q.author_id),...answerRows.map(a=>a.author_id),...commentRows.map(c=>c.author_id)].filter(Boolean))];
  const referenceUsers = rows(await database.prepare(`SELECT ${publicUser} FROM users u WHERE u.id IN (SELECT value FROM json_each(?)) OR u.id IN (SELECT followed_id FROM user_follows WHERE follower_id=?)`).bind(JSON.stringify(references),actor || "").all());
  const users = [...new Map([...directory,...referenceUsers].map(u=>[u.id,u])).values()].map(u=>({...u, verified:u.demo ? 0:u.verified, categories:JSON.parse(String(u.categories)),service_states:JSON.parse(String(u.service_states))}));
  const privateQueries = actor ? await database.batch<Record<string,unknown>>([
    database.prepare("SELECT answer_id,value FROM votes WHERE user_id=? AND answer_id IN (SELECT value FROM json_each(?))").bind(actor,JSON.stringify(answerIds)),
    database.prepare("SELECT question_id FROM bookmarks WHERE user_id=? AND question_id IN (SELECT value FROM json_each(?))").bind(actor,JSON.stringify(ids)),
    database.prepare("SELECT question_id FROM question_follows WHERE user_id=? AND question_id IN (SELECT value FROM json_each(?))").bind(actor,JSON.stringify(ids)),
    database.prepare("SELECT followed_id FROM user_follows WHERE follower_id=?").bind(actor),
    database.prepare("SELECT i.*,q.slug,q.title FROM invitations i JOIN questions q ON q.id=i.question_id WHERE (i.inviter_id=? OR i.expert_id=?) AND q.hidden=0 ORDER BY i.id DESC LIMIT 100").bind(actor,actor),
    database.prepare("SELECT id,message,href,created_at,read_at FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 100").bind(actor),
    database.prepare("SELECT * FROM expert_applications WHERE user_id=?").bind(actor),
    database.prepare("SELECT id,target_type,target_id,reason,status,resolution,created_at FROM reports WHERE reporter_id=? ORDER BY id DESC LIMIT 100").bind(actor),
  ]) : [];
  let reports: Record<string,unknown>[] = [], applications: Record<string,unknown>[] = [], logs: Record<string,unknown>[] = [];
  if(moderator && mode==="moderation") {
    const result=await database.batch<Record<string,unknown>>([
      database.prepare(`SELECT r.*,CASE r.target_type WHEN 'question' THEN (SELECT title || char(10) || body FROM questions WHERE id=r.target_id) WHEN 'answer' THEN (SELECT body FROM answers WHERE id=r.target_id) ELSE (SELECT body FROM comments WHERE id=r.target_id) END AS content,CASE r.target_type WHEN 'question' THEN (SELECT hidden FROM questions WHERE id=r.target_id) WHEN 'answer' THEN (SELECT hidden FROM answers WHERE id=r.target_id) ELSE (SELECT hidden FROM comments WHERE id=r.target_id) END AS hidden FROM reports r ORDER BY CASE WHEN status='pending' THEN 0 ELSE 1 END,r.id DESC LIMIT 100`),
      database.prepare("SELECT * FROM expert_applications ORDER BY CASE WHEN status='pending' THEN 0 ELSE 1 END,created_at DESC LIMIT 100"),
      database.prepare("SELECT * FROM moderation_log ORDER BY id DESC LIMIT 100")
    ]); reports=rows(result[0]); applications=rows(result[1]); logs=rows(result[2]);
  }
  const revisions=mode==="question"?rows(await database.prepare(`WITH ranked AS (SELECT id,answer_id,content,created_at,ROW_NUMBER() OVER(PARTITION BY answer_id ORDER BY id DESC) rn FROM answer_revisions WHERE answer_id IN (${answerSlots})) SELECT * FROM ranked WHERE rn<=10`).bind(JSON.stringify(answerIds)).all()).map(r=>({...r,content:JSON.parse(String(r.content))})):[];
  const privateRows = (index:number) => privateQueries[index] ? rows(privateQueries[index]) : [];
  const account=actor ? await database.prepare("SELECT email_verified_at FROM accounts WHERE user_id=?").bind(actor).first() : null;
  return {config:{turnstileSiteKey:isLocal()?"":env.TURNSTILE_SITE_KEY,local:isLocal(),uploadsEnabled:uploadsEnabled(env),registrationOpen:env.REGISTRATION_OPEN==="true",emailEnabled:(isLocal()&&env.REGISTRATION_OPEN==="true")||Boolean(env.EMAIL && env.EMAIL_FROM)},emailVerified:Boolean(account?.email_verified_at),currentUserId:actor,isModerator:moderator,users,peopleIds:directory.map(u=>u.id),questions:questionRows.map(q=>({...q,tags:JSON.parse(String(q.tags)),context:JSON.parse(String(q.context))})),answers:answerRows,comments:commentRows,
    answerPage,answerPages:Math.ceil(Number(questionRows[0]?.answer_count || 0)/20),answerPageIds,commentAnswer,commentPage,votes:privateRows(0),bookmarks:privateRows(1),follows:privateRows(2),userFollows:privateRows(3).map(r=>r.followed_id),invitations:privateRows(4),notifications:privateRows(5),application:privateRows(6)[0] || null,ownReports:privateRows(7),reports,applications,moderationLog:logs,revisions,total:directoryMode ? directoryCount?.total || 0 : count?.total || 0,page,pages:Math.ceil((directoryMode ? directoryCount?.total || 0 : count?.total || 0)/(directoryMode?24:12))};
}

export function database() {
  return db();
}
