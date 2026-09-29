CREATE TABLE `answer_revisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`answer_id` integer NOT NULL,
	`content` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `revisions_answer` ON `answer_revisions` (`answer_id`);--> statement-breakpoint
CREATE TABLE `expert_applications` (
	`user_id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`evidence` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`review_note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`reviewed_at` text
);
--> statement-breakpoint
CREATE TABLE `moderation_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`moderator_id` text NOT NULL,
	`action` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`message` text NOT NULL,
	`href` text NOT NULL,
	`event_key` text NOT NULL,
	`read_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_user_event` ON `notifications` (`user_id`,`event_key`);--> statement-breakpoint
CREATE INDEX `notifications_recipient` ON `notifications` (`user_id`,`id`);--> statement-breakpoint
CREATE TABLE `user_follows` (
	`follower_id` text NOT NULL,
	`followed_id` text NOT NULL,
	PRIMARY KEY(`follower_id`, `followed_id`)
);
--> statement-breakpoint
ALTER TABLE `answers` ADD `hidden` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `answers` ADD `deleted` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `answers` ADD `video_url` text;--> statement-breakpoint
ALTER TABLE `answers` ADD `relationship` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `answers` ADD `updated_at` text;--> statement-breakpoint
ALTER TABLE `answers` ADD `request_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `answers_request_key_unique` ON `answers` (`request_key`);--> statement-breakpoint
ALTER TABLE `comments` ADD `hidden` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `comments` ADD `request_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `comments_request_key_unique` ON `comments` (`request_key`);--> statement-breakpoint
ALTER TABLE `invitations` ADD `status` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `questions` ADD `context` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `questions` ADD `hidden` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `questions` ADD `outcome` text DEFAULT 'not_reported' NOT NULL;--> statement-breakpoint
ALTER TABLE `questions` ADD `outcome_note` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `questions` ADD `outcome_at` text;--> statement-breakpoint
ALTER TABLE `questions` ADD `updated_at` text;--> statement-breakpoint
ALTER TABLE `questions` ADD `request_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `questions_request_key_unique` ON `questions` (`request_key`);--> statement-breakpoint
ALTER TABLE `reports` ADD `resolution` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `reports` ADD `reviewed_at` text;--> statement-breakpoint
ALTER TABLE `users` ADD `avatar_url` text;--> statement-breakpoint
ALTER TABLE `users` ADD `categories` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `service_states` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `verified_scope` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `verification_basis` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `verified_at` text;--> statement-breakpoint
ALTER TABLE `users` ADD `demo` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `moderator` integer DEFAULT 0 NOT NULL;