// Bounded cleanup of expired credentials. User content and media are retained.
export async function maintain(env: CloudflareEnv) {
  const now=new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM account_tokens WHERE id IN (SELECT id FROM account_tokens WHERE expires_at<? LIMIT 1000)").bind(now),
    env.DB.prepare("DELETE FROM sessions WHERE id IN (SELECT id FROM sessions WHERE expires_at<? LIMIT 1000)").bind(now),
  ]);
}
