import { env } from "cloudflare:workers";
import { failure, limit, RequestError } from "@/app/lib/runtime";
import { readLimited, sameOrigin } from "@/app/lib/server-input";
import { currentUserId, isModerator } from "@/db/community";
import { cancelRewardOrder, redeemReward, rewardIdentity, rewardsSnapshot, reviewRewardOrder, saveReward } from "@/db/rewards";

const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  try { return Response.json(await rewardsSnapshot(request), { headers }); }
  catch (cause) { return failure(cause, "rewards_read"); }
}

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) throw new RequestError("This request must come from Grounded.", 403);
    if (!request.headers.get("content-type")?.includes("application/json")) throw new RequestError("Use a JSON request.", 415);
    const body = JSON.parse(new TextDecoder().decode(await readLimited(request, 24000))) as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new RequestError("Use a JSON object.");
    const actor = await currentUserId(request);
    if (!actor) throw new RequestError("Sign in to manage rewards.", 401);
    await limit(env.WRITE_LIMITER, `user:${actor}`);
    if (body.action === "cancelOrder") return Response.json(await cancelRewardOrder(actor, body), { headers });
    const identity = await rewardIdentity(actor);
    if (!identity.canRedeem) throw new RequestError("Use a real account with a verified email to earn and redeem points.", 403);
    if (body.action === "redeem") return Response.json(await redeemReward(actor, body), { headers });
    if (body.action === "saveReward" || body.action === "reviewOrder") {
      if (!await isModerator(actor)) throw new RequestError("Reviewer access required.", 403);
      return Response.json(body.action === "saveReward" ? await saveReward(body) : await reviewRewardOrder(actor, body), { headers });
    }
    throw new RequestError("Unknown rewards action.");
  } catch (cause) { return failure(cause, "rewards_write"); }
}
