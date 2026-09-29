"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Snapshot } from "./lib/community-model";
type Act = (body: Record<string,unknown>) => Promise<Record<string,unknown> | null>;
declare global {
  interface Window {
    turnstile?: { render(element:HTMLElement, options:Record<string,unknown>):string; remove(id:string):void; reset(id:string):void };
  }
}
export function Challenge({siteKey,action}:{siteKey:string;action:string}) {
  const element=useRef<HTMLDivElement>(null),[failed,setFailed]=useState(false);
  useEffect(()=>{
    if(!siteKey || !element.current)return;
    let widget:string | undefined;
    const render=()=>{if(element.current && window.turnstile && !widget)widget=window.turnstile.render(element.current,{sitekey:siteKey,action,"response-field-name":"challenge","error-callback":()=>setFailed(true)});};
    const reset=()=>{if(widget)window.turnstile?.reset(widget);};
    let script=document.getElementById("grounded-turnstile") as HTMLScriptElement|null;
    if(!script){script=document.createElement("script");script.id="grounded-turnstile";script.src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";script.async=true;document.head.appendChild(script);}
    script.addEventListener("load",render);const onError=()=>setFailed(true);script.addEventListener("error",onError);
    window.addEventListener("grounded:auth-attempt",reset);render();
    return()=>{script?.removeEventListener("load",render);script?.removeEventListener("error",onError);window.removeEventListener("grounded:auth-attempt",reset);if(widget)window.turnstile?.remove(widget);};
  },[siteKey,action]);
  return siteKey?<><div ref={element}/>{failed&&<p role="alert">The security check could not load. Refresh this page to retry.</p>}</>:null;
}
export function AccountSecurity({data,act}:{data:Snapshot;act:Act}) {
  const [busy,setBusy]=useState(false);
  return <section className="verification-panel"><h2>Account security</h2><p>{data.emailVerified?"Your email is verified.":!data.config.emailEnabled?"Account email is not enabled during this preview.":data.config.local?"Local preview: email delivery is disabled.":data.config.uploadsEnabled?"Verify your email to post, answer and upload photos.":"Verify your email to post and answer."}</p>{!data.emailVerified&&data.config.emailEnabled&&<button className="button" disabled={busy} onClick={async()=>{setBusy(true);await act({action:"requestVerification"});setBusy(false);}}>Send verification link</button>}<details><summary>Change password</summary><form className="inline-form" onSubmit={async event=>{event.preventDefault();if(busy)return;const form=event.currentTarget;setBusy(true);const result=await act({action:"changePassword",...Object.fromEntries(new FormData(form))});setBusy(false);if(result)window.location.href="/auth";}}><label>Current password<input type="password" name="currentPassword" autoComplete="current-password" maxLength={128} required/></label><label>New password<input type="password" name="password" autoComplete="new-password" minLength={10} maxLength={128} required/></label><button className="button primary" disabled={busy}>Update password and sign out</button></form></details><button className="button" disabled={busy} onClick={async()=>{setBusy(true);if(await act({action:"signOutAll"}))window.location.href="/auth";setBusy(false);}}>Sign out of all devices</button></section>;
}
export function AccountRecovery({mode,data,act}:{mode:string;data:Snapshot;act:Act}) {
  const [token,setToken]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  useEffect(()=>{setToken(new URLSearchParams(window.location.hash.slice(1)).get("token") || "");},[]);
  const action=mode==="verify"?"verifyEmail":mode==="reset"?"resetPassword":"requestReset";
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();if(busy)return;setBusy(true);
    const result=await act({action,token,...Object.fromEntries(new FormData(event.currentTarget))});
    setBusy(false);if(result){setMessage(String(result.message || "Saved."));if(mode!=="forgot")window.history.replaceState(null,"",window.location.pathname+window.location.search);}
  }
  if(mode==="forgot"&&!data.config.emailEnabled)return <section className="auth-page"><div className="auth-card"><h1>Email recovery opens soon</h1><p>Account email is not enabled during this preview.</p><a href="/">Explore the community</a></div></section>;
  return <section className="auth-page"><div className="auth-intro"><span className="kicker">Your account</span><h1>{mode==="verify"?"Verify your email":"Reset your password"}</h1></div><form className="auth-card" onSubmit={submit}>{message?<p role="status">{message}</p>:<><p>{mode==="verify"?"Confirm your email to take part in the community.":mode==="reset"?"Choose a new password. This signs out all devices.":"Enter your account email to request a reset link."}</p>{mode==="forgot"&&<label>Email<input name="email" type="email" autoComplete="email" required maxLength={180}/></label>}{mode==="reset"&&<label>New password<input name="password" type="password" autoComplete="new-password" minLength={10} maxLength={128} required/></label>}{mode!=="forgot"&&!token&&<p role="alert">Open the complete link from your email. Links expire after 30 minutes.</p>}{mode==="forgot"&&<Challenge siteKey={data.config.turnstileSiteKey} action={action}/>}<button className="button primary" disabled={busy||(mode!=="forgot"&&!token)}>{busy?"Working…":mode==="verify"?"Confirm email":mode==="reset"?"Save new password":"Send reset link"}</button></>}<a href="/auth">Return to sign in</a></form></section>;
}
