
-- +goose Up
-- SQL in section 'Up' is executed when this migration is applied
-- Add Hudu-sourced fields to companies: the Hebrew display name (used in
-- generated reports) and the Hudu customer id.
ALTER TABLE companies ADD COLUMN "name_he" varchar(255) DEFAULT '';
ALTER TABLE companies ADD COLUMN "customer_id" varchar(255) DEFAULT '';

-- +goose Down
-- SQL section 'Down' is executed when this migration is rolled back
