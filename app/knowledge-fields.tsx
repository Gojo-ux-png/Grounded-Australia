import { categories, states, type Question, type User } from "./lib/community-model";

type Props = {
  question?: Question;
  current?: User;
  draft: Record<string, string> | null;
  category: string;
  setCategory: (value: string) => void;
  uploadsEnabled: boolean;
};

export default function KnowledgeFields({ question, current, draft, category, setCategory, uploadsEnabled }: Props) {
  const context = question?.context || {};
  const fieldNotes = [
    ["subject", category === "Livestock" ? "Animal and breed" : "Crop, variety or system"],
    ["stage", "Growth or production stage"],
    ["started", "Timing"],
    ["extent", "Area or scale"],
    ["conditions", "Weather, soil or housing conditions"],
    ["tried", "What you tried"],
  ];
  return <div className="knowledge-layout">
    <div className="knowledge-writing">
      <section className="knowledge-paper" aria-labelledby="article-heading">
        <div className="knowledge-section-heading"><span className="kicker">01 / Write</span><h2 id="article-heading">Your article</h2><p>Share something useful from the field.</p></div>
        <label className="knowledge-title">Article title<input name="title" required minLength={12} maxLength={160} defaultValue={question?.title || draft?.title || ""} placeholder="Give your knowledge a clear title"/><small>12–160 characters</small></label>
        <label className="knowledge-body">Article content<textarea name="body" rows={14} required minLength={30} maxLength={5000} defaultValue={question?.body || draft?.body || ""} placeholder={"Start with the key takeaway.\n\nExplain the practical steps, where they apply and what you learned. Include any sources or limitations."}/><small>30–5,000 characters · Paragraph breaks are preserved.</small></label>
      </section>
      <details className="knowledge-extra" open={Boolean(question?.image_url || question?.video_url || context.imageCaption || draft?.imageCaption || draft?.videoUrl)}>
        <summary><span>Photo &amp; video<small>Optional · support your article with media</small></span><span className="knowledge-expand" aria-hidden="true">＋</span></summary>
        <div className="knowledge-extra-body">
          {question?.image_url && <div className="knowledge-current-photo"><img src={question.image_url} alt="Current article photo"/><label className="check-label"><input type="checkbox" name="removeImage"/>Remove current photo</label></div>}
          {uploadsEnabled ? <label>Article photo<input name="image" type="file" accept="image/jpeg,image/png,image/webp"/><small>JPEG, PNG or WebP · up to 5 MB. Choose the photo again if you reopen a draft.</small></label> : <p>Photo uploads are not enabled yet.</p>}
          <label>Photo caption / credit<input name="imageCaption" maxLength={300} defaultValue={context.imageCaption || draft?.imageCaption || ""} placeholder="Describe the photo and credit the photographer"/><small>Optional · appears below the article photo. Up to 300 characters.</small></label>
          <label>Video link<input name="videoUrl" type="url" defaultValue={question?.video_url || draft?.videoUrl || ""} placeholder="https://…"/><small>Use a secure HTTPS link.</small></label>
        </div>
      </details>
      <details className="knowledge-extra" open={fieldNotes.some(([name]) => Boolean(context[name] || draft?.[name]))}>
        <summary><span>Field notes<small>Optional · add specific growing conditions</small></span><span className="knowledge-expand" aria-hidden="true">＋</span></summary>
        <div className="knowledge-extra-body"><div className="two-col">{fieldNotes.map(([name, label]) => <label key={name}>{label}<input name={name} maxLength={500} defaultValue={context[name] || draft?.[name] || ""}/></label>)}</div></div>
      </details>
    </div>
    <aside className="knowledge-settings" aria-label="Publication settings">
      <section className="knowledge-settings-card">
        <div className="knowledge-section-heading"><span className="kicker">02 / Publish</span><h2>Publication details</h2><p>Help readers find your article.</p></div>
        <label>Category<select name="category" value={category} onChange={event => setCategory(event.target.value)}>{categories.map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Tags <span className="knowledge-optional">Optional</span><input name="tags" maxLength={180} defaultValue={question?.tags.join(", ") || draft?.tags || ""} placeholder="e.g. soil, wheat, water"/><small>Separate tags with commas. Up to 5 tags.</small></label>
        <div className="knowledge-location"><h3>Where it applies</h3><label>State or territory<select name="state" required defaultValue={question?.state || draft?.state || current?.state || ""}><option value="">Choose a state</option>{states.map(value => <option key={value}>{value}</option>)}</select></label><label>Town or region<input name="town" required maxLength={80} defaultValue={question?.town || draft?.town || current?.town || ""} placeholder="e.g. Horsham"/><small>Use a public region, not a street address.</small></label></div>
        <div className="knowledge-publish"><div className="knowledge-visibility"><span aria-hidden="true">◉</span><div><strong>Public article</strong><small>{question ? "Saved changes are visible immediately." : "Your article goes live when you publish."}</small></div></div><button className="button primary" type="submit">{question ? "Save changes" : "Publish knowledge"}<span aria-hidden="true">↗</span></button><p>Title, content, category and location are required.</p></div>
      </section>
    </aside>
  </div>;
}
