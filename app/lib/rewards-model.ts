export type RewardKind = "product" | "coupon" | "consultation";
export type RewardStatus = "pending" | "fulfilled" | "cancelled" | "rejected";
export type RewardItem = {
  id: string; revision: number; name: string; description: string; kind: RewardKind; points: number;
  total_stock: number; remaining_stock: number; active: number; demo: number;
  partner: string; fulfillment: string; created_at: string; updated_at: string;
};
export type RewardEvent = { id: string; status: RewardStatus; note: string; created_at: string };
export type RewardOrder = {
  id: string; user_id: string; reward_id: string; reward_revision: number; item_name: string; item_kind: RewardKind;
  points: number; status: RewardStatus; note: string; fulfillment_note: string;
  created_at: string; updated_at: string; reviewed_by: string | null; events: RewardEvent[];
  user_name?: string; contact_email?: string | null;
};
export type RewardWallet = {
  earned: number; spent: number; balance: number; available: number; deficit: number;
  answerPoints: number; votePoints: number; bestAnswerPoints: number;
};
export type RewardActivity = {
  id: string; kind: "answer" | "vote" | "bestAnswer"; points: number;
  question_id: number; question_slug: string; question_title: string; answer_id: number;
  created_at: string;
};
export type RewardsSnapshot = {
  config: { local: boolean; registrationOpen: boolean };
  currentUserId: string | null; isModerator: boolean; emailVerified: boolean; canRedeem: boolean;
  wallet: RewardWallet | null; catalog: RewardItem[]; activities: RewardActivity[]; orders: RewardOrder[];
  admin?: { catalog: RewardItem[]; orders: RewardOrder[] };
};
