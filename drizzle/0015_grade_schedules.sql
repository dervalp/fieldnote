CREATE TABLE "grade_schedules" (
	"repository_id" text NOT NULL,
	"grader_id" text NOT NULL,
	"enabled_by" text NOT NULL,
	"workspace_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grade_schedules_repository_id_grader_id_pk" PRIMARY KEY("repository_id","grader_id")
);
--> statement-breakpoint
ALTER TABLE "grade_schedules" ADD CONSTRAINT "grade_schedules_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade_schedules" ADD CONSTRAINT "grade_schedules_enabled_by_users_id_fk" FOREIGN KEY ("enabled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade_schedules" ADD CONSTRAINT "grade_schedules_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Every existing run was clicked by somebody, which is what the default says.
ALTER TABLE "grade_runs" ADD COLUMN "trigger" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "grade_runs" ADD CONSTRAINT "grade_runs_trigger" CHECK ("grade_runs"."trigger" IN ('manual','schedule'));
