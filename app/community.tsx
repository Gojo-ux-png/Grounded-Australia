"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type User = { id: string; handle: string; name: string; initials: string; role: string; verified: number; state: string; town: string; bio: string; specialties: string; years: number; xp: number; followers: number; following: number; base_likes: number };
type Question = { id: number; slug: string; author_id: string; title: string; body: string; category: string; tags: string[]; state: string; town: string; image_url: string | null; video_url: string | null; created_at: string; views: number; selected_answer_id: number | null };
type Answer = { id: number; question_id: number; author_id: string; body: string; citation_url: string | null; product_name: string | null; commercial: number; image_url: string | null; base_score: number; created_at: string };
type Comment = { id: number; answer_id: number; author_id: string; body: string; created_at: string };
type Vote = { user_id: string; answer_id: number; value: number };
type Pair = { user_id: string; question_id: number };
type Invitation = { question_id: number; inviter_id: string; expert_id: string };
type Snapshot = { currentUserId: string | null; users: User[]; questions: Question[]; answers: Answer[]; comments: Comment[]; votes: Vote[]; bookmarks: Pair[]; follows: Pair[]; invitations: Invitation[] };
type View = "home" | "ask" | "search" | "question" | "profile" | "leaderboard" | "auth";

const categories = ["All", "Crops", "Livestock", "Soil", "Water", "Technology", "Business"];
const states = ["All Australia", "ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"];

const Icon = ({ children }: { children: string }) => <span className="icon" aria-hidden="true">{children}</span>;

function level(xp: number) {
  return xp >= 200 ? "Expert" : xp >= 50 ? "Experienced Contributor" : "Beginner";
}

function ago(date: string) {
  const diff = Math.max(1, Date.now() - new Date(`${date.replace(" ", "T")}Z`).getTime());
  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return `${Math.max(1, hours)}h ago`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}d ago` : new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short" }).format(new Date(date));
}

function score(answer: Answer, votes: Vote[]) {
  return answer.base_score + votes.filter((vote) => vote.answer_id === answer.id).reduce((total, vote) => total + vote.value, 0);
}

function UserBadge({ user, compact = false }: { user?: User; compact?: boolean }) {
  if (!user) return null;
  return (
    <a className={`user-badge ${compact ? "compact" : ""}`} href={`/people/${user.handle}`}>
      <span className={`avatar avatar-${user.id}`} aria-hidden="true">{user.initials}</span>
      <span>
        <strong>{user.name} {Boolean(user.verified) && <span className="verified" title="Verified expert">✓</span>}</strong>
        <small>{user.role} · {user.town}, {user.state}</small>
      </span>
    </a>
  );
}

function Header({ data }: { data: Snapshot | null }) {
  const current = data?.users.find((user) => user.id === data.currentUserId);
  return (
      <header className="site-header">
        <a className="brand" href="/" aria-label="Grounded Australia home"><span className="brand-mark">G</span><span>Grounded<small>Australia</small></span></a>
        <nav aria-label="Main navigation">
          <a href="/">Questions</a>
          <a href="/search">Find expertise</a>
          <a href="/leaderboard">Leaderboard</a>
        </nav>
        <div className="header-actions">
          <a className="search-link" href="/search" aria-label="Search"><Icon>⌕</Icon></a>
          {!current && <a className="auth-link" href="/auth">Sign in / Sign up</a>}
          <a className="button primary small" href="/ask"><Icon>＋</Icon> Ask a question</a>
          {current && <a className="mini-avatar" href={`/people/${current.handle}`} title={current.name}>{current.initials}</a>}
        </div>
      </header>
  );
}

function Footer() {
  return <footer><a className="brand footer-brand" href="/"><span className="brand-mark">G</span><span>Grounded<small>Australia</small></span></a><p>Practical knowledge, rooted in place.</p><span>Built for Australian agriculture · MVP community</span></footer>;
}

function Shell({ children, data, toast }: { children: React.ReactNode; data: Snapshot | null; toast: string }) {
  return <><Header data={data}/>{toast && <div className="toast" role="status">{toast}</div>}<main>{children}</main><Footer/></>;
}

function QuestionCard({ question, data, featured = false }: { question: Question; data: Snapshot; featured?: boolean }) {
  const author = data.users.find((user) => user.id === question.author_id);
  const answers = data.answers.filter((answer) => answer.question_id === question.id);
  const selected = answers.find((answer) => answer.id === question.selected_answer_id);
  const selectedAuthor = data.users.find((user) => user.id === selected?.author_id);
  return (
    <article className={`question-card ${question.image_url ? "has-image" : "no-image"} ${featured ? "featured" : ""}`}>
      {question.image_url && <a className="question-image" href={`/questions/${question.slug}`}><img src={question.image_url} alt="Australian farm field related to the question" /></a>}
      <div className="question-copy">
        <div className="eyebrow-row"><span className="category-pill">{question.category}</span><span><Icon>⌖</Icon> {question.town}, {question.state}</span><span>{ago(question.created_at)}</span></div>
        <h2><a href={`/questions/${question.slug}`}>{question.title}</a></h2>
        <p>{question.body}</p>
        <div className="tag-row">{question.tags.map((tag) => <a href={`/search?q=${encodeURIComponent(tag)}`} key={tag}>#{tag}</a>)}</div>
        {selected && <div className="answer-preview"><span className="accepted-mark">✓</span><div><strong>Selected answer from {selectedAuthor?.name}</strong><p>{selected.body}</p></div></div>}
        <div className="card-footer"><UserBadge user={author} compact/><div><span><Icon>◌</Icon> {question.views.toLocaleString("en-AU")}</span><span><Icon>↳</Icon> {answers.length} {answers.length === 1 ? "answer" : "answers"}</span><span><Icon>☆</Icon> {data.follows.filter((follow) => follow.question_id === question.id).length + 12}</span></div></div>
      </div>
    </article>
  );
}

function Home({ data }: { data: Snapshot }) {
  const [category, setCategory] = useState("All");
  const [state, setState] = useState("All Australia");
  const [sort, setSort] = useState("latest");
  const filtered = useMemo(() => {
    const result = data.questions.filter((question) => (category === "All" || question.category === category) && (state === "All Australia" || question.state === state));
    return result.sort((a, b) => sort === "popular" ? b.views - a.views : sort === "unanswered" ? Number(data.answers.some((answer) => answer.question_id === a.id)) - Number(data.answers.some((answer) => answer.question_id === b.id)) : b.created_at.localeCompare(a.created_at));
  }, [category, state, sort, data]);
  const leaders = [...data.users].sort((a, b) => b.xp - a.xp).slice(0, 4);
  return (
    <>
      <section className="hero">
        <div className="hero-copy"><span className="kicker">Knowledge grows when it&apos;s shared</span><h1>Questions rooted<br/>in <em>place.</em></h1><p>Practical answers from Australian farmers, growers and verified experts — shaped by the land, season and experience.</p><div className="hero-actions"><a className="button primary" href="/ask">Ask the community <Icon>→</Icon></a><a className="text-link" href="#questions">Explore field questions <Icon>↓</Icon></a></div><div className="community-proof"><div className="proof-avatars"><span>PN</span><span>TB</span><span>JW</span></div><p><strong>2,400+ practical answers</strong><br/>from every state and territory</p></div></div>
        <div className="hero-photo"><img src="https://images.unsplash.com/photo-1648804106293-8e333810020c?auto=format&fit=crop&w=1800&q=88" alt="Cattle grazing on an Australian farm"/><div className="photo-note"><span>FIELD NOTE · QLD</span><strong>Good advice starts with local context.</strong></div></div>
      </section>
      <section className="category-band"><div><span className="section-label">Browse by field</span>{categories.slice(1).map((item) => <button className={category === item ? "active" : ""} onClick={() => setCategory(category === item ? "All" : item)} key={item}>{item}</button>)}</div></section>
      <section className="content-grid" id="questions">
        <div className="feed">
          <div className="section-heading"><div><span className="section-label">From the community</span><h2>Field questions</h2></div><div className="filters"><select value={state} onChange={(e) => setState(e.target.value)} aria-label="Filter by state">{states.map((item) => <option key={item}>{item}</option>)}</select><select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort questions"><option value="latest">Latest</option><option value="popular">Most viewed</option><option value="unanswered">Unanswered first</option></select></div></div>
          {filtered.length ? filtered.map((question, index) => <QuestionCard question={question} data={data} featured={index === 0} key={question.id}/>) : <div className="empty"><span>⌁</span><h3>No questions in this patch yet</h3><p>Try another filter or be the first to ask.</p></div>}
        </div>
        <aside className="sidebar">
          <div className="ask-card"><span className="sun-symbol">☼</span><span className="section-label">Ask well, learn faster</span><h3>What are you seeing<br/>in the paddock?</h3><p>Add your location, conditions and what you have already tried. Details help the right people find your question.</p><a className="button cream" href="/ask">Start a field question <Icon>→</Icon></a></div>
          <div className="leader-card"><div className="aside-heading"><div><span className="section-label">This season</span><h3>Trusted voices</h3></div><a href="/leaderboard">View all</a></div>{leaders.map((user, index) => <a className="leader-row" href={`/people/${user.handle}`} key={user.id}><span className="rank">0{index + 1}</span><span className={`avatar avatar-${user.id}`}>{user.initials}</span><span><strong>{user.name} {Boolean(user.verified) && <i className="verified">✓</i>}</strong><small>{user.specialties.split(",")[0]}</small></span><b>{user.xp}<small> XP</small></b></a>)}</div>
          <div className="newsletter"><Icon>✦</Icon><div><strong>The Weekly Ground</strong><p>Three useful questions, once a week.</p></div><button aria-label="Join weekly email">Join</button></div>
        </aside>
      </section>
    </>
  );
}

function AskPage({ data, act, upload }: { data: Snapshot; act: (body: Record<string, unknown>) => Promise<Record<string, unknown> | null>; upload: (file: File) => Promise<string | null> }) {
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true);
    const form = new FormData(event.currentTarget);
    const file = form.get("image");
    const imageUrl = file instanceof File && file.size ? await upload(file) : null;
    const result = await act({ action: "ask", title: form.get("title"), body: form.get("body"), category: form.get("category"), tags: form.get("tags"), state: form.get("state"), town: form.get("town"), videoUrl: form.get("videoUrl"), imageUrl });
    setBusy(false); if (result?.slug) window.location.href = `/questions/${result.slug}`;
  }
  const current = data.users.find((user) => user.id === data.currentUserId);
  return <section className="form-page"><div className="form-intro"><span className="kicker">Ask the community</span><h1>Bring the whole<br/><em>field picture.</em></h1><p>The best answers start with context: location, conditions, timing, what changed and what you have already tried.</p><div className="tip-list"><span><b>01</b> Name the crop, animal or system</span><span><b>02</b> Add your region and recent conditions</span><span><b>03</b> Upload one clear, useful image</span></div></div><form className="editor-card" onSubmit={submit}><div className="form-head"><div><span className="section-label">New field question</span><h2>What do you need help with?</h2></div>{current ? <UserBadge user={current} compact/> : <a className="visitor-warning" href="/auth">Sign in to publish</a>}</div><label>Question title<input name="title" required minLength={12} maxLength={160} placeholder="e.g. Why is my wheat yellowing after a wet July?"/><small>Be specific enough that the right person recognises the problem.</small></label><label>Field detail<textarea name="body" required minLength={30} maxLength={5000} rows={8} placeholder="Describe what you are seeing, timing, recent weather, paddock or herd history, and what you have tried..."/></label><div className="two-col"><label>Category<select name="category" required>{categories.slice(1).map((item) => <option key={item}>{item}</option>)}</select></label><label>Tags<input name="tags" placeholder="wheat, nitrogen, waterlogging"/></label></div><div className="two-col"><label>State or territory<select name="state" required>{states.slice(1).map((item) => <option key={item}>{item}</option>)}</select></label><label>Nearest town<input name="town" required maxLength={80} placeholder="e.g. Horsham"/></label></div><div className="two-col"><label>Photo <span className="optional">optional · max 5 MB</span><input type="file" name="image" accept="image/*"/></label><label>Video link <span className="optional">optional</span><input type="url" name="videoUrl" placeholder="https://..."/></label></div><div className="form-submit"><span>Your question will be public in the community.</span><button className="button primary" disabled={!current || busy}>{busy ? "Publishing…" : "Publish question"} <Icon>→</Icon></button></div></form></section>;
}

function VoteBox({ answer, data, act }: { answer: Answer; data: Snapshot; act: (body: Record<string, unknown>) => Promise<Record<string, unknown> | null> }) {
  const own = data.votes.find((vote) => vote.answer_id === answer.id && vote.user_id === data.currentUserId)?.value ?? 0;
  return <div className="vote-box"><button disabled={!data.currentUserId} className={own === 1 ? "active" : ""} onClick={() => act({ action: "vote", answerId: answer.id, value: own === 1 ? 0 : 1 })} aria-label="Upvote answer">⌃</button><strong>{score(answer, data.votes)}</strong><button disabled={!data.currentUserId} className={own === -1 ? "active down" : ""} onClick={() => act({ action: "vote", answerId: answer.id, value: own === -1 ? 0 : -1 })} aria-label="Downvote answer">⌄</button></div>;
}

function AnswerCard({ answer, question, data, act, selected }: { answer: Answer; question: Question; data: Snapshot; act: (body: Record<string, unknown>) => Promise<Record<string, unknown> | null>; selected?: boolean }) {
  const author = data.users.find((user) => user.id === answer.author_id);
  const answerComments = data.comments.filter((comment) => comment.answer_id === answer.id);
  async function comment(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); if (await act({ action: "comment", answerId: answer.id, body: form.get("body") })) event.currentTarget.reset(); }
  async function edit() { const content = window.prompt("Edit your answer", answer.body); if (content && content !== answer.body) await act({ action: "editAnswer", answerId: answer.id, body: content }); }
  async function remove() { if (window.confirm("Delete this answer and its comments?")) await act({ action: "deleteAnswer", answerId: answer.id }); }
  return <article className={`answer-card ${selected ? "selected" : ""}`}>{selected && <div className="selected-ribbon"><Icon>✓</Icon> Selected by the question author</div>}<div className="answer-layout"><VoteBox answer={answer} data={data} act={act}/><div className="answer-main"><div className="answer-author"><UserBadge user={author}/><span>{ago(answer.created_at)}</span></div>{Boolean(answer.commercial) && <div className="disclosure"><Icon>◇</Icon> Commercial relationship disclosed {answer.product_name && `· ${answer.product_name}`}</div>}<p className="answer-body">{answer.body}</p>{answer.image_url && <img className="answer-image" src={answer.image_url} alt="Photo supplied with this answer"/>}{answer.citation_url && <a className="reference-link" href={answer.citation_url} target="_blank" rel="noreferrer"><Icon>↗</Icon> View supporting reference</a>}<div className="answer-actions">{question.author_id === data.currentUserId && !selected && <button onClick={() => act({ action: "selectBest", questionId: question.id, answerId: answer.id })}><Icon>✓</Icon> Select best answer</button>}{answer.author_id === data.currentUserId && <><button onClick={edit}>Edit</button><button onClick={remove}>Delete</button></>}<button onClick={() => { const reason = window.prompt("Why are you reporting this answer?"); if (reason) act({ action: "report", targetType: "answer", targetId: answer.id, reason }); }}>Report</button></div>{answerComments.length > 0 && <div className="comments">{answerComments.map((comment) => { const user = data.users.find((item) => item.id === comment.author_id); return <div className="comment" key={comment.id}><span className={`avatar tiny avatar-${user?.id}`}>{user?.initials}</span><p><strong>{user?.name}</strong> {comment.body}<small>{ago(comment.created_at)}</small></p></div>; })}</div>}<form className="comment-form" onSubmit={comment}><input name="body" maxLength={600} placeholder={data.currentUserId ? "Add a useful comment…" : "Sign in to comment"} disabled={!data.currentUserId}/><button disabled={!data.currentUserId} aria-label="Post comment">→</button></form></div></div></article>;
}

function QuestionPage({ slug, data, act, upload }: { slug: string; data: Snapshot; act: (body: Record<string, unknown>) => Promise<Record<string, unknown> | null>; upload: (file: File) => Promise<string | null> }) {
  const question = data.questions.find((item) => item.slug === slug);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (question && !sessionStorage.getItem(`viewed-${question.id}`)) { sessionStorage.setItem(`viewed-${question.id}`, "1"); fetch("/api/community", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "view", questionId: question.id }) }); } }, [question]);
  if (!question) return <div className="empty page-empty"><h2>Question not found</h2><a className="button primary" href="/">Back to questions</a></div>;
  const activeQuestion = question;
  const author = data.users.find((user) => user.id === question.author_id);
  const answerList = data.answers.filter((answer) => answer.question_id === question.id);
  const selected = answerList.find((answer) => answer.id === question.selected_answer_id);
  const others = answerList.filter((answer) => answer.id !== question.selected_answer_id).sort((a, b) => score(b, data.votes) - score(a, data.votes));
  const bookmarked = data.bookmarks.some((item) => item.user_id === data.currentUserId && item.question_id === question.id);
  const followed = data.follows.some((item) => item.user_id === data.currentUserId && item.question_id === question.id);
  const experts = data.users.filter((user) => Boolean(user.verified));
  async function answer(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setBusy(true); const form = new FormData(event.currentTarget); const file = form.get("image"); const imageUrl = file instanceof File && file.size ? await upload(file) : null; const result = await act({ action: "answer", questionId: activeQuestion.id, body: form.get("body"), citationUrl: form.get("citationUrl"), productName: form.get("productName"), commercial: form.get("commercial") === "on", imageUrl }); setBusy(false); if (result) event.currentTarget.reset(); }
  async function editQuestion() { const title = window.prompt("Edit question title", activeQuestion.title); if (!title) return; const body = window.prompt("Edit field detail", activeQuestion.body); if (body) await act({ action: "editQuestion", questionId: activeQuestion.id, title, body }); }
  return <><section className="question-hero"><div className="breadcrumbs"><a href="/">Questions</a><span>›</span><a href={`/search?category=${question.category}`}>{question.category}</a><span>›</span><span>{question.state}</span></div><div className="question-title-row"><div><div className="eyebrow-row"><span className="category-pill">{question.category}</span><span><Icon>⌖</Icon> {question.town}, {question.state}</span><span>Asked {ago(question.created_at)}</span></div><h1>{question.title}</h1></div><div className="question-stats"><div><strong>{question.views.toLocaleString("en-AU")}</strong><small>views</small></div><div><strong>{answerList.length}</strong><small>answers</small></div></div></div></section><section className="question-grid"><div><article className="question-detail"><UserBadge user={author}/><p>{question.body}</p>{question.image_url && <img src={question.image_url} alt="Field photo supplied with the question"/>}{question.video_url && <a className="reference-link" href={question.video_url} target="_blank" rel="noreferrer"><Icon>▶</Icon> Watch supplied field video</a>}<div className="tag-row">{question.tags.map((tag) => <a href={`/search?q=${tag}`} key={tag}>#{tag}</a>)}</div><div className="question-actions"><button className={bookmarked ? "active" : ""} onClick={() => act({ action: "toggleBookmark", questionId: question.id })}><Icon>{bookmarked ? "★" : "☆"}</Icon> {bookmarked ? "Saved" : "Save"}</button><button className={followed ? "active" : ""} onClick={() => act({ action: "toggleFollow", questionId: question.id })}><Icon>◎</Icon> {followed ? "Following" : "Follow"}</button><button onClick={async () => { await navigator.clipboard?.writeText(window.location.href); }}><Icon>↗</Icon> Share</button>{question.author_id === data.currentUserId && <button onClick={editQuestion}>Edit</button>}<button onClick={() => { const reason = window.prompt("Why are you reporting this question?"); if (reason) act({ action: "report", targetType: "question", targetId: question.id, reason }); }}>Report</button></div></article>{selected && <section className="answer-section"><div className="section-heading"><div><span className="section-label">Resolved in the field</span><h2>Selected answer</h2></div></div><AnswerCard answer={selected} question={question} data={data} act={act} selected/></section>}<section className="answer-section"><div className="section-heading"><div><span className="section-label">Community experience</span><h2>{selected ? `${others.length} other ${others.length === 1 ? "answer" : "answers"}` : `${others.length} ${others.length === 1 ? "answer" : "answers"}`}</h2></div><span>Highest rated first</span></div>{others.map((item) => <AnswerCard key={item.id} answer={item} question={question} data={data} act={act}/>)}{!others.length && <div className="empty"><h3>No other answers yet</h3><p>Local experience could make the difference.</p></div>}</section><form className="answer-editor" onSubmit={answer}><span className="section-label">Share what you know</span><h2>Write an answer</h2><p>Explain what you would check, why it matters and where your experience comes from.</p><textarea name="body" minLength={20} maxLength={5000} rows={7} required disabled={!data.currentUserId} placeholder={data.currentUserId ? "Share a practical, specific answer…" : "Sign in to answer"}/><div className="two-col"><label>Supporting link <span className="optional">optional</span><input name="citationUrl" type="url" placeholder="https://..."/></label><label>Photo <span className="optional">optional · max 5 MB</span><input type="file" name="image" accept="image/*"/></label></div><div className="commercial-row"><label><input type="checkbox" name="commercial"/> This answer mentions a product I have a commercial relationship with</label><input name="productName" placeholder="Product or partner name (optional)"/></div>{!data.currentUserId && <a className="text-link" href="/auth">Sign in or create an account to answer</a>}<button className="button primary" disabled={!data.currentUserId || busy}>{busy ? "Publishing…" : "Publish answer"} <Icon>→</Icon></button></form></div><aside className="question-aside"><div className="author-card"><span className="section-label">Asked by</span><UserBadge user={author}/><p>{author?.bio}</p><dl><div><dt>Experience</dt><dd>{author?.years} years</dd></div><div><dt>Field</dt><dd>{author?.specialties.split(",")[0]}</dd></div></dl></div><div className="expert-card"><span className="section-label">Bring in expertise</span><h3>Invite an expert</h3><p>Ask a verified specialist with relevant field experience to weigh in.</p>{experts.map((expert) => { const invited = data.invitations.some((invite) => invite.question_id === question.id && invite.inviter_id === data.currentUserId && invite.expert_id === expert.id); return <div className="expert-invite" key={expert.id}><UserBadge user={expert} compact/><button disabled={invited || !data.currentUserId} onClick={() => act({ action: "inviteExpert", questionId: question.id, expertId: expert.id })}>{invited ? "Invited" : "Invite"}</button></div>; })}</div><div className="safety-note"><Icon>✦</Icon><div><strong>Keep advice grounded</strong><p>For urgent animal health, chemical safety or biosecurity issues, contact a local professional.</p></div></div></aside></section></>;
}

function SearchPage({ data }: { data: Snapshot }) {
  const params = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
  const [query, setQuery] = useState(params.get("q") ?? ""); const [category, setCategory] = useState(params.get("category") ?? "All"); const [state, setState] = useState("All Australia"); const [status, setStatus] = useState("all");
  const term = query.toLowerCase();
  const matches = data.questions.filter((question) => {
    const textMatches = !term || `${question.title} ${question.body} ${question.tags.join(" ")}`.toLowerCase().includes(term);
    const categoryMatches = category === "All" || question.category === category;
    const stateMatches = state === "All Australia" || question.state === state;
    const statusMatches = status === "all"
      || (status === "unanswered" && !data.answers.some((answer) => answer.question_id === question.id))
      || (status === "expert" && data.answers.some((answer) => answer.question_id === question.id && Boolean(data.users.find((user) => user.id === answer.author_id)?.verified)));
    return textMatches && categoryMatches && stateMatches && statusMatches;
  });
  const people = data.users.filter((user) => term && `${user.name} ${user.bio} ${user.specialties} ${user.town}`.toLowerCase().includes(term));
  return <section className="search-page"><div className="search-hero"><span className="kicker">Find field knowledge</span><h1>Search the<br/><em>community.</em></h1><div className="big-search"><Icon>⌕</Icon><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Try ‘waterlogging’, ‘calf scours’ or a town…" autoFocus/><span>{matches.length + people.length} results</span></div></div><div className="search-layout"><aside className="filter-panel"><span className="section-label">Refine results</span><label>Category<select value={category} onChange={(e) => setCategory(e.target.value)}>{categories.map((item) => <option key={item}>{item}</option>)}</select></label><label>Location<select value={state} onChange={(e) => setState(e.target.value)}>{states.map((item) => <option key={item}>{item}</option>)}</select></label><label>Answer status<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">Any status</option><option value="unanswered">Unanswered</option><option value="expert">Expert answered</option></select></label><button className="text-link" onClick={() => { setCategory("All"); setState("All Australia"); setStatus("all"); }}>Clear filters</button></aside><div className="search-results">{people.length > 0 && <section><span className="section-label">People & expertise</span><div className="people-strip">{people.map((user) => <a href={`/people/${user.handle}`} key={user.id}><span className={`avatar avatar-${user.id}`}>{user.initials}</span><strong>{user.name} {Boolean(user.verified) && <i className="verified">✓</i>}</strong><small>{user.specialties}</small><span>{user.town}, {user.state}</span></a>)}</div></section>}<div className="section-heading"><div><span className="section-label">Questions</span><h2>{query ? `Results for “${query}”` : "All field questions"}</h2></div></div>{matches.map((question) => <QuestionCard question={question} data={data} key={question.id}/>)}{!matches.length && <div className="empty"><h3>No field questions matched</h3><p>Broaden your location or category filter.</p></div>}</div></div></section>;
}

function AuthPage({ data }: { data: Snapshot }) {
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const current = data.users.find((user) => user.id === data.currentUserId);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setMessage("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/community", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: mode, name: form.get("name"), email: form.get("email"), password: form.get("password"), state: form.get("state"), town: form.get("town") }) });
    const result = await response.json() as { error?: string; handle?: string };
    setBusy(false);
    if (!response.ok) return setMessage(result.error ?? "We could not sign you in.");
    window.location.href = result.handle ? `/people/${result.handle}` : "/";
  }
  if (current) return <section className="auth-page"><div className="auth-intro"><span className="kicker">Welcome back</span><h1>You&apos;re already<br/><em>in the field.</em></h1><p>Continue to your profile or return to the community questions.</p></div><div className="auth-card signed-in-card"><UserBadge user={current}/><h2>Signed in as {current.name}</h2><a className="button primary" href={`/people/${current.handle}`}>View my profile <Icon>→</Icon></a><a className="text-link" href="/">Back to questions</a></div></section>;
  return <section className="auth-page"><div className="auth-intro"><span className="kicker">Grounded membership</span><h1>Join the<br/><em>conversation.</em></h1><p>Ask local questions, share practical experience and build a trusted record of useful answers.</p><ul><li>Public profiles rooted in your region</li><li>Save and follow questions</li><li>Earn experience through helpful contributions</li></ul></div><form className="auth-card" onSubmit={submit}><div className="auth-tabs" role="tablist" aria-label="Account options"><button type="button" role="tab" aria-selected={mode === "signIn"} className={mode === "signIn" ? "active" : ""} onClick={() => { setMode("signIn"); setMessage(""); }}>Sign in</button><button type="button" role="tab" aria-selected={mode === "signUp"} className={mode === "signUp" ? "active" : ""} onClick={() => { setMode("signUp"); setMessage(""); }}>Create account</button></div><span className="section-label">{mode === "signIn" ? "Welcome back" : "Your field profile"}</span><h2>{mode === "signIn" ? "Sign in to Grounded" : "Create your account"}</h2>{mode === "signUp" && <label>Full name<input name="name" autoComplete="name" minLength={2} maxLength={80} required placeholder="e.g. Alex Morgan"/></label>}<label>Email address<input name="email" type="email" autoComplete="email" maxLength={180} required placeholder="you@example.com"/></label><label>Password<input name="password" type="password" autoComplete={mode === "signIn" ? "current-password" : "new-password"} minLength={mode === "signUp" ? 10 : undefined} maxLength={128} required placeholder={mode === "signUp" ? "At least 10 characters" : "Your password"}/></label>{mode === "signUp" && <div className="two-col"><label>State or territory<select name="state" required>{states.slice(1).map((item) => <option key={item}>{item}</option>)}</select></label><label>Nearest town<input name="town" maxLength={80} required placeholder="e.g. Bendigo"/></label></div>}{message && <p className="form-error" role="alert">{message}</p>}<button className="button primary auth-submit" disabled={busy}>{busy ? "Please wait…" : mode === "signIn" ? "Sign in" : "Create account"} <Icon>→</Icon></button><a className="guest-link" href="/">Continue as a guest</a><small>Guest browsing is read-only. Your password is stored as a one-way hash.</small></form></section>;
}

function ProfilePage({ handle, data, signOut }: { handle: string; data: Snapshot; signOut: () => Promise<void> }) {
  const user = data.users.find((item) => item.handle === handle); if (!user) return <div className="empty page-empty"><h2>Profile not found</h2></div>;
  const answers = data.answers.filter((answer) => answer.author_id === user.id); const questions = data.questions.filter((question) => question.author_id === user.id); const best = data.questions.filter((question) => answers.some((answer) => answer.id === question.selected_answer_id)).length; const likes = user.base_likes + data.votes.filter((vote) => vote.value === 1 && answers.some((answer) => answer.id === vote.answer_id)).length;
  const ownProfile = user.id === data.currentUserId;
  return <><section className="profile-hero"><div className={`avatar profile-avatar avatar-${user.id}`}>{user.initials}</div><div><span className="kicker">{user.verified ? "Verified agricultural expert" : level(user.xp)}</span><h1>{user.name} {Boolean(user.verified) && <i className="verified">✓</i>}</h1><p>@{user.handle} · <Icon>⌖</Icon> {user.town}, {user.state}</p></div>{ownProfile ? <button className="button outline" onClick={signOut}>Log out &amp; continue as guest</button> : <button className="button outline">Follow</button>}</section><section className="profile-grid"><div><div className="profile-about"><span className="section-label">About</span><p>{user.bio}</p><dl><div><dt>Specialties</dt><dd>{user.specialties}</dd></div><div><dt>Experience</dt><dd>{user.years} years</dd></div></dl></div><div className="section-heading"><div><span className="section-label">Contributions</span><h2>Field activity</h2></div></div>{questions.map((question) => <QuestionCard question={question} data={data} key={question.id}/>)}{answers.map((answer) => { const question = data.questions.find((item) => item.id === answer.question_id); return question && <a className="profile-answer" href={`/questions/${question.slug}`} key={answer.id}><span>Answer to</span><h3>{question.title}</h3><p>{answer.body}</p><strong>{score(answer, data.votes)} votes · {question.selected_answer_id === answer.id ? "Selected answer" : "Community answer"}</strong></a>; })}</div><aside className="profile-aside"><div className="xp-card"><span className="section-label">Community standing</span><strong>{user.xp}</strong><small>experience points</small><div className="xp-track"><span style={{ width: `${Math.min(100, user.xp >= 200 ? 100 : user.xp / 2)}%` }}/></div><p>{level(user.xp)} {user.verified && "· Verified independently"}</p></div><div className="stat-grid"><div><strong>{answers.length}</strong><small>answers</small></div><div><strong>{best}</strong><small>best answers</small></div><div><strong>{likes.toLocaleString("en-AU")}</strong><small>helpful votes</small></div><div><strong>{user.followers}</strong><small>followers</small></div></div></aside></section></>;
}

function Leaderboard({ data }: { data: Snapshot }) {
  const sorted = [...data.users].sort((a, b) => b.xp - a.xp);
  return <section className="leaderboard-page"><div className="leaderboard-intro"><span className="kicker">Knowledge shared generously</span><h1>Community<br/><em>standouts.</em></h1><p>Experience points recognise practical answers, helpful votes and solutions selected by question authors.</p></div><div className="leaderboard-table"><div className="table-head"><span>Rank</span><span>Contributor</span><span>Expertise</span><span>Answers</span><span>XP</span></div>{sorted.map((user, index) => { const answerCount = data.answers.filter((answer) => answer.author_id === user.id).length; return <a href={`/people/${user.handle}`} className={index < 3 ? "podium" : ""} key={user.id}><span className="leader-number">{String(index + 1).padStart(2, "0")}</span><span className="leader-person"><span className={`avatar avatar-${user.id}`}>{user.initials}</span><span><strong>{user.name} {Boolean(user.verified) && <i className="verified">✓</i>}</strong><small>{user.town}, {user.state}</small></span></span><span>{user.specialties}</span><span>{answerCount}</span><b>{user.xp} XP</b></a>; })}</div></section>;
}

export default function Community({ view, slug = "", handle = "" }: { view: View; slug?: string; handle?: string }) {
  const [data, setData] = useState<Snapshot | null>(null); const [toast, setToast] = useState("");
  const load = useCallback(async () => { const response = await fetch("/api/community", { cache: "no-store" }); if (response.ok) setData(await response.json()); }, []);
  useEffect(() => { load(); }, [load]);
  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 2600); };
  const act = useCallback(async (body: Record<string, unknown>) => { const response = await fetch("/api/community", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); const result = await response.json() as Record<string, unknown>; if (!response.ok) { notify(String(result.error ?? "Something went wrong.")); return null; } notify(body.action === "report" ? "Report received. Thank you." : "Saved to the community."); if (body.action !== "view") await load(); return result; }, [load]);
  const signOut = async () => { await fetch("/api/community", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "signOut" }) }); window.location.href = "/"; };
  const upload = async (file: File) => { const form = new FormData(); form.set("image", file); const response = await fetch("/api/upload", { method: "POST", body: form }); const result = await response.json(); if (!response.ok) { notify(result.error ?? "Image upload failed."); return null; } return result.url as string; };
  return <Shell data={data} toast={toast}>{!data ? <section className="loading"><span className="brand-mark">G</span><p>Gathering field knowledge…</p></section> : view === "home" ? <Home data={data}/> : view === "ask" ? <AskPage data={data} act={act} upload={upload}/> : view === "question" ? <QuestionPage slug={slug} data={data} act={act} upload={upload}/> : view === "search" ? <SearchPage data={data}/> : view === "profile" ? <ProfilePage handle={handle} data={data} signOut={signOut}/> : view === "auth" ? <AuthPage data={data}/> : <Leaderboard data={data}/>}</Shell>;
}
