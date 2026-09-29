"use client";
export default function ErrorPage({reset}:{reset:()=>void}) {
  return <section className="empty-state" role="alert"><h1>We could not load this page</h1><p>Please try again in a moment.</p><button className="button primary" onClick={reset}>Try again</button><a href="/">Back to questions</a></section>;
}
