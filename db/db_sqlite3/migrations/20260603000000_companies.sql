
-- +goose Up
-- SQL in section 'Up' is executed when this migration is applied
-- Create a table to store companies that campaigns can be associated with
CREATE TABLE IF NOT EXISTS "companies" (
	"id" integer primary key autoincrement,
	"user_id" bigint,
	"name" varchar(255),
	"modified_date" datetime
);
-- Associate campaigns with an (optional) company
ALTER TABLE campaigns ADD COLUMN "company_id" bigint;

-- +goose Down
-- SQL section 'Down' is executed when this migration is rolled back
DROP TABLE companies;
