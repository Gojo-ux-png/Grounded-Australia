ALTER TABLE `reward_items` ADD `revision` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `reward_orders` ADD `reward_revision` integer DEFAULT 1 NOT NULL;