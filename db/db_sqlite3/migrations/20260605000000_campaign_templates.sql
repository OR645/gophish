
-- +goose Up
-- SQL in section 'Up' is executed when this migration is applied
-- Allow a campaign to rotate between several email templates: the pool is
-- stored in campaign_templates and each result records which template it was
-- assigned (randomly, at launch time).
CREATE TABLE IF NOT EXISTS "campaign_templates" (
	"campaign_id" bigint,
	"template_id" bigint
);
ALTER TABLE "results" ADD COLUMN "template_id" bigint DEFAULT 0;

-- +goose Down
-- SQL section 'Down' is executed when this migration is rolled back
DROP TABLE campaign_templates;
