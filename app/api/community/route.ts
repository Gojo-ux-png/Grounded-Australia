import { database, DEMO_USERS, ensureCommunityDatabase, parseDemoUser, snapshot } from "@/db/community";

const CATEGORIES = ["Crops", "Livestock", "Soil", "Water", "Technology", "Business"];
const STATES = ["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"];

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

function error(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export async function GET(request: Request) {
  try {
    return Response.json(await snapshot(request));
  } catch (cause) {
    console.error(cause);
    return error("The community data could not be loaded.", 500);
  }
}

export async function POST(request: Request) {
  try {
    await ensureCommunityDatabase();
    const body = await request.json() as Record<string, unknown>;
    const action = clean(body.action, 40);
    const db = database();

    if (action === "setIdentity") {
      const userId = clean(body.userId, 40);
      if (userId && !DEMO_USERS.includes(userId as (typeof DEMO_USERS)[number])) return error("Unknown demo account.");
      const response = Response.json({ ok: true, userId: userId || null });
      response.headers.append("Set-Cookie", userId
        ? `demo_user_id=${userId}; Path=/; Max-Age=604800; SameSite=Lax; HttpOnly`
        : "demo_user_id=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly");
      return response;
    }

    if (action === "view") {
      const questionId = numeric(body.questionId);
      if (!questionId) return error("Unknown question.");
      await db.prepare("UPDATE questions SET views = views + 1 WHERE id = ?").bind(questionId).run();
      return Response.json({ ok: true });
    }

    const actor = parseDemoUser(request);
    if (!actor) return error("Choose a demo identity to take part.", 401);

    if (action === "ask") {
      const title = clean(body.title, 160);
      const description = clean(body.body, 5000);
      const category = clean(body.category, 30);
      const state = clean(body.state, 3);
      const town = clean(body.town, 80);
      if (title.length < 12) return error("Use at least 12 characters in the question title.");
      if (description.length < 30) return error("Add a little more field detail so people can help.");
      if (!CATEGORIES.includes(category) || !STATES.includes(state) || !town) return error("Choose a valid category and location.");
      const tags = clean(body.tags, 180).split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean).slice(0, 5);
      const videoInput = clean(body.videoUrl, 1000);
      const videoUrl = httpsUrl(videoInput);
      if (videoInput && !videoUrl) return error("Video links must use HTTPS.");
      const imageUrl = httpsUrl(body.imageUrl, true);
      const slug = slugify(title);
      await db.prepare("INSERT INTO questions (slug,author_id,title,body,category,tags,state,town,image_url,video_url) VALUES (?,?,?,?,?,?,?,?,?,?)")
        .bind(slug, actor, title, description, category, JSON.stringify(tags), state, town, imageUrl, videoUrl).run();
      return Response.json({ ok: true, slug }, { status: 201 });
    }

    if (action === "answer") {
      const questionId = numeric(body.questionId);
      const content = clean(body.body, 5000);
      if (content.length < 20) return error("Add a little more practical detail to your answer.");
      const exists = await db.prepare("SELECT id FROM questions WHERE id = ?").bind(questionId).first();
      if (!exists) return error("Question not found.", 404);
      const citationInput = clean(body.citationUrl, 1000);
      const citationUrl = httpsUrl(citationInput);
      if (citationInput && !citationUrl) return error("References must use an HTTPS link.");
      const imageUrl = httpsUrl(body.imageUrl, true);
      const result = await db.prepare("INSERT INTO answers (question_id,author_id,body,citation_url,product_name,commercial,image_url) VALUES (?,?,?,?,?,?,?)")
        .bind(questionId, actor, content, citationUrl, clean(body.productName, 100) || null, body.commercial ? 1 : 0, imageUrl).run();
      const answerId = Number(result.meta.last_row_id);
      await db.batch([
        db.prepare("UPDATE users SET xp = xp + 10 WHERE id = ?").bind(actor),
        db.prepare("INSERT INTO xp_events (user_id,kind,related_id,points) VALUES (?,?,?,10)").bind(actor, "answer", answerId),
      ]);
      return Response.json({ ok: true, answerId }, { status: 201 });
    }

    if (action === "vote") {
      const answerId = numeric(body.answerId);
      const next = Number(body.value);
      if (![1, -1, 0].includes(next)) return error("Invalid vote.");
      const answer = await db.prepare("SELECT author_id FROM answers WHERE id = ?").bind(answerId).first<{ author_id: string }>();
      if (!answer) return error("Answer not found.", 404);
      if (answer.author_id === actor) return error("You cannot vote on your own answer.");
      const previous = await db.prepare("SELECT value FROM votes WHERE user_id = ? AND answer_id = ?").bind(actor, answerId).first<{ value: number }>();
      const oldValue = previous?.value ?? 0;
      if (oldValue === next) return Response.json({ ok: true });
      const statements = [db.prepare("DELETE FROM votes WHERE user_id = ? AND answer_id = ?").bind(actor, answerId)];
      if (next) statements.push(db.prepare("INSERT INTO votes (user_id,answer_id,value) VALUES (?,?,?)").bind(actor, answerId, next));
      const xpDelta = (next === 1 ? 2 : 0) - (oldValue === 1 ? 2 : 0);
      if (xpDelta) statements.push(db.prepare("UPDATE users SET xp = MAX(0, xp + ?) WHERE id = ?").bind(xpDelta, answer.author_id));
      await db.batch(statements);
      return Response.json({ ok: true });
    }

    if (action === "comment") {
      const answerId = numeric(body.answerId);
      const content = clean(body.body, 600);
      if (content.length < 2) return error("Write a comment first.");
      const answer = await db.prepare("SELECT id FROM answers WHERE id = ?").bind(answerId).first();
      if (!answer) return error("Answer not found.", 404);
      await db.prepare("INSERT INTO comments (answer_id,author_id,body) VALUES (?,?,?)").bind(answerId, actor, content).run();
      return Response.json({ ok: true }, { status: 201 });
    }

    if (action === "toggleBookmark" || action === "toggleFollow") {
      const questionId = numeric(body.questionId);
      const table = action === "toggleBookmark" ? "bookmarks" : "question_follows";
      const exists = await db.prepare(`SELECT 1 AS present FROM ${table} WHERE user_id = ? AND question_id = ?`).bind(actor, questionId).first();
      await (exists
        ? db.prepare(`DELETE FROM ${table} WHERE user_id = ? AND question_id = ?`).bind(actor, questionId)
        : db.prepare(`INSERT INTO ${table} (user_id,question_id) VALUES (?,?)`).bind(actor, questionId)).run();
      return Response.json({ ok: true, active: !exists });
    }

    if (action === "selectBest") {
      const questionId = numeric(body.questionId);
      const answerId = numeric(body.answerId);
      const question = await db.prepare("SELECT author_id, selected_answer_id FROM questions WHERE id = ?").bind(questionId).first<{ author_id: string; selected_answer_id: number | null }>();
      const answer = await db.prepare("SELECT author_id FROM answers WHERE id = ? AND question_id = ?").bind(answerId, questionId).first<{ author_id: string }>();
      if (!question || !answer) return error("Question or answer not found.", 404);
      if (question.author_id !== actor) return error("Only the question author can choose the best answer.", 403);
      if (question.selected_answer_id === answerId) return Response.json({ ok: true });
      const statements = [db.prepare("UPDATE questions SET selected_answer_id = ? WHERE id = ?").bind(answerId, questionId)];
      if (question.selected_answer_id) {
        const old = await db.prepare("SELECT author_id FROM answers WHERE id = ?").bind(question.selected_answer_id).first<{ author_id: string }>();
        if (old) statements.push(db.prepare("UPDATE users SET xp = MAX(0, xp - 20) WHERE id = ?").bind(old.author_id));
        statements.push(db.prepare("DELETE FROM xp_events WHERE kind = 'best_answer' AND related_id = ?").bind(questionId));
      }
      statements.push(db.prepare("UPDATE users SET xp = xp + 20 WHERE id = ?").bind(answer.author_id));
      statements.push(db.prepare("INSERT INTO xp_events (user_id,kind,related_id,points) VALUES (?,?,?,20)").bind(answer.author_id, "best_answer", questionId));
      await db.batch(statements);
      return Response.json({ ok: true });
    }

    if (action === "inviteExpert") {
      const questionId = numeric(body.questionId);
      const expertId = clean(body.expertId, 40);
      const expert = await db.prepare("SELECT verified FROM users WHERE id = ?").bind(expertId).first<{ verified: number }>();
      if (!expert?.verified) return error("Choose a verified expert.");
      await db.prepare("INSERT OR IGNORE INTO invitations (question_id,inviter_id,expert_id) VALUES (?,?,?)").bind(questionId, actor, expertId).run();
      return Response.json({ ok: true });
    }

    if (action === "report") {
      const targetType = clean(body.targetType, 20);
      const targetId = numeric(body.targetId);
      const reason = clean(body.reason, 300);
      if (!["question", "answer"].includes(targetType) || !targetId || reason.length < 4) return error("Add a short reason for the report.");
      await db.prepare("INSERT INTO reports (reporter_id,target_type,target_id,reason) VALUES (?,?,?,?)").bind(actor, targetType, targetId, reason).run();
      return Response.json({ ok: true }, { status: 201 });
    }

    if (action === "editAnswer") {
      const answerId = numeric(body.answerId);
      const content = clean(body.body, 5000);
      if (content.length < 20) return error("The edited answer is too short.");
      const result = await db.prepare("UPDATE answers SET body = ? WHERE id = ? AND author_id = ?").bind(content, answerId, actor).run();
      if (!result.meta.changes) return error("You can only edit your own answer.", 403);
      return Response.json({ ok: true });
    }

    if (action === "deleteAnswer") {
      const answerId = numeric(body.answerId);
      const answer = await db.prepare("SELECT author_id, question_id FROM answers WHERE id = ?").bind(answerId).first<{ author_id: string; question_id: number }>();
      if (!answer || answer.author_id !== actor) return error("You can only delete your own answer.", 403);
      const upvotes = await db.prepare("SELECT COUNT(*) AS count FROM votes WHERE answer_id = ? AND value = 1").bind(answerId).first<{ count: number }>();
      const question = await db.prepare("SELECT selected_answer_id FROM questions WHERE id = ?").bind(answer.question_id).first<{ selected_answer_id: number | null }>();
      const xpDelta = 10 + Number(upvotes?.count ?? 0) * 2 + (question?.selected_answer_id === answerId ? 20 : 0);
      await db.batch([
        db.prepare("UPDATE questions SET selected_answer_id = NULL WHERE selected_answer_id = ?").bind(answerId),
        db.prepare("DELETE FROM comments WHERE answer_id = ?").bind(answerId),
        db.prepare("DELETE FROM votes WHERE answer_id = ?").bind(answerId),
        db.prepare("DELETE FROM xp_events WHERE related_id = ? AND kind = 'answer'").bind(answerId),
        db.prepare("DELETE FROM xp_events WHERE related_id = ? AND kind = 'best_answer'").bind(answer.question_id),
        db.prepare("DELETE FROM answers WHERE id = ?").bind(answerId),
        db.prepare("UPDATE users SET xp = MAX(0, xp - ?) WHERE id = ?").bind(xpDelta, actor),
      ]);
      return Response.json({ ok: true });
    }

    if (action === "editQuestion") {
      const questionId = numeric(body.questionId);
      const title = clean(body.title, 160);
      const description = clean(body.body, 5000);
      if (title.length < 12 || description.length < 30) return error("Keep a clear title and enough field detail.");
      const result = await db.prepare("UPDATE questions SET title = ?, body = ? WHERE id = ? AND author_id = ?").bind(title, description, questionId, actor).run();
      if (!result.meta.changes) return error("You can only edit your own question.", 403);
      return Response.json({ ok: true });
    }

    return error("Unknown action.");
  } catch (cause) {
    console.error(cause);
    return error("That action could not be completed.", 500);
  }
}
