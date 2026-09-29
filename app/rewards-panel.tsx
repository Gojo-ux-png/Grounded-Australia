"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { RewardItem, RewardOrder, RewardKind, RewardsSnapshot } from "./lib/rewards-model";
import "./rewards.css";
import Link from "next/link";

const kindLabels: Record<RewardKind, string> = { product: "Farm supplies", coupon: "Voucher", consultation: "Expert consultation" };
const statusLabels = { pending: "Awaiting fulfilment", fulfilled: "Fulfilled", cancelled: "Cancelled · points returned", rejected: "Declined · points returned" };
const pointLabels = { answer: "Practical answer", vote: "Helpful vote", bestAnswer: "Accepted answer" };
const number = (n: number) => new Intl.NumberFormat("en-AU").format(n);
const date = (value: string) => new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`));
const authLink = "/auth?returnTo=%2Frewards";
type Action = (body: Record<string, unknown>) => Promise<boolean>;

function RewardSymbol({ kind }: { kind: RewardKind }) {
  return <svg viewBox="0 0 96 96" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    {kind === "product" ? <><path d="M25 39h46l-5 40H30l-5-40ZM37 39v-8a11 11 0 0 1 22 0v8M48 61V48M48 57c-10 0-13-7-13-7 9-2 13 7 13 7ZM48 65c10 0 13-8 13-8-9-1-13 8-13 8Z"/></> : kind === "coupon" ? <><path d="M20 28h56v13a7 7 0 0 0 0 14v13H20V55a7 7 0 0 0 0-14V28Z"/><path d="m38 56 20-18M39 39h.01M57 55h.01" strokeWidth="4" strokeLinecap="round"/></> : <><path d="M18 25h60v42H53L37 80V67H18V25Z"/><path d="M32 39h32M32 49h24"/></>}
  </svg>;
}

function RewardEditor({ item, busy, act, close }: { item: RewardItem | null; busy: boolean; act: Action; close: () => void }) {
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (await act({ action: "saveReward", ...(item ? { id: item.id } : {}), name: form.get("name"), description: form.get("description"), kind: form.get("kind"), points: Number(form.get("points")), totalStock: Number(form.get("totalStock")), active: form.get("active") === "on", partner: form.get("partner"), fulfillment: form.get("fulfillment") })) close();
  }
  return <form className="reward-editor" onSubmit={save}>
    <div className="rewards-row"><h3>{item ? "Edit reward" : "Add a reward"}</h3><button type="button" className="text-link" disabled={busy} onClick={close}>Close editor</button></div>
    {Boolean(item?.demo) && <p className="reward-notice">This is a demonstration item. Editing it will not make it redeemable.</p>}
    <fieldset disabled={busy}>
      <label>Reward name<input name="name" required minLength={3} maxLength={100} defaultValue={item?.name}/></label>
      <label>Description<textarea name="description" required minLength={10} maxLength={1500} rows={3} defaultValue={item?.description}/></label>
      <div className="reward-form-grid">
        <label>Reward type<select name="kind" defaultValue={item?.kind || "product"}>{Object.entries(kindLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>Points required<input type="number" name="points" required min={1} max={1000000} step={1} defaultValue={item?.points || 100}/></label>
        <label>Total allocation<input type="number" name="totalStock" required min={item ? item.total_stock - item.remaining_stock : 0} max={1000000} step={1} defaultValue={item?.total_stock || 0}/><small>The total number available across all orders, including fulfilled orders.</small></label>
        <label>Partner or supplier<input name="partner" maxLength={120} defaultValue={item?.partner}/><small>Only name a confirmed supplier.</small></label>
      </div>
      <label>Redemption and collection instructions<textarea name="fulfillment" required minLength={10} maxLength={1500} rows={3} defaultValue={item?.fulfillment} placeholder="Explain what is included, eligibility, and how members receive this reward."/></label>
      <label className="reward-checkbox"><input type="checkbox" name="active" defaultChecked={Boolean(item?.active)}/>List this reward in the catalogue</label>
      <button className="button primary" type="submit">{busy ? "Saving…" : "Save reward"}</button>
    </fieldset>
  </form>;
}

function OrderCard({ order, admin, actor, busy, act }: { order: RewardOrder; admin?: boolean; actor: string | null; busy: boolean; act: Action }) {
  return <article className="reward-order">
    <div className="rewards-row"><div><span className={`order-status status-${order.status}`}>{statusLabels[order.status]}</span><h3>{order.item_name}</h3></div><strong>{number(order.points)} points</strong></div>
    <p className="reward-muted">{kindLabels[order.item_kind]} · Requested {date(order.created_at)} · Ref {order.id.slice(0, 8)}</p>
    {admin && <p><strong>{order.user_name || "Member"}</strong>{order.contact_email && <> · <a href={`mailto:${order.contact_email}`}>{order.contact_email}</a></>}</p>}
    {order.note && <p className="reward-private-note"><strong>Member note</strong>{order.note}</p>}
    {order.fulfillment_note && <p className="reward-private-note"><strong>{order.status === "fulfilled" ? "Fulfilment details" : "Order update"}</strong>{order.fulfillment_note}</p>}
    {order.status === "pending" && !admin && <div className="rewards-row"><p className="reward-muted">Your points and one reward are reserved. The team will arrange fulfilment using your account email.</p><button className="button" disabled={busy} onClick={() => void act({ action: "cancelOrder", orderId: order.id })}>Cancel request</button></div>}
    {admin && order.status === "pending" && order.user_id !== actor && <details className="reward-review"><summary>Process this request</summary><form onSubmit={async event => {
      event.preventDefault(); const form = new FormData(event.currentTarget);
      await act({ action: "reviewOrder", orderId: order.id, status: form.get("status"), fulfillmentNote: form.get("fulfillmentNote") });
    }}><fieldset disabled={busy}>
      <label>Decision<select name="status"><option value="fulfilled">Mark fulfilled</option><option value="rejected">Decline and return points</option></select></label>
      <label>Fulfilment details or reason for declining<textarea name="fulfillmentNote" required minLength={10} rows={3} maxLength={1000} placeholder="Add the voucher code, collection instructions, delivery reference or reason for declining. Only this member and reviewers can see this."/></label>
      <p className="reward-muted">Mark fulfilled only after arranging the reward. Completed orders cannot be cancelled.</p>
      <button className="button primary">Save decision</button>
    </fieldset></form></details>}
    {admin && order.status === "pending" && order.user_id === actor && <p className="reward-muted">Another reviewer must process your request.</p>}
  </article>;
}

export default function RewardsPanel({ tab: requestedTab, onTabChange }: { tab: string; onTabChange: (tab: string) => void }) {
  const [data, setData] = useState<RewardsSnapshot | null>(null);
  const tab = ["catalogue", "wallet", "orders", "manage"].includes(requestedTab) ? requestedTab : "catalogue";
  const [kind, setKind] = useState("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<RewardItem | null>(null);
  const [editor, setEditor] = useState<RewardItem | null | undefined>(undefined);
  const [adminStatus, setAdminStatus] = useState("pending");
  const dialog = useRef<HTMLDialogElement>(null);
  const requestKey = useRef("");
  const requestVersion = useRef(0);
  const busyRef = useRef(false);
  const load = useCallback(async (signal?: AbortSignal) => {
    const version = ++requestVersion.current;
    const response = await fetch(`/api/rewards${tab === "manage" ? "?view=admin" : ""}`, { cache: "no-store", signal });
    const value = await response.json() as RewardsSnapshot & { error?: string };
    if (!response.ok) throw new Error(value.error || "Rewards are temporarily unavailable.");
    if (requestVersion.current === version) setData(value);
  }, [tab]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load rewards."); }); return () => controller.abort(); }, [load]);
  useEffect(() => { if (selected && !dialog.current?.open) dialog.current?.showModal(); else if (!selected && dialog.current?.open) dialog.current.close(); }, [selected]);
  const act: Action = async body => {
    if (busyRef.current) return false;
    busyRef.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/rewards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Could not save this request.");
      setMessage(body.action === "redeem" ? "Your reward is reserved. Follow its progress in My redemptions." : body.action === "cancelOrder" ? "Request cancelled. Reserved points have been returned." : "Saved.");
      try { await load(); } catch { setError("Your change was saved. Refresh the page to see the latest balance and orders."); }
      return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Connection interrupted. Retry to safely check the same request."); return false; }
    finally { busyRef.current = false; setBusy(false); }
  };
  function chooseTab(next: string) { onTabChange(next); setError(""); }
  function openReward(item: RewardItem) { requestKey.current = crypto.randomUUID(); setSelected(item); setError(""); }
  const catalog = data?.catalog.filter(item => kind === "all" || item.kind === kind) || [];
  const wallet = data?.wallet;
  return <section className="rewards-page">
    <div className="rewards-hero"><div><span className="kicker">Grounded rewards</span><h1>Good advice.<br/><em>Something in return.</em></h1><p>Share practical experience, help another grower, and put your contribution points to use.</p><Link className="reward-text-link" href="/">Explore questions <span aria-hidden="true">↗</span></Link></div>
      <aside className="rewards-balance"><span>{wallet ? "Available to redeem" : "Knowledge grows here"}</span><strong>{wallet ? number(wallet.available) : "+10"}<small>{wallet ? "points" : "for a practical answer"}</small></strong><p>{wallet ? "Your rewards balance is separate from your community XP and expert verification." : "A useful answer is the first step. Sign in to see your personal points and redemptions."}</p>{wallet ? <button className="reward-text-link" onClick={() => chooseTab("wallet")}>See my points →</button> : <a className="button cream" href={authLink}>Sign in</a>}</aside>
    </div>
    <div className="rewards-rules"><div><b>+10</b><span>Answer a question<small>Once per person, per question</small></span></div><div><b>+2</b><span>Receive a helpful vote<small>From an email-verified member</small></span></div><div><b>+20</b><span>Have your answer accepted<small>Chosen by the person who asked</small></span></div></div>
    <nav className="rewards-tabs" aria-label="Rewards sections">{[["catalogue", "Reward catalogue"], ["wallet", "My points"], ["orders", "My redemptions"], ...(data?.isModerator ? [["manage", "Manage rewards"]] : [])].map(([value, label]) => <button key={value} className={tab === value ? "active" : ""} aria-current={tab === value ? "page" : undefined} onClick={() => chooseTab(value)}>{label}</button>)}</nav>
    {message && <p className="reward-success" role="status">{message}</p>}
    {error && !selected && <div className="reward-error" role="alert"><p>{error}</p><button className="text-link" disabled={busy} onClick={() => { setError(""); void load().catch(cause => setError(String(cause.message))); }}>Refresh rewards</button></div>}
    {!data ? <p role="status" className="rewards-loading">Loading rewards…</p> : <>
      {!data.config.registrationOpen && <p className="reward-notice">Preview catalogue · Demonstration rewards show how the programme will work. They cannot be redeemed.</p>}
      {data.currentUserId && !data.emailVerified && <p className="reward-notice">Verify your account email before earning or spending points. <a href="/me?tab=profile">Account settings</a></p>}
      {Boolean(wallet?.deficit) && <p className="reward-error">Your eligible contributions changed after a redemption. Earn {number(wallet!.deficit)} points to restore your balance before redeeming again.</p>}
      {tab === "catalogue" && <><div className="rewards-row rewards-section-heading"><div><h2>For your next season</h2><p className="reward-muted">Practical supplies and offers, with clear terms.</p></div><label className="reward-filter">Show<select value={kind} onChange={event => setKind(event.target.value)}><option value="all">All rewards</option>{Object.entries(kindLabels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label></div>
        <div className="reward-grid">{catalog.map(item => <article className={`reward-card reward-${item.kind}`} key={item.id}><div className="reward-art"><span className="reward-kind">{kindLabels[item.kind]}</span>{Boolean(item.demo) && <span className="reward-demo">Demo reward</span>}<RewardSymbol kind={item.kind}/></div><div className="reward-card-content">{item.partner && <span className="kicker">{item.partner}</span>}<h3>{item.name}</h3><p>{item.description}</p><details><summary>Redemption details</summary><p>{item.fulfillment}</p></details><div className="reward-cost"><strong>{number(item.points)} <small>points</small></strong><span>{item.demo ? "Illustrative reward" : item.remaining_stock > 0 ? `${item.remaining_stock} available` : "Out of stock"}</span></div>
          {item.demo ? <button className="button" disabled>Preview only</button> : !data.currentUserId ? <a className="button primary" href={authLink}>Sign in to redeem</a> : <button className="button primary" disabled={busy || !data.canRedeem || item.remaining_stock < 1 || (wallet?.available || 0) < item.points} onClick={() => openReward(item)}>{!data.canRedeem ? "Verified account required" : item.remaining_stock < 1 ? "Out of stock" : (wallet?.available || 0) < item.points ? `${number(item.points - (wallet?.available || 0))} more points needed` : "Redeem reward"}</button>}
        </div></article>)}</div>{!catalog.length && <div className="reward-empty"><h3>No rewards in this category yet</h3><p>New offers will appear here when they are ready.</p></div>}</>}
      {tab === "wallet" && (wallet ? <><div className="rewards-section-heading"><h2>Your points, explained</h2><p className="reward-muted">Only visible contributions from verified, real accounts earn redeemable points. Self-answers and demo discussions do not qualify.</p></div><div className="wallet-summary"><div><span>Eligible contribution points</span><strong>{number(wallet.earned)}</strong></div><div><span>Reserved or spent</span><strong>{number(wallet.spent)}</strong></div><div><span>Available to redeem</span><strong>{number(wallet.available)}</strong></div></div><div className="wallet-breakdown"><span>Answers <b>+{number(wallet.answerPoints)}</b></span><span>Helpful votes <b>+{number(wallet.votePoints)}</b></span><span>Accepted answers <b>+{number(wallet.bestAnswerPoints)}</b></span></div><p className="reward-notice">Points follow current contributions. A removed answer, withdrawn vote or changed acceptance adjusts your balance. Cancelling a pending redemption returns its reserved points. Points are for rewards and cannot be transferred or cashed out.</p><h3>Current eligible contributions</h3><p className="reward-muted">Showing up to 100 contributions. Dates refer to the original answer; this list updates when a contribution changes.</p><div className="points-activity">{data.activities.map(item => <a key={item.id} href={`/questions/${item.question_slug}?answer=${item.answer_id}#answer-${item.answer_id}`}><span><strong>{pointLabels[item.kind]}</strong><small>{item.question_title} · {date(item.created_at)}</small></span><b>+{number(item.points)}</b></a>)}</div>{!data.activities.length && <div className="reward-empty"><h3>Your first contribution starts here</h3><p>Answer another member’s question to start earning points.</p><Link href="/" className="button primary">Find a question</Link></div>}</> : <div className="reward-empty"><h2>Your points belong to you</h2><p>Sign in to see your balance and eligible contributions.</p><a className="button primary" href={authLink}>Sign in</a></div>)}
      {tab === "orders" && (data.currentUserId ? <><div className="rewards-section-heading"><h2>My redemptions</h2><p className="reward-muted">Your latest 50 requests. Fulfilment details are visible only to you and the review team.</p></div><div className="reward-orders">{data.orders.map(order => <OrderCard key={order.id} order={order} actor={data.currentUserId} busy={busy} act={act}/>)}</div>{!data.orders.length && <div className="reward-empty"><h3>No redemptions yet</h3><p>Choose a reward once you have enough points.</p><button className="button primary" onClick={() => chooseTab("catalogue")}>Browse rewards</button></div>}</> : <div className="reward-empty"><h2>Track your rewards</h2><p>Sign in to view your private redemption history.</p><a className="button primary" href={authLink}>Sign in</a></div>)}
      {tab === "manage" && (data.isModerator ? <><div className="rewards-row rewards-section-heading"><div><h2>Rewards desk</h2><p className="reward-muted">Manage confirmed rewards and fulfil member requests.</p></div><button className="button primary" disabled={busy} onClick={() => setEditor(null)}>Add reward</button></div>{editor !== undefined && <RewardEditor key={editor?.id || "new"} item={editor} busy={busy} act={act} close={() => setEditor(undefined)}/>}<div className="reward-admin-catalog">{data.admin?.catalog.map(item => <div key={item.id}><span><strong>{item.name}</strong><small>{number(item.points)} points · {item.remaining_stock}/{item.total_stock} remaining · {item.demo ? "Demo" : item.active ? "Listed" : "Unlisted"}</small></span><button className="button" disabled={busy} onClick={() => setEditor(item)}>Edit</button></div>)}</div><div className="rewards-row rewards-section-heading"><h3>Redemption requests</h3><label className="reward-filter">Status<select value={adminStatus} onChange={event => setAdminStatus(event.target.value)}><option value="all">All recent requests</option>{Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div><p className="reward-muted">Up to 100 requests, with pending requests first. Contact details are private; this page does not send emails.</p><div className="reward-orders">{data.admin?.orders.filter(order => adminStatus === "all" || order.status === adminStatus).map(order => <OrderCard key={order.id} order={order} admin actor={data.currentUserId} busy={busy} act={act}/>)}</div>{!data.admin?.orders.some(order => adminStatus === "all" || order.status === adminStatus) && <div className="reward-empty"><p>No requests with this status.</p></div>}</> : <div className="reward-empty"><h2>Reviewer access required</h2><p>This section is available to authorised reviewers.</p></div>)}
    </>}
    <dialog className="reward-dialog" ref={dialog} onCancel={event => { if (busy) event.preventDefault(); else setSelected(null); }} onClose={() => { if (!busy) setSelected(null); }} aria-labelledby="redeem-title">
      {selected && <form onSubmit={async event => { event.preventDefault(); const note = new FormData(event.currentTarget).get("note"); if (await act({ action: "redeem", rewardId: selected.id, expectedPoints: selected.points, expectedRevision: selected.revision, requestKey: requestKey.current, note })) { setSelected(null); chooseTab("orders"); } }}><div className="rewards-row"><span className="kicker">Confirm your reward</span><button type="button" aria-label="Close redemption" className="reward-close" disabled={busy} onClick={() => setSelected(null)}>×</button></div><h2 id="redeem-title">{selected.name}</h2><p>{selected.fulfillment}</p><div className="reward-confirm-cost"><span>Points to reserve</span><strong>{number(selected.points)}</strong></div><p className="reward-muted">Estimated balance after redeeming: {number(Math.max(0, (wallet?.available || 0) - selected.points))} points. The team will arrange fulfilment using your account email.</p><label>Optional note<textarea name="note" maxLength={500} rows={3} placeholder="For example, your preferred size or collection preference. Do not include a full address or payment details." disabled={busy}/></label><p className="reward-muted">You can cancel while the request is pending. If the connection is interrupted, retry this request or check My redemptions before starting again.</p>{error && <p className="reward-error" role="alert">{error}</p>}<button type="submit" className="button primary" disabled={busy}>{busy ? "Reserving…" : `Confirm · ${number(selected.points)} points`}</button></form>}
    </dialog>
  </section>;
}
