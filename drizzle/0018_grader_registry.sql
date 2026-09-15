CREATE TABLE "grader_installs" (
	"workspace_id" text NOT NULL,
	"grader_id" text NOT NULL,
	"version" text NOT NULL,
	"installed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"consented_needs" text NOT NULL,
	CONSTRAINT "grader_installs_workspace_id_grader_id_pk" PRIMARY KEY("workspace_id","grader_id")
);
--> statement-breakpoint
CREATE TABLE "grader_versions" (
	"grader_id" text NOT NULL,
	"version" text NOT NULL,
	"evaluator_version" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"published_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_at" timestamp with time zone,
	"verified_by" text,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_note" text,
	CONSTRAINT "grader_versions_grader_id_version_pk" PRIMARY KEY("grader_id","version")
);
--> statement-breakpoint
CREATE TABLE "graders" (
	"id" text PRIMARY KEY NOT NULL,
	"owned_by_workspace_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "grading_rubrics" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "grading_rubrics" CASCADE;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "staff" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "handle" text;--> statement-breakpoint
ALTER TABLE "grader_installs" ADD CONSTRAINT "grader_installs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grader_installs" ADD CONSTRAINT "grader_installs_grader_id_graders_id_fk" FOREIGN KEY ("grader_id") REFERENCES "public"."graders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grader_installs" ADD CONSTRAINT "grader_installs_installed_by_users_id_fk" FOREIGN KEY ("installed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grader_versions" ADD CONSTRAINT "grader_versions_grader_id_graders_id_fk" FOREIGN KEY ("grader_id") REFERENCES "public"."graders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grader_versions" ADD CONSTRAINT "grader_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grader_versions" ADD CONSTRAINT "grader_versions_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graders" ADD CONSTRAINT "graders_owned_by_workspace_id_workspaces_id_fk" FOREIGN KEY ("owned_by_workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_handle_unique" UNIQUE("handle");