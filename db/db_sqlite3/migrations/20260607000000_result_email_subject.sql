-- +goose Up
-- SQL in section 'Up' is executed when this migration is applied
-- Record the rendered email subject (title) each recipient received. The
-- subject is dynamic per recipient because campaigns may rotate between
-- templates; it is filled in at send time.
ALTER TABLE "results" ADD COLUMN "email_subject" varchar(255) DEFAULT '';

-- +goose Down
-- SQL section 'Down' is executed when this migration is rolled back
