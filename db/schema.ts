import { sql } from "drizzle-orm";
import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
});

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
});

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
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const comments = sqliteTable("comments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  answerId: integer("answer_id").notNull(),
  authorId: text("author_id").notNull(),
  body: text("body").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const votes = sqliteTable("votes", {
  userId: text("user_id").notNull(),
  answerId: integer("answer_id").notNull(),
  value: integer("value").notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.answerId] })]);

export const bookmarks = sqliteTable("bookmarks", {
  userId: text("user_id").notNull(),
  questionId: integer("question_id").notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.questionId] })]);

export const questionFollows = sqliteTable("question_follows", {
  userId: text("user_id").notNull(),
  questionId: integer("question_id").notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.questionId] })]);

export const invitations = sqliteTable("invitations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  questionId: integer("question_id").notNull(),
  inviterId: text("inviter_id").notNull(),
  expertId: text("expert_id").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const reports = sqliteTable("reports", {
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
