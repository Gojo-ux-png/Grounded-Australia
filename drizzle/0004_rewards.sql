CREATE TABLE `reward_items` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`kind` text NOT NULL,
	`points` integer NOT NULL,
	`total_stock` integer NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`demo` integer DEFAULT 0 NOT NULL,
	`partner` text DEFAULT '' NOT NULL,
	`fulfillment` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "reward_items_kind" CHECK("reward_items"."kind" IN ('product','coupon','consultation')),
	CONSTRAINT "reward_items_points" CHECK("reward_items"."points" > 0 AND typeof("reward_items"."points") = 'integer'),
	CONSTRAINT "reward_items_stock" CHECK("reward_items"."total_stock" >= 0 AND typeof("reward_items"."total_stock") = 'integer'),
	CONSTRAINT "reward_items_flags" CHECK("reward_items"."active" IN (0,1) AND "reward_items"."demo" IN (0,1))
);
--> statement-breakpoint
CREATE TABLE `reward_order_events` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`status` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `reward_orders`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "reward_events_status" CHECK("reward_order_events"."status" IN ('pending','fulfilled','cancelled','rejected'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reward_events_order_status` ON `reward_order_events` (`order_id`,`status`);--> statement-breakpoint
CREATE TABLE `reward_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`reward_id` text NOT NULL,
	`item_name` text NOT NULL,
	`item_kind` text NOT NULL,
	`points` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`request_key` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`fulfillment_note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`reviewed_by` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reward_id`) REFERENCES `reward_items`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "reward_orders_points" CHECK("reward_orders"."points" > 0 AND typeof("reward_orders"."points") = 'integer'),
	CONSTRAINT "reward_orders_kind" CHECK("reward_orders"."item_kind" IN ('product','coupon','consultation')),
	CONSTRAINT "reward_orders_status" CHECK("reward_orders"."status" IN ('pending','fulfilled','cancelled','rejected'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reward_orders_request` ON `reward_orders` (`user_id`,`request_key`);--> statement-breakpoint
CREATE INDEX `reward_orders_user_status` ON `reward_orders` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `reward_orders_item_status` ON `reward_orders` (`reward_id`,`status`);--> statement-breakpoint
CREATE INDEX `reward_orders_queue` ON `reward_orders` (`status`,`created_at`);
--> statement-breakpoint
INSERT INTO reward_items (id,name,description,kind,points,total_stock,active,demo,partner,fulfillment) VALUES
  ('demo-reward-soil-test','Soil test voucher','Preview example: a voucher towards a basic soil test. No supplier offer or commercial partnership is active.','coupon',100,0,1,1,'','Example only. This item cannot be redeemed.'),
  ('demo-reward-field-kit','Field notebook and gloves','Preview example: practical supplies for recording observations in the field. No supplier offer or commercial partnership is active.','product',150,0,1,1,'','Example only. This item cannot be redeemed.'),
  ('demo-reward-supplies-voucher','Farm supplies voucher','Preview example: a discount voucher for everyday agricultural supplies. No supplier offer or commercial partnership is active.','coupon',200,0,1,1,'','Example only. This item cannot be redeemed.');
