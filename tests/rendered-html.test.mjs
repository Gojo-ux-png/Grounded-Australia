import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("ships the Grounded Australia community shell", async () => {
  const [community, layout] = await Promise.all([
    readFile(new URL("../app/community.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(community, /Grounded/);
  assert.match(community, /Visitor · read only/);
  assert.match(layout, /Practical knowledge, rooted in place/);
  assert.doesNotMatch(`${community}\n${layout}`, /codex-preview|react-loading-skeleton/);
});

test("includes every public product route", async () => {
  for (const path of ["../app/ask/page.tsx", "../app/search/page.tsx", "../app/leaderboard/page.tsx", "../app/questions/[slug]/page.tsx", "../app/people/[handle]/page.tsx"]) {
    await access(new URL(path, import.meta.url));
  }
});

test("keeps durable state and media on platform bindings", async () => {
  const [hosting, schema, api] = await Promise.all([
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/community/route.ts", import.meta.url), "utf8"),
  ]);
  const bindings = JSON.parse(hosting);
  assert.equal(bindings.d1, "DB");
  assert.equal(bindings.r2, "MEDIA");
  assert.match(schema, /xp_events/);
  assert.match(api, /Only the question author can choose the best answer/);
  assert.match(api, /You cannot vote on your own answer/);
});

test("text-only question cards do not reserve an empty image column", async () => {
  const [community, styles] = await Promise.all([
    readFile(new URL("../app/community.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(community, /question\.image_url \? "has-image" : "no-image"/);
  assert.match(styles, /\.question-card\.no-image\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
});
