CREATE TABLE "authored_pull_request_repairs" (
	"id" text PRIMARY KEY NOT NULL,
	"authored_pull_request_id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"trigger_kind" text NOT NULL,
	"trigger_reference" text NOT NULL,
	"state" text NOT NULL,
	"base_head_sha" text NOT NULL,
	"result_head_sha" text,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "authored_pull_request_repairs_ordinal" CHECK ("authored_pull_request_repairs"."ordinal" BETWEEN 1 AND 3),
	CONSTRAINT "authored_pull_request_repairs_state" CHECK ("authored_pull_request_repairs"."state" IN ('queued','running','complete','failed'))
);
--> statement-breakpoint
CREATE TABLE "authored_pull_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"authoring_run_id" text NOT NULL,
	"repository_id" text NOT NULL,
	"number" integer NOT NULL,
	"branch" text NOT NULL,
	"head_sha" text NOT NULL,
	"url" text NOT NULL,
	"outcome" text NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"merged_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	CONSTRAINT "authored_pull_requests_authoring_run_id_unique" UNIQUE("authoring_run_id"),
	CONSTRAINT "authored_pull_requests_number_positive" CHECK ("authored_pull_requests"."number" > 0),
	CONSTRAINT "authored_pull_requests_outcome" CHECK ("authored_pull_requests"."outcome" IN ('open','merged','closed'))
);
--> statement-breakpoint
CREATE TABLE "authoring_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"authoring_run_id" text NOT NULL,
	"speaker" text NOT NULL,
	"kind" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "authoring_notes_speaker" CHECK ("authoring_notes"."speaker" IN ('agent','human')),
	CONSTRAINT "authoring_notes_kind" CHECK ("authoring_notes"."kind" IN ('finding','question','answer','remark'))
);
--> statement-breakpoint
CREATE TABLE "fieldnote_setup_files" (
	"id" text PRIMARY KEY NOT NULL,
	"proposal_run_id" text NOT NULL,
	"path" text NOT NULL,
	"kind" text NOT NULL,
	"body" text NOT NULL,
	"hash" text NOT NULL,
	CONSTRAINT "fieldnote_setup_files_kind" CHECK ("fieldnote_setup_files"."kind" IN ('profile','definition-of-done','concern'))
);
--> statement-breakpoint
CREATE TABLE "fieldnote_setup_proposals" (
	"authoring_run_id" text PRIMARY KEY NOT NULL,
	"repository_sha" text NOT NULL,
	"skills_release" text NOT NULL,
	"skills_revision" text NOT NULL,
	"release_lock_hash" text NOT NULL,
	"detected_agents" jsonb NOT NULL,
	"confirmed_agents" jsonb,
	"state" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fieldnote_setup_proposals_state" CHECK ("fieldnote_setup_proposals"."state" IN ('exploring','awaiting-input','ready'))
);
--> statement-breakpoint
CREATE TABLE "repository_fieldnote_installations" (
	"repository_id" text PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"release" text NOT NULL,
	"revision" text NOT NULL,
	"lock_hash" text NOT NULL,
	"agents" jsonb NOT NULL,
	"commit_sha" text NOT NULL,
	"reasons" jsonb NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	CONSTRAINT "repository_fieldnote_installations_state" CHECK ("repository_fieldnote_installations"."state" IN ('current','outdated','partial','drifted'))
);
--> statement-breakpoint
ALTER TABLE "authoring_runs" ADD COLUMN "workflow" text DEFAULT 'readiness-remediation' NOT NULL;--> statement-breakpoint
ALTER TABLE "authoring_runs" ADD COLUMN "plan_run_id" text;--> statement-breakpoint
ALTER TABLE "authored_pull_request_repairs" ADD CONSTRAINT "authored_pull_request_repairs_authored_pull_request_id_authored_pull_requests_id_fk" FOREIGN KEY ("authored_pull_request_id") REFERENCES "public"."authored_pull_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authored_pull_requests" ADD CONSTRAINT "authored_pull_requests_authoring_run_id_authoring_runs_id_fk" FOREIGN KEY ("authoring_run_id") REFERENCES "public"."authoring_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authored_pull_requests" ADD CONSTRAINT "authored_pull_requests_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authoring_notes" ADD CONSTRAINT "authoring_notes_authoring_run_id_authoring_runs_id_fk" FOREIGN KEY ("authoring_run_id") REFERENCES "public"."authoring_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fieldnote_setup_files" ADD CONSTRAINT "fieldnote_setup_files_proposal_run_id_fieldnote_setup_proposals_authoring_run_id_fk" FOREIGN KEY ("proposal_run_id") REFERENCES "public"."fieldnote_setup_proposals"("authoring_run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fieldnote_setup_proposals" ADD CONSTRAINT "fieldnote_setup_proposals_authoring_run_id_authoring_runs_id_fk" FOREIGN KEY ("authoring_run_id") REFERENCES "public"."authoring_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_fieldnote_installations" ADD CONSTRAINT "repository_fieldnote_installations_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "authored_pull_request_repairs_order" ON "authored_pull_request_repairs" USING btree ("authored_pull_request_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "authored_pull_requests_number" ON "authored_pull_requests" USING btree ("repository_id","number");--> statement-breakpoint
CREATE INDEX "authoring_notes_order" ON "authoring_notes" USING btree ("authoring_run_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "fieldnote_setup_files_path" ON "fieldnote_setup_files" USING btree ("proposal_run_id","path");--> statement-breakpoint
ALTER TABLE "authoring_runs" ADD CONSTRAINT "authoring_runs_plan_run_id_authoring_runs_id_fk" FOREIGN KEY ("plan_run_id") REFERENCES "public"."authoring_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "authoring_runs_one_execute_per_plan" ON "authoring_runs" USING btree ("plan_run_id") WHERE "authoring_runs"."kind" = 'execute';--> statement-breakpoint
ALTER TABLE "authoring_runs" ADD CONSTRAINT "authoring_runs_workflow" CHECK ("authoring_runs"."workflow" IN ('readiness-remediation','fieldnote-setup'));--> statement-breakpoint
ALTER TABLE "authoring_runs" ADD CONSTRAINT "authoring_runs_plan_link" CHECK (("authoring_runs"."kind" = 'plan' AND "authoring_runs"."plan_run_id" IS NULL) OR ("authoring_runs"."kind" = 'execute' AND "authoring_runs"."plan_run_id" IS NOT NULL AND "authoring_runs"."plan_run_id" <> "authoring_runs"."id"));