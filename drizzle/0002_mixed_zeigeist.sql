CREATE TABLE "channel_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" varchar(20) DEFAULT 'member' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "channel_members_channel_user_unique" UNIQUE("channel_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "meeting_minutes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"topic" text NOT NULL,
	"transcript" text NOT NULL,
	"participants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"total_turns" integer DEFAULT 0 NOT NULL,
	"duration_seconds" integer,
	"initiator_id" uuid,
	"key_topics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"conclusions" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"npc_id" uuid NOT NULL,
	"assigner_id" uuid NOT NULL,
	"npc_task_id" varchar(64) NOT NULL,
	"title" varchar(200) NOT NULL,
	"summary" text,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "chat_messages" DROP CONSTRAINT "chat_messages_npc_id_npcs_id_fk";
--> statement-breakpoint
ALTER TABLE "npcs" DROP CONSTRAINT "npcs_map_id_maps_id_fk";
--> statement-breakpoint
ALTER TABLE "npcs" DROP CONSTRAINT "npcs_channel_id_channels_id_fk";
--> statement-breakpoint
DROP INDEX "idx_npcs_map_id";--> statement-breakpoint
ALTER TABLE "chat_messages" ALTER COLUMN "npc_id" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "npcs" ALTER COLUMN "id" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "npcs" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "npcs" ALTER COLUMN "channel_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "password" varchar(255);--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "gateway_config" jsonb;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "login_id" varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE "channel_members" ADD CONSTRAINT "channel_members_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_members" ADD CONSTRAINT "channel_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_minutes" ADD CONSTRAINT "meeting_minutes_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_minutes" ADD CONSTRAINT "meeting_minutes_initiator_id_users_id_fk" FOREIGN KEY ("initiator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_npc_id_npcs_id_fk" FOREIGN KEY ("npc_id") REFERENCES "public"."npcs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigner_id_characters_id_fk" FOREIGN KEY ("assigner_id") REFERENCES "public"."characters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_channel_members_channel_id" ON "channel_members" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "idx_channel_members_user_id" ON "channel_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_meeting_minutes_channel" ON "meeting_minutes" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "idx_meeting_minutes_created" ON "meeting_minutes" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_tasks_channel" ON "tasks" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "idx_tasks_npc" ON "tasks" USING btree ("npc_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_tasks_npc_task_id" ON "tasks" USING btree ("npc_id","npc_task_id");--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_npc_id_npcs_id_fk" FOREIGN KEY ("npc_id") REFERENCES "public"."npcs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "npcs" ADD CONSTRAINT "npcs_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_npcs_channel_id" ON "npcs" USING btree ("channel_id");--> statement-breakpoint
ALTER TABLE "npcs" DROP COLUMN "map_id";--> statement-breakpoint
ALTER TABLE "npcs" ADD CONSTRAINT "npcs_channel_position_unique" UNIQUE("channel_id","position_x","position_y");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_login_id_unique" UNIQUE("login_id");