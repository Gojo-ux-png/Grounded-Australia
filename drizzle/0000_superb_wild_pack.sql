CREATE TABLE `answers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`question_id` integer NOT NULL,
	`author_id` text NOT NULL,
	`body` text NOT NULL,
	`citation_url` text,
	`product_name` text,
	`commercial` integer DEFAULT false NOT NULL,
	`image_url` text,
	`base_score` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `bookmarks` (
	`user_id` text NOT NULL,
	`question_id` integer NOT NULL,
	PRIMARY KEY(`user_id`, `question_id`)
);
--> statement-breakpoint
CREATE TABLE `comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`answer_id` integer NOT NULL,
	`author_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `invitations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`question_id` integer NOT NULL,
	`inviter_id` text NOT NULL,
	`expert_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `question_follows` (
	`user_id` text NOT NULL,
	`question_id` integer NOT NULL,
	PRIMARY KEY(`user_id`, `question_id`)
);
--> statement-breakpoint
CREATE TABLE `questions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`author_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`category` text NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`state` text NOT NULL,
	`town` text NOT NULL,
	`image_url` text,
	`video_url` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`views` integer DEFAULT 0 NOT NULL,
	`selected_answer_id` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `questions_slug_unique` ON `questions` (`slug`);--> statement-breakpoint
CREATE TABLE `reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`reporter_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` integer NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`handle` text NOT NULL,
	`name` text NOT NULL,
	`initials` text NOT NULL,
	`role` text NOT NULL,
	`verified` integer DEFAULT false NOT NULL,
	`state` text NOT NULL,
	`town` text NOT NULL,
	`bio` text NOT NULL,
	`specialties` text NOT NULL,
	`years` integer DEFAULT 0 NOT NULL,
	`xp` integer DEFAULT 0 NOT NULL,
	`followers` integer DEFAULT 0 NOT NULL,
	`following` integer DEFAULT 0 NOT NULL,
	`base_likes` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_handle_unique` ON `users` (`handle`);--> statement-breakpoint
CREATE TABLE `votes` (
	`user_id` text NOT NULL,
	`answer_id` integer NOT NULL,
	`value` integer NOT NULL,
	PRIMARY KEY(`user_id`, `answer_id`)
);
--> statement-breakpoint
CREATE TABLE `xp_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`related_id` integer NOT NULL,
	`points` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
