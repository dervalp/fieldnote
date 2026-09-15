ALTER TABLE "grade_runs" DROP CONSTRAINT "grade_runs_state";--> statement-breakpoint
ALTER TABLE "grade_runs" DROP CONSTRAINT "grade_runs_result";--> statement-breakpoint
ALTER TABLE "grade_runs" ADD CONSTRAINT "grade_runs_state" CHECK ("grade_runs"."state" IN ('queued','running','complete','failed','insufficient'));--> statement-breakpoint
-- A floor miss is not a failure. An insufficient run stores its full result
-- with a null score, so the grader's own sentence and its measurements reach
-- a reader. A collection failure still stores nothing: its check results
-- failed because the evidence was missing, not because the repository is
-- lacking.
ALTER TABLE "grade_runs" ADD CONSTRAINT "grade_runs_result" CHECK (("grade_runs"."state" = 'complete' AND "grade_runs"."sha" IS NOT NULL AND "grade_runs"."completed_at" IS NOT NULL AND "grade_runs"."result" IS NOT NULL AND "grade_runs"."result"->>'score' IS NOT NULL) OR ("grade_runs"."state" = 'insufficient' AND "grade_runs"."sha" IS NOT NULL AND "grade_runs"."completed_at" IS NOT NULL AND "grade_runs"."result" IS NOT NULL AND "grade_runs"."result"->>'score' IS NULL) OR ("grade_runs"."state" NOT IN ('complete','insufficient') AND "grade_runs"."result" IS NULL));