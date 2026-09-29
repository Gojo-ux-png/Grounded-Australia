import { env } from "cloudflare:workers";
import { EmailMessage } from "cloudflare:email";
import { currentUserId, database, hashPassword, newPasswordSalt, passwordMatches, revokeSession, sha256 } from "./community";
import { isLocal, limit, RequestError, siteUrl } from "@/app/lib/runtime";

export async function requireVerified(userId: string) {
  if (!isLocal() && !await database().prepare("SELECT 1 FROM accounts WHERE user_id=? AND email_verified_at IS NOT NULL").bind(userId).first()) throw new RequestError("Verify your email from My community before posting or uploading.", 403);
}

export async function sendAccountLink(userId: string, email: string, purpose: "verify" | "reset") {
  if (isLocal()) return; // Local tests inject hashed tokens; never send or log real mail.
  if (!env.EMAIL || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(env.EMAIL_FROM)) throw new RequestError("Account email is temporarily unavailable.", 503);
  const db=database(),token=crypto.randomUUID()+crypto.randomUUID();
  const id=await sha256(token),expires=new Date(Date.now()+30*60*1000).toISOString();
  const inserted=await db.prepare("INSERT INTO account_tokens (id,user_id,purpose,expires_at) SELECT ?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM account_tokens WHERE user_id=? AND purpose=? AND expires_at>?)")
    .bind(id,userId,purpose,expires,userId,purpose,new Date(Date.now()+29*60*1000).toISOString()).run();
  if(!inserted.meta.changes)return;
  const url=`${siteUrl()}/auth?mode=${purpose}#token=${encodeURIComponent(token)}`;
  const subject=purpose==="verify"?"Verify your Grounded Australia email":"Reset your Grounded Australia password";
  const text=`${subject}\r\n\r\nOpen this link within 30 minutes:\r\n${url}\r\n\r\nIf you did not request this, you can ignore this email.\r\n`;
  const raw=`From: Grounded Australia <${env.EMAIL_FROM}>\r\nTo: ${email}\r\nSubject: ${subject}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${text}`;
  try { await env.EMAIL.send(new EmailMessage(env.EMAIL_FROM,email,raw)); }
  catch { await db.prepare("DELETE FROM account_tokens WHERE id=?").bind(id).run(); throw new RequestError("Account email is temporarily unavailable. Please try again shortly.",503); }
}

export async function accountAction(request: Request, body: Record<string,unknown>, action: string): Promise<Response | null> {
  const db=database();
  if(action==="requestReset") {
    const email=typeof body.email==="string"?body.email.trim().toLowerCase().slice(0,180):"";
    const account=await db.prepare("SELECT user_id FROM accounts WHERE email=?").bind(email).first<{user_id:string}>();
    if(account) {
      try { await sendAccountLink(account.user_id,email,"reset"); }
      catch { console.error(JSON.stringify({event:"account_email_failed",purpose:"reset"})); }
    }
    // Same response for unknown accounts and delivery errors prevents enumeration.
    return Response.json({ok:true,message:isLocal()?"Email delivery is disabled in this local preview.":"If this email has an account, a reset link will arrive shortly. Please wait before trying again."});
  }
  if(action==="resetPassword" || action==="verifyEmail") {
    const token=typeof body.token==="string"?body.token:"";
    if(!/^[a-f0-9-]{72}$/.test(token))throw new RequestError("This link is invalid or expired. Request a new one.");
    const purpose=action==="verifyEmail"?"verify":"reset",id=await sha256(token),now=new Date().toISOString();
    const record=await db.prepare("SELECT user_id FROM account_tokens WHERE id=? AND purpose=? AND used_at IS NULL AND expires_at>?").bind(id,purpose,now).first<{user_id:string}>();
    if(!record)throw new RequestError("This link is invalid or expired. Request a new one.");
    let passwordHash="",salt="";
    if(purpose==="reset") {
      const password=typeof body.password==="string"?body.password:"";
      if(password.length<10 || password.length>128)throw new RequestError("Use a password between 10 and 128 characters.");
      salt=newPasswordSalt();passwordHash=await hashPassword(password,salt);
    }
    const guard="EXISTS (SELECT 1 FROM account_tokens WHERE id=? AND purpose=? AND used_at IS NULL AND expires_at>?)";
    const commands=[purpose==="reset"?
      db.prepare(`UPDATE accounts SET password_hash=?,password_salt=?,email_verified_at=COALESCE(email_verified_at,?) WHERE user_id=? AND ${guard}`).bind(passwordHash,salt,now,record.user_id,id,purpose,now):
      db.prepare(`UPDATE accounts SET email_verified_at=? WHERE user_id=? AND ${guard}`).bind(now,record.user_id,id,purpose,now)];
    if(purpose==="reset")commands.push(db.prepare(`DELETE FROM sessions WHERE user_id=? AND ${guard}`).bind(record.user_id,id,purpose,now));
    commands.push(db.prepare(`UPDATE account_tokens SET used_at=? WHERE user_id=? AND ${guard}`).bind(now,record.user_id,id,purpose,now));
    const result=await db.batch(commands);
    if(!result[0].meta.changes)throw new RequestError("This link has already been used. Request a new one.");
    const response=Response.json({ok:true,message:purpose==="reset"?"Password updated. Sign in with your new password.":"Email verified. You can now take part."});
    if(purpose==="reset")response.headers.append("Set-Cookie",await revokeSession(request));
    return response;
  }
  if(!["requestVerification","changePassword","signOutAll"].includes(action))return null;
  const actor=await currentUserId(request);if(!actor)throw new RequestError("Sign in to manage your account.",401);
  await limit(env.AUTH_LIMITER,`account:${actor}`);
  if(action==="signOutAll") {
    await db.prepare("DELETE FROM sessions WHERE user_id=?").bind(actor).run();
    const response=Response.json({ok:true});response.headers.append("Set-Cookie",await revokeSession(request));return response;
  }
  const account=await db.prepare("SELECT email,password_hash,password_salt,email_verified_at FROM accounts WHERE user_id=?").bind(actor).first<{email:string;password_hash:string;password_salt:string;email_verified_at:string|null}>();
  if(!account)throw new RequestError("Account unavailable.",404);
  if(action==="requestVerification") {
    if(!account.email_verified_at)await sendAccountLink(actor,account.email,"verify");
    return Response.json({ok:true,message:isLocal()?"Email verification is disabled in this local preview.":"Check your inbox for a verification link. You can request another after one minute."});
  }
  const current=typeof body.currentPassword==="string"?body.currentPassword:"",password=typeof body.password==="string"?body.password:"";
  if(current.length>128 || !await passwordMatches(current,account.password_salt,account.password_hash))throw new RequestError("Current password is incorrect.");
  if(password.length<10 || password.length>128)throw new RequestError("Use a password between 10 and 128 characters.");
  const salt=newPasswordSalt(),hash=await hashPassword(password,salt);
  const guard="EXISTS (SELECT 1 FROM accounts WHERE user_id=? AND password_hash=?)";
  const updated=await db.batch([
    db.prepare(`DELETE FROM sessions WHERE user_id=? AND ${guard}`).bind(actor,actor,account.password_hash),
    db.prepare(`DELETE FROM account_tokens WHERE user_id=? AND ${guard}`).bind(actor,actor,account.password_hash),
    db.prepare("UPDATE accounts SET password_hash=?,password_salt=? WHERE user_id=? AND password_hash=?").bind(hash,salt,actor,account.password_hash),
  ]);
  if(!updated[2].meta.changes)throw new RequestError("Your credentials changed. Sign in again.",409);
  const response=Response.json({ok:true});response.headers.append("Set-Cookie",await revokeSession(request));return response;
}
