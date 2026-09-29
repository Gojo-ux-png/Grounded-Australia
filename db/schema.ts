import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  handle: text("handle").notNull().unique(),
  name: text("name").notNull(),
  initials: text("initials").notNull(),
  role: text("role").notNull(),
  verified: integer("verified", { mode: "boolean" }).notNull().default(false),
  state: text("state").notNull(),
  town: text("town").notNull(),
  bio: text("bio").notNull(),
  specialties: text("specialties").notNull(),
  years: integer("years").notNull().default(0),
  xp: integer("xp").notNull().default(0),
  followers: integer("followers").notNull().default(0),
  following: integer("following").notNull().default(0),
  baseLikes: integer("base_likes").notNull().default(0),
  avatarUrl: text("avatar_url"),
  categories: text("categories").notNull().default("[]"),
  serviceStates: text("service_states").notNull().default("[]"),
  verifiedScope: text("verified_scope").notNull().default(""),
  verificationBasis: text("verification_basis").notNull().default(""),
  verifiedAt: text("verified_at"),
  demo: integer("demo").notNull().default(0),
  moderator: integer("moderator").notNull().default(0),
});

export const accounts = sqliteTable("accounts", {
  userId: text("user_id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  emailVerifiedAt: text("email_verified_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("sessions_expiry").on(table.expiresAt), index("sessions_user").on(table.userId)]);

export const questions = sqliteTable("questions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(),
  authorId: text("author_id").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  category: text("category").notNull(),
  tags: text("tags").notNull().default("[]"),
  state: text("state").notNull(),
  town: text("town").notNull(),
  imageUrl: text("image_url"),
  videoUrl: text("video_url"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  views: integer("views").notNull().default(0),
  selectedAnswerId: integer("selected_answer_id"),
  context: text("context").notNull().default("{}"),
  hidden: integer("hidden").notNull().default(0),
  outcome: text("outcome").notNull().default("not_reported"),
  outcomeNote: text("outcome_note").notNull().default(""),
  outcomeAt: text("outcome_at"),
  updatedAt: text("updated_at"),
  requestKey: text("request_key").unique(),
}, (table) => [index("questions_feed").on(table.hidden,table.createdAt), index("questions_author").on(table.authorId)]);

export const answers = sqliteTable("answers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  questionId: integer("question_id").notNull(),
  authorId: text("author_id").notNull(),
  body: text("body").notNull(),
  citationUrl: text("citation_url"),
  productName: text("product_name"),
  commercial: integer("commercial", { mode: "boolean" }).notNull().default(false),
  imageUrl: text("image_url"),
  baseScore: integer("base_score").notNull().default(0),
  hidden: integer("hidden").notNull().default(0),
  deleted: integer("deleted").notNull().default(0),
  videoUrl: text("video_url"),
  relationship: text("relationship").notNull().default("none"),
  updatedAt: text("updated_at"),
  requestKey: text("request_key").unique(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("answers_question_visible").on(table.questionId,table.hidden,table.deleted), index("answers_author").on(table.authorId)]);

export const comments = sqliteTable("comments", {
  hidden: integer("hidden").notNull().default(0),
  requestKey: text("request_key").unique(),
  id: integer("id").primaryKey({ autoIncrement: true }),
  answerId: integer("answer_id").notNull(),
  authorId: text("author_id").notNull(),
  body: text("body").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("comments_answer_visible").on(table.answerId,table.hidden)]);

export const votes = sqliteTable("votes", {
  userId: text("user_id").notNull(),
  answerId: integer("answer_id").notNull(),
  value: integer("value").notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.answerId] }), index("votes_answer").on(table.answerId)]);

export const bookmarks = sqliteTable("bookmarks", {
  userId: text("user_id").notNull(),
  questionId: integer("question_id").notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.questionId] })]);

export const questionFollows = sqliteTable("question_follows", {
  userId: text("user_id").notNull(),
  questionId: integer("question_id").notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.questionId] })]);

export const invitations = sqliteTable("invitations", {
  status: text("status").notNull().default("pending"),
  id: integer("id").primaryKey({ autoIncrement: true }),
  questionId: integer("question_id").notNull(),
  inviterId: text("inviter_id").notNull(),
  expertId: text("expert_id").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const reports = sqliteTable("reports", {
  resolution: text("resolution").notNull().default(""),
  reviewedAt: text("reviewed_at"),
  id: integer("id").primaryKey({ autoIncrement: true }),
  reporterId: text("reporter_id").notNull(),
  targetType: text("target_type").notNull(),
  targetId: integer("target_id").notNull(),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const xpEvents = sqliteTable("xp_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull(),
  kind: text("kind").notNull(),
  relatedId: integer("related_id").notNull(),
  points: integer("points").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const userFollows = sqliteTable("user_follows", {
  followerId: text("follower_id").notNull(),
  followedId: text("followed_id").notNull(),
}, (table) => [primaryKey({ columns: [table.followerId, table.followedId] }), index("user_follows_target").on(table.followedId)]);

export const notifications = sqliteTable("notifications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull(),
  message: text("message").notNull(),
  href: text("href").notNull(),
  eventKey: text("event_key").notNull(),
  readAt: text("read_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("notifications_user_event").on(table.userId, table.eventKey), index("notifications_recipient").on(table.userId, table.id)]);

export const expertApplications = sqliteTable("expert_applications", {
  userId: text("user_id").primaryKey(),
  scope: text("scope").notNull(),
  evidence: text("evidence").notNull(),
  status: text("status").notNull().default("pending"),
  reviewNote: text("review_note").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  reviewedAt: text("reviewed_at"),
});

export const moderationLog = sqliteTable("moderation_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  moderatorId: text("moderator_id").notNull(),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  reason: text("reason").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const answerRevisions = sqliteTable("answer_revisions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  answerId: integer("answer_id").notNull(),
  content: text("content").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("revisions_answer").on(table.answerId)]);

export const accountTokens = sqliteTable("account_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  purpose: text("purpose").notNull(),
  expiresAt: text("expires_at").notNull(),
  usedAt: text("used_at"),
}, table => [index("account_tokens_expiry").on(table.expiresAt), index("account_tokens_user").on(table.userId)]);

export const uploads = sqliteTable("uploads", {
  key: text("key").primaryKey(),
  userId: text("user_id").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [index("uploads_user_time").on(table.userId,table.createdAt)]);

export const rewardItems = sqliteTable("reward_items", {
  id: text("id").primaryKey(),
  revision: integer("revision").notNull().default(1),
  name: text("name").notNull(),
  description: text("description").notNull(),
  kind: text("kind").notNull(),
  points: integer("points").notNull(),
  totalStock: integer("total_stock").notNull(),
  active: integer("active").notNull().default(1),
  demo: integer("demo").notNull().default(0),
  partner: text("partner").notNull().default(""),
  fulfillment: text("fulfillment").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [
  check("reward_items_kind", sql`${table.kind} IN ('product','coupon','consultation')`),
  check("reward_items_points", sql`${table.points} > 0 AND typeof(${table.points}) = 'integer'`),
  check("reward_items_stock", sql`${table.totalStock} >= 0 AND typeof(${table.totalStock}) = 'integer'`),
  check("reward_items_flags", sql`${table.active} IN (0,1) AND ${table.demo} IN (0,1)`),
]);

export const rewardOrders = sqliteTable("reward_orders", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  rewardId: text("reward_id").notNull().references(() => rewardItems.id),
  rewardRevision: integer("reward_revision").notNull().default(1),
  itemName: text("item_name").notNull(),
  itemKind: text("item_kind").notNull(),
  points: integer("points").notNull(),
  status: text("status").notNull().default("pending"),
  requestKey: text("request_key").notNull(),
  note: text("note").notNull().default(""),
  fulfillmentNote: text("fulfillment_note").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  reviewedBy: text("reviewed_by"),
}, table => [
  uniqueIndex("reward_orders_request").on(table.userId, table.requestKey),
  index("reward_orders_user_status").on(table.userId, table.status),
  index("reward_orders_item_status").on(table.rewardId, table.status),
  index("reward_orders_queue").on(table.status, table.createdAt),
  check("reward_orders_points", sql`${table.points} > 0 AND typeof(${table.points}) = 'integer'`),
  check("reward_orders_kind", sql`${table.itemKind} IN ('product','coupon','consultation')`),
  check("reward_orders_status", sql`${table.status} IN ('pending','fulfilled','cancelled','rejected')`),
]);

export const rewardOrderEvents = sqliteTable("reward_order_events", {
  id: text("id").primaryKey(),
  orderId: text("order_id").notNull().references(() => rewardOrders.id),
  actorId: text("actor_id").notNull(),
  status: text("status").notNull(),
  note: text("note").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [
  uniqueIndex("reward_events_order_status").on(table.orderId, table.status),
  check("reward_events_status", sql`${table.status} IN ('pending','fulfilled','cancelled','rejected')`),
]);
