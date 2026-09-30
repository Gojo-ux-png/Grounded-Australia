import { uploadsEnabled } from "@/app/lib/media-storage";
import { env } from "cloudflare:workers";
import { accountAction, requireVerified, sendAccountLink } from "@/db/account-security";
import { failure, limit, RequestError, verifyChallenge, registrationOpen } from "@/app/lib/runtime";
import { createSession, currentUserId, database, isModerator, hashPassword, newPasswordSalt, passwordMatches, revokeSession, snapshot } from "@/db/community";

import { categories as CATEGORIES, states as STATES, relationships } from "@/app/lib/community-model";
import { challengeRequired } from "@/app/lib/auth-policy";
import { readLimited, sameOrigin } from "@/app/lib/server-input";


function clean(value: unknown, max = 5000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function numeric(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function httpsUrl(value: unknown, allowMedia = false) {
  const url = clean(value, 1000);
  if (!url) return null;
  if (allowMedia && url.startsWith("/api/media/")) return url;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function slugify(title: string) {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 58) || "field-question";
  return `${base}-${Date.now().toString(36)}`;
}

function accountHandle(name: string) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 28) || "member";
  return `${base}-${crypto.randomUUID().slice(0, 6)}`;
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function error(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export async function GET(request: Request) {
  try {
    return Response.json(await snapshot(request), { headers: { "Cache-Control": "private, no-store" } });
  } catch (cause) {
    return failure(cause,"community_read");
  }
}

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return error("This request must come from Grounded.", 403);
    if (!request.headers.get("content-type")?.includes("application/json")) return error("Use a JSON request.", 415);
    const body = JSON.parse(new TextDecoder().decode(await readLimited(request, 24000))) as Record<string, unknown>;
    if (!body || typeof body!=="object" || Array.isArray(body)) return error("Use a JSON object.");
    const action = clean(body.action, 40);
    if(action==="signUp" && !registrationOpen())return error("Registration is not open during this preview. Please check back soon.",403);
    if(["requestReset","requestVerification"].includes(action) && !env.EMAIL)return error("Account email is not enabled during this preview.",503);
    const ip=request.headers.get("cf-connecting-ip") || "local";
    if(["signIn","signUp","requestReset","resetPassword","verifyEmail"].includes(action)) {
      await limit(env.AUTH_LIMITER,`ip:${ip}`);
      if(body.email)await limit(env.AUTH_LIMITER,`email:${clean(body.email,180).toLowerCase()}`);
      if(["signIn","signUp","requestReset"].includes(action) && challengeRequired(action,env.TURNSTILE_SITE_KEY))await verifyChallenge(request,body.challenge,action);
    }
    const accountResponse=await accountAction(request,body,action);
    if(accountResponse)return accountResponse;
    const db = database();

    if (action === "signUp") {
      const name = clean(body.name, 80);
      const email = clean(body.email, 180).toLowerCase();
      const password = typeof body.password === "string" ? body.password : "";
      const state = clean(body.state, 3);
      const town = clean(body.town, 80);
      if (name.length < 2) return error("Enter your full name.");
      if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email)) return error("Enter a valid email address.");
      if (password.length < 10 || password.length > 128) return error("Use a password between 10 and 128 characters.");
      if (!STATES.includes(state) || !town) return error("Choose a valid state and nearest town.");
      if (await db.prepare("SELECT 1 FROM accounts WHERE email = ?").bind(email).first()) return error("An account already exists for this email.", 409);
      const userId = `user-${crypto.randomUUID()}`;
      const handle = accountHandle(name);
      const salt = newPasswordSalt();
      const passwordHash = await hashPassword(password, salt);
      await db.batch([
        db.prepare("INSERT INTO users (id,handle,name,initials,role,verified,state,town,bio,specialties) VALUES (?,?,?,?,?,?,?,?,?,?)")
          .bind(userId, handle, name, initials(name), "Farmer", 0, state, town, "", ""),
        db.prepare("INSERT INTO accounts (user_id,email,password_hash,password_salt) VALUES (?,?,?,?)")
          .bind(userId, email, passwordHash, salt),
      ]);
      let verificationSent=true;
      try { await sendAccountLink(userId,email,"verify"); } catch { verificationSent=false; }
      const response = Response.json({ ok: true, handle, verificationSent }, { status: 201 });
      response.headers.append("Set-Cookie", await createSession(userId, request, passwordHash));
      return response;
    }

    if (action === "signIn") {
      const email = clean(body.email, 180).toLowerCase();
      const password = typeof body.password === "string" ? body.password : "";
      if(password.length > 128) return error("Email or password is incorrect.", 401);
      const account = await db.prepare("SELECT user_id,password_hash,password_salt FROM accounts WHERE email = ?").bind(email)
        .first<{ user_id: string; password_hash: string; password_salt: string }>();
      if (!account || !(await passwordMatches(password, account.password_salt, account.password_hash))) return error("Email or password is incorrect.", 401);
      let acceptedHash=account.password_hash;
      if(!account.password_hash.startsWith("scrypt-v1$")) {
        acceptedHash=await hashPassword(password,account.password_salt);
        await db.prepare("UPDATE accounts SET password_hash=? WHERE user_id=? AND password_hash=?").bind(acceptedHash,account.user_id,account.password_hash).run();
      }
      const user = await db.prepare("SELECT handle FROM users WHERE id = ?").bind(account.user_id).first<{ handle: string }>();
      const response = Response.json({ ok: true, handle: user?.handle });
      response.headers.append("Set-Cookie", await createSession(account.user_id, request, acceptedHash));
      return response;
    }

    if (action === "signOut") {
      const response = Response.json({ ok: true });
      response.headers.append("Set-Cookie", await revokeSession(request));
      response.headers.append("Set-Cookie", "demo_user_id=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly");
      return response;
    }

    if (action === "view") {
      await limit(env.WRITE_LIMITER,`view:${ip}`);
      const questionId = numeric(body.questionId);
      await db.prepare("UPDATE questions SET views=views+1 WHERE id=? AND hidden=0").bind(questionId).run();
      return Response.json({ ok: true });
    }
    const actor = await currentUserId(request);
    if (!actor) return error("Sign in to take part.", 401);
    await limit(env.WRITE_LIMITER,`member:${actor}`);
    if(["ask","editQuestion","answer","comment","inviteExpert","applyExpert","updateProfile"].includes(action))await requireVerified(actor);
    const moderator = await isModerator(actor);
    const questionById = (id: number) => db.prepare("SELECT * FROM questions WHERE id=? AND hidden=0").bind(id).first<Record<string,unknown>>();
    const answerById = (id: number) => db.prepare("SELECT a.* FROM answers a JOIN questions q ON q.id=a.question_id WHERE a.id=? AND a.hidden=0 AND a.deleted=0 AND q.hidden=0").bind(id).first<Record<string,unknown>>();
    const notice = (userId: unknown, message: string, href: string, key: string) => db.prepare("INSERT OR IGNORE INTO notifications (user_id,message,href,event_key) SELECT ?,?,?,? WHERE ?<>?").bind(userId,message,href,key,userId,actor);
    const ownedMedia = (value: unknown) => {
      const url=clean(value,1000);
      if (!url) return null;
      if (!uploadsEnabled(env)) throw new RequestError("Photo uploads are not enabled yet. You can still publish your text.",503);
      if (!url.startsWith(`/api/media/${actor}/`) || url.includes("..") || !/^\/api\/media\/[a-zA-Z0-9-]+\/[a-zA-Z0-9-]+\.(png|jpg|webp)$/.test(url)) throw new RequestError("Use an image uploaded from your account.");
      return url;
    };
    const requestKey = clean(body.requestKey,100);
    if (["ask","answer","comment"].includes(action) && !/^[a-zA-Z0-9-]{16,100}$/.test(requestKey)) return error("Refresh the form and try again.");
    const contextFields = ["subject","stage","started","extent","conditions","tried"];
    const fieldContext = Object.fromEntries(contextFields.map(key=>[key,clean((body.context as Record<string,unknown> | undefined)?.[key],500)]));

    if(action === "updateProfile") {
      const name=clean(body.name,80), state=clean(body.state,3), town=clean(body.town,80), years=Number(body.years);
      const role=clean(body.role,40);
      if(name.length<2 || !STATES.includes(state) || !town || !Number.isInteger(years) || years<0 || years>90 || !["Farmer","Agricultural professional","Enthusiast","Brand representative"].includes(role)) return error("Check your name, role, location and years of experience.");
      const fields=Array.isArray(body.categories) ? body.categories.filter(v=>typeof v==="string" && CATEGORIES.includes(v)) : [];
      const regions=Array.isArray(body.serviceStates) ? body.serviceStates.filter(v=>typeof v==="string" && STATES.includes(v)) : [];
      const avatar=body.avatarUrl === undefined ? (await db.prepare("SELECT avatar_url FROM users WHERE id=?").bind(actor).first<{avatar_url:string|null}>())?.avatar_url ?? null : ownedMedia(body.avatarUrl);
      await db.prepare("UPDATE users SET name=?,initials=?,role=?,state=?,town=?,years=?,bio=?,specialties=?,categories=?,service_states=?,avatar_url=? WHERE id=?")
        .bind(name,initials(name),role,state,town,years,clean(body.bio,1500),clean(body.specialties,300),JSON.stringify([...new Set(fields)]),JSON.stringify([...new Set(regions)]),avatar,actor).run();
      return Response.json({ok:true});
    }
    if(action === "followUser") {
      const target=clean(body.userId,100);
      if(target===actor || !await db.prepare("SELECT 1 FROM users WHERE id=?").bind(target).first()) return error("Choose another community member.");
      if(body.active===true) await db.prepare("INSERT OR IGNORE INTO user_follows (follower_id,followed_id) VALUES (?,?)").bind(actor,target).run();
      else await db.prepare("DELETE FROM user_follows WHERE follower_id=? AND followed_id=?").bind(actor,target).run();
      return Response.json({ok:true});
    }
    if(action === "readNotice") {
      await db.prepare("UPDATE notifications SET read_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?").bind(numeric(body.id),actor).run();
      return Response.json({ok:true});
    }
    if(action === "applyExpert") {
      const scope=clean(body.scope,100), evidence=clean(body.evidence,3000);
      if(!CATEGORIES.includes(scope) || evidence.length<40) return error("Choose your professional field and provide your experience, organization and a public credential/reference link.");
      const existing=await db.prepare("SELECT status FROM expert_applications WHERE user_id=?").bind(actor).first<{status:string}>();
      if(existing?.status==="pending" || existing?.status==="approved") return error("Your existing application is pending or approved.",409);
      await db.prepare("INSERT INTO expert_applications (user_id,scope,evidence) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET scope=excluded.scope,evidence=excluded.evidence,status='pending',review_note='',created_at=CURRENT_TIMESTAMP,reviewed_at=NULL").bind(actor,scope,evidence).run();
      return Response.json({ok:true});
    }
    if(action === "reviewExpert") {
      if(!moderator) return error("Reviewer access required.",403);
      const userId=clean(body.userId,100), decision=clean(body.decision,20), reason=clean(body.reason,500);
      if(!["approved","rejected","revoked"].includes(decision) || reason.length<10) return error("Choose a decision and add a public verification basis or review reason.");
      const application=await db.prepare("SELECT * FROM expert_applications WHERE user_id=?").bind(userId).first<{status:string;scope:string}>();
      if(!application || (decision!=="revoked" && application.status!=="pending") || (decision==="revoked" && application.status!=="approved")) return error("This application has already changed. Refresh the queue.",409);
      if(userId===actor) return error("Another reviewer must review your application.",403);
      const expected=application.status;
      const reviewed=await db.batch([
        db.prepare("UPDATE users SET verified=?,verified_scope=?,verification_basis=?,verified_at=? WHERE id=? AND EXISTS (SELECT 1 FROM expert_applications WHERE user_id=? AND status=?)")
          .bind(decision==="approved"?1:0,decision==="approved"?application.scope:"",decision==="approved"?reason:"",decision==="approved"?new Date().toISOString():null,userId,userId,expected),
        db.prepare("INSERT OR IGNORE INTO notifications (user_id,message,href,event_key) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM expert_applications WHERE user_id=? AND status=?)").bind(userId,`Your expert application was ${decision}: ${reason}`,"/me?tab=profile",`verification-${userId}-${crypto.randomUUID()}`,userId,expected),
        db.prepare("INSERT INTO moderation_log (moderator_id,action,target_type,target_id,reason) SELECT ?,?,'expert',?,? WHERE EXISTS (SELECT 1 FROM expert_applications WHERE user_id=? AND status=?)").bind(actor,decision,userId,reason,userId,expected),
        db.prepare("UPDATE expert_applications SET status=?,review_note=?,reviewed_at=CURRENT_TIMESTAMP WHERE user_id=? AND status=?").bind(decision,reason,userId,expected),
      ]);
      if(!reviewed.at(-1)?.meta.changes) return error("This application has already changed. Refresh the queue.",409);
      return Response.json({ok:true});
    }
    if(action === "ask" || action === "editQuestion") {
      if(body.kind === "knowledge" && !moderator) return error("Administrator access required to publish knowledge.",403);
      const title=clean(body.title,160), description=clean(body.body,5000), category=clean(body.category,30), state=clean(body.state,3), town=clean(body.town,80);
      if(title.length<12 || description.length<30 || !CATEGORIES.includes(category) || !STATES.includes(state) || !town) return error("Add a clear title, field detail, category and location.");
      const tags=[...new Set(clean(body.tags,180).split(",").map(t=>t.trim().toLowerCase()).filter(Boolean))].slice(0,5);
      const videoUrl=httpsUrl(body.videoUrl); if(clean(body.videoUrl) && !videoUrl) return error("Video links must use HTTPS.");
      if(action === "editQuestion") {
        const question=await questionById(numeric(body.questionId));
        if(!question || (question.author_id!==actor && !moderator)) return error("You can only edit your own question.",403);
        const previousContext=JSON.parse(String(question.context));
        if(previousContext.kind === "knowledge") {
          if(!moderator) return error("Administrator access required to edit knowledge.",403);
          fieldContext.kind="knowledge";
          const suppliedCaption=(body.context as Record<string,unknown> | undefined)?.imageCaption;
          fieldContext.imageCaption=clean(suppliedCaption===undefined?previousContext.imageCaption:suppliedCaption,300);
        }
        const imageUrl=body.imageUrl===undefined ? question.image_url : ownedMedia(body.imageUrl);
        await db.batch([
          db.prepare("UPDATE questions SET title=?,body=?,category=?,state=?,town=?,tags=?,context=?,video_url=?,image_url=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
            .bind(title,description,category,state,town,JSON.stringify(tags),JSON.stringify(fieldContext),videoUrl,imageUrl,question.id),
          db.prepare("INSERT INTO moderation_log (moderator_id,action,target_type,target_id,reason) SELECT ?,'edit','question',?,? WHERE ?=1")
            .bind(actor,String(question.id),JSON.stringify({title:question.title,body:question.body}),moderator?1:0),
        ]);
        return Response.json({ok:true,slug:question.slug});
      }
      if(body.kind === "knowledge") {
        fieldContext.kind="knowledge";
        fieldContext.imageCaption=clean((body.context as Record<string,unknown> | undefined)?.imageCaption,300);
      }
      const slug=slugify(title);
      await db.prepare("INSERT OR IGNORE INTO questions (slug,author_id,title,body,category,tags,state,town,image_url,video_url,context,request_key) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind(slug,actor,title,description,category,JSON.stringify(tags),state,town,ownedMedia(body.imageUrl),videoUrl,JSON.stringify(fieldContext),requestKey).run();
      const saved=await db.prepare("SELECT slug FROM questions WHERE request_key=? AND author_id=?").bind(requestKey,actor).first<{slug:string}>();
      if(!saved) return error("Please start a new question.",409);
      return Response.json({ok:true,slug:saved.slug},{status:201});
    }
    if(action === "answer" || action === "editAnswer") {
      const previous=action==="editAnswer" ? await answerById(numeric(body.answerId)) : null;
      if(action==="editAnswer" && (!previous || previous.author_id!==actor)) return error("You can only edit your own answer.",403);
      const question=await questionById(Number(previous?.question_id || numeric(body.questionId)));
      if(!question) return error("Question not found.",404);
      const content=clean(body.body,5000); if(content.length<20) return error("Add more practical detail to your answer.");
      const citationUrl=httpsUrl(body.citationUrl), videoUrl=httpsUrl(body.videoUrl);
      if((clean(body.citationUrl) && !citationUrl) || (clean(body.videoUrl) && !videoUrl)) return error("References and video links must use HTTPS.");
      const relationship=clean(body.relationship,20) || "none";
      if(!Object.hasOwn(relationships,relationship)) return error("Choose a product relationship.");
      const commercial=["gifted","paid","employee"].includes(relationship) ? 1 : 0;
      const product=clean(body.productName,100) || null;
      if(commercial && !product) return error("Name the product or partner for a commercial relationship.");
      const imageUrl=body.imageUrl===undefined && previous ? previous.image_url : ownedMedia(body.imageUrl);
      const href=`/questions/${question.slug}`;
      if(previous) {
        const revision={body:previous.body,citation_url:previous.citation_url,product_name:previous.product_name,commercial:previous.commercial,relationship:previous.relationship,image_url:previous.image_url,video_url:previous.video_url};
        await db.batch([
          db.prepare("INSERT INTO answer_revisions (answer_id,content) VALUES (?,?)").bind(previous.id,JSON.stringify(revision)),
          db.prepare("UPDATE answers SET body=?,citation_url=?,product_name=?,commercial=?,relationship=?,image_url=?,video_url=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND author_id=?").bind(content,citationUrl,product,commercial,relationship,imageUrl,videoUrl,previous.id,actor),
          ...(question.selected_answer_id===previous.id ? [notice(question.author_id,"Your accepted answer was edited. Review the changes.",href,`revision-${crypto.randomUUID()}`)] : []),
        ]);
        return Response.json({ok:true});
      }
      await db.prepare("INSERT OR IGNORE INTO answers (question_id,author_id,body,citation_url,product_name,commercial,relationship,image_url,video_url,request_key) VALUES (?,?,?,?,?,?,?,?,?,?)")
        .bind(question.id,actor,content,citationUrl,product,commercial,relationship,imageUrl,videoUrl,requestKey).run();
      const saved=await db.prepare("SELECT id FROM answers WHERE request_key=? AND author_id=? AND question_id=?").bind(requestKey,actor,question.id).first<{id:number}>();
      if(!saved) return error("Please start a new answer.",409);
      const answerId=saved.id;
      await db.batch([
        db.prepare("INSERT OR IGNORE INTO xp_events (user_id,kind,related_id,points) SELECT ?,'answer',?,10 WHERE NOT EXISTS (SELECT 1 FROM xp_events WHERE user_id=? AND kind='answer' AND related_id=?)").bind(actor,answerId,actor,answerId),
        db.prepare("UPDATE invitations SET status='answered' WHERE question_id=? AND expert_id=?").bind(question.id,actor),
        db.prepare("INSERT OR IGNORE INTO notifications (user_id,message,href,event_key) SELECT user_id,?,?,? FROM (SELECT author_id AS user_id FROM questions WHERE id=? UNION SELECT user_id FROM question_follows WHERE question_id=?) WHERE user_id<>?")
          .bind(`New answer: ${question.title}`,href,`answer-${answerId}`,question.id,question.id,actor),
      ]);
      return Response.json({ok:true,answerId},{status:201});
    }
    if(action === "vote") {
      const answer=await answerById(numeric(body.answerId)); const value=Number(body.value);
      if(!answer) return error("Answer not found.",404);
      if(answer.author_id===actor) return error("You cannot vote on your own answer.");
      if(![1,-1,0].includes(value)) return error("Invalid vote.");
      if(value===0) await db.prepare("DELETE FROM votes WHERE user_id=? AND answer_id=?").bind(actor,answer.id).run();
      else await db.prepare("INSERT INTO votes (user_id,answer_id,value) VALUES (?,?,?) ON CONFLICT(user_id,answer_id) DO UPDATE SET value=excluded.value").bind(actor,answer.id,value).run();
      return Response.json({ok:true});
    }
    if(action === "comment") {
      const answer=await answerById(numeric(body.answerId)); const content=clean(body.body,600);
      if(!answer) return error("Answer not found.",404);
      if(content.length<2) return error("Write a comment first.");
      const question=await questionById(Number(answer.question_id));
      await db.prepare("INSERT OR IGNORE INTO comments (answer_id,author_id,body,request_key) VALUES (?,?,?,?)").bind(answer.id,actor,content,requestKey).run();
      const saved=await db.prepare("SELECT id FROM comments WHERE request_key=? AND author_id=? AND answer_id=?").bind(requestKey,actor,answer.id).first<{id:number}>();
      if(!saved) return error("Please start a new comment.",409);
      await db.batch([...new Set([answer.author_id,question?.author_id])].filter(Boolean).map(id=>notice(id,`New comment: ${question?.title}`,`/questions/${question?.slug}`,`comment-${saved.id}`)));
      return Response.json({ok:true},{status:201});
    }
    if(action === "setBookmark" || action === "setFollow") {
      const question=await questionById(numeric(body.questionId)); if(!question) return error("Question not found.",404);
      const table=action==="setBookmark" ? "bookmarks":"question_follows";
      if(body.active===true) await db.prepare(`INSERT OR IGNORE INTO ${table} (user_id,question_id) VALUES (?,?)`).bind(actor,question.id).run();
      else await db.prepare(`DELETE FROM ${table} WHERE user_id=? AND question_id=?`).bind(actor,question.id).run();
      return Response.json({ok:true});
    }
    if(action === "selectBest") {
      const question=await questionById(numeric(body.questionId));
      const answer=await answerById(numeric(body.answerId));
      if(!question || !answer || answer.question_id!==question.id) return error("Question or answer not found.",404);
      if(question.author_id!==actor) return error("Only the question author can choose the best answer.",403);
      if(question.selected_answer_id===answer.id) return Response.json({ok:true});
      await db.batch([
        db.prepare("UPDATE questions SET selected_answer_id=? WHERE id=? AND author_id=?").bind(answer.id,question.id,actor),
        db.prepare("DELETE FROM xp_events WHERE kind='best_answer' AND related_id=?").bind(question.id),
        db.prepare("INSERT INTO xp_events (user_id,kind,related_id,points) SELECT ?,'best_answer',?,20 WHERE ?<>?").bind(answer.author_id,question.id,answer.author_id,actor),
        notice(answer.author_id,`Your answer was accepted: ${question.title}`,`/questions/${question.slug}`,`accepted-${answer.id}`),
      ]);
      return Response.json({ok:true});
    }
    if(action === "fieldOutcome") {
      const question=await questionById(numeric(body.questionId));
      if(!question || question.author_id!==actor) return error("Only the question author can record a field result.",403);
      const outcome=clean(body.outcome,20), note=clean(body.note,2000);
      if(!["trying","improved","unchanged","resolved"].includes(outcome) || note.length<20) return error("Choose a result and describe what you tried and observed.");
      await db.prepare("UPDATE questions SET outcome=?,outcome_note=?,outcome_at=CURRENT_TIMESTAMP WHERE id=? AND author_id=?").bind(outcome,note,question.id,actor).run();
      return Response.json({ok:true});
    }
    if(action === "inviteExpert") {
      const question=await questionById(numeric(body.questionId)); const expertId=clean(body.expertId,100);
      if(!question) return error("Question not found.",404);
      const expert=await db.prepare("SELECT verified,verified_scope,demo FROM users WHERE id=?").bind(expertId).first<{verified:number;verified_scope:string;demo:number}>();
      if(!expert?.verified || expert.demo || expertId===actor) return error("Choose another verified expert.");
      if(expert.verified_scope!==question.category) return error("Choose an expert verified in this field.");
      const key=`invite-${question.id}-${actor}-${expertId}`;
      await db.batch([
        db.prepare("INSERT INTO invitations (question_id,inviter_id,expert_id) SELECT ?,?,? WHERE NOT EXISTS (SELECT 1 FROM invitations WHERE question_id=? AND inviter_id=? AND expert_id=?)").bind(question.id,actor,expertId,question.id,actor,expertId),
        notice(expertId,`You have been invited to answer: ${question.title}`,`/questions/${question.slug}`,key),
      ]);
      return Response.json({ok:true});
    }
    if(action === "invitationStatus") {
      const status=clean(body.status,20); if(!["read","declined"].includes(status)) return error("Invalid invitation status.");
      await db.prepare("UPDATE invitations SET status=? WHERE id=? AND expert_id=? AND status IN ('pending','read')").bind(status,numeric(body.id),actor).run();
      return Response.json({ok:true});
    }
    if(action === "report") {
      const type=clean(body.targetType,20), id=numeric(body.targetId), reason=clean(body.reason,300);
      if(!["question","answer","comment"].includes(type) || !id || reason.length<4) return error("Select the content and explain your concern.");
      const target=type==="question" ? await questionById(id) : type==="answer" ? await answerById(id) : await db.prepare("SELECT c.id FROM comments c JOIN answers a ON a.id=c.answer_id JOIN questions q ON q.id=a.question_id WHERE c.id=? AND c.hidden=0 AND a.hidden=0 AND a.deleted=0 AND q.hidden=0").bind(id).first();
      if(!target) return error("Content not found.",404);
      await db.prepare("INSERT INTO reports (reporter_id,target_type,target_id,reason) SELECT ?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM reports WHERE reporter_id=? AND target_type=? AND target_id=? AND status='pending')").bind(actor,type,id,reason,actor,type,id).run();
      return Response.json({ok:true},{status:201});
    }
    if(action === "moderate") {
      if(!moderator) return error("Reviewer access required.",403);
      const report=await db.prepare("SELECT * FROM reports WHERE id=?").bind(numeric(body.reportId)).first<Record<string,unknown>>();
      const decision=clean(body.decision,20), reason=clean(body.reason,500);
      if(!report || !["hide","restore","dismiss"].includes(decision) || reason.length<4) return error("Choose a report, decision and reason.");
      const table=({question:"questions",answer:"answers",comment:"comments"} as Record<string,string>)[String(report.target_type)];
      if(!table) return error("Unknown content type.");
      const commands = [db.prepare("UPDATE reports SET status=?,resolution=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=?").bind(decision==="hide"?"removed":decision==="restore"?"restored":"dismissed",reason,report.id),
        db.prepare("INSERT INTO moderation_log (moderator_id,action,target_type,target_id,reason) VALUES (?,?,?,?,?)").bind(actor,decision,report.target_type,String(report.target_id),reason),
        notice(report.reporter_id,`Your report was reviewed: ${reason}`,"/me?tab=reports",`report-${report.id}-${crypto.randomUUID()}`)];
      if(decision!=="dismiss") commands.push(db.prepare(`UPDATE ${table} SET hidden=? WHERE id=?`).bind(decision==="hide"?1:0,report.target_id));
      await db.batch(commands);
      return Response.json({ok:true});
    }
    if(action === "deleteAnswer") {
      const answer=await answerById(numeric(body.answerId)); if(!answer || answer.author_id!==actor) return error("You can only delete your own answer.",403);
      await db.batch([
        db.prepare("DELETE FROM xp_events WHERE kind='best_answer' AND related_id=? AND EXISTS (SELECT 1 FROM questions WHERE id=? AND selected_answer_id=?)").bind(answer.question_id,answer.question_id,answer.id),
        db.prepare("UPDATE questions SET selected_answer_id=NULL WHERE selected_answer_id=?").bind(answer.id),
        db.prepare("UPDATE answers SET deleted=1 WHERE id=? AND author_id=?").bind(answer.id,actor),
        db.prepare("DELETE FROM xp_events WHERE kind='answer' AND related_id=? AND user_id=?").bind(answer.id,actor),
      ]);
      return Response.json({ok:true});
    }
    return error("Unknown action.");
  } catch(cause) { return failure(cause,"community_write"); }
}
