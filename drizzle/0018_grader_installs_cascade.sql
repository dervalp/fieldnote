ALTER TABLE "grader_installs" DROP CONSTRAINT "grader_installs_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "grader_installs" ADD CONSTRAINT "grader_installs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;