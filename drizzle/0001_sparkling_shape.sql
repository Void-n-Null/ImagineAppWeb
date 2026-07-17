DROP INDEX "ledger_user_grant_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_spend_generation_idx" ON "ledger" USING btree (("meta" ->> 'generationId')) WHERE "ledger"."kind" = 'spend' AND "ledger"."meta" ->> 'generationId' IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_user_grant_idx" ON "ledger" USING btree ("user_id") WHERE "ledger"."kind" = 'grant';