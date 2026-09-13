ALTER TABLE "grading_rubrics" RENAME COLUMN "family" TO "grader_id";--> statement-breakpoint
ALTER TABLE "grade_runs" RENAME COLUMN "family" TO "grader_id";--> statement-breakpoint
ALTER TABLE "grading_rubrics" DROP CONSTRAINT "grading_rubrics_family_version_pk";--> statement-breakpoint
ALTER TABLE "grading_rubrics" ADD CONSTRAINT "grading_rubrics_grader_id_version_pk" PRIMARY KEY("grader_id","version");--> statement-breakpoint
-- A grader id is namespaced by owner, because a marketplace has two people who
-- both want the name `test-coverage`. Existing rows predate the namespace and
-- all belong to fieldnote's own grader.
UPDATE "grading_rubrics" SET "grader_id" = 'fieldnote/' || "grader_id" WHERE "grader_id" NOT LIKE '%/%';--> statement-breakpoint
UPDATE "grade_runs" SET "grader_id" = 'fieldnote/' || "grader_id" WHERE "grader_id" NOT LIKE '%/%';--> statement-breakpoint
ALTER TABLE "grading_rubrics" ADD COLUMN "manifest" jsonb;--> statement-breakpoint
-- Registered rubrics that predate the contract carry no manifest, and no grade
-- can validate against one. registerRubric() writes them back on the next
-- request; completed runs are read without re-validation and are unaffected.
DELETE FROM "grading_rubrics" WHERE "manifest" IS NULL;--> statement-breakpoint
ALTER TABLE "grading_rubrics" ALTER COLUMN "manifest" SET NOT NULL;--> statement-breakpoint
DROP INDEX "grade_runs_one_active";--> statement-breakpoint
CREATE UNIQUE INDEX "grade_runs_one_active" ON "grade_runs" USING btree ("repository_id","grader_id") WHERE "grade_runs"."state" IN ('queued','running');
