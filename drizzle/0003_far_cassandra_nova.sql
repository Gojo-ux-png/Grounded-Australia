CREATE TABLE `account_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`purpose` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text
);
--> statement-breakpoint
CREATE INDEX `account_tokens_expiry` ON `account_tokens` (`expires_at`);--> statement-breakpoint
CREATE INDEX `account_tokens_user` ON `account_tokens` (`user_id`);--> statement-breakpoint
CREATE TABLE `uploads` (
	`key` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `uploads_user_time` ON `uploads` (`user_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `accounts` ADD `email_verified_at` text;--> statement-breakpoint
CREATE INDEX `answers_question_visible` ON `answers` (`question_id`,`hidden`,`deleted`);--> statement-breakpoint
CREATE INDEX `answers_author` ON `answers` (`author_id`);--> statement-breakpoint
CREATE INDEX `comments_answer_visible` ON `comments` (`answer_id`,`hidden`);--> statement-breakpoint
CREATE INDEX `questions_feed` ON `questions` (`hidden`,`created_at`);--> statement-breakpoint
CREATE INDEX `questions_author` ON `questions` (`author_id`);--> statement-breakpoint
CREATE INDEX `sessions_expiry` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE INDEX `sessions_user` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `user_follows_target` ON `user_follows` (`followed_id`);--> statement-breakpoint
CREATE INDEX `votes_answer` ON `votes` (`answer_id`);