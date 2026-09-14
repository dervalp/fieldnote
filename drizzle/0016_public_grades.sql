CREATE TABLE "public_grades" (
	"repository_id" text NOT NULL,
	"grader_id" text NOT NULL,
	"enabled_by" text NOT NULL,
	"workspace_id" text NOT NULL,
	"enabled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "public_grades_repository_id_grader_id_pk" PRIMARY KEY("repository_id","grader_id")
);
--> statement-breakpoint
ALTER TABLE "public_grades" ADD CONSTRAINT "public_grades_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_grades" ADD CONSTRAINT "public_grades_enabled_by_users_id_fk" FOREIGN KEY ("enabled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_grades" ADD CONSTRAINT "public_grades_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;