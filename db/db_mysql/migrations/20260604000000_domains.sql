
-- +goose Up
-- SQL in section 'Up' is executed when this migration is applied
-- Create a table to store sending / landing domains managed through the UI
CREATE TABLE IF NOT EXISTS domains (
	id integer primary key auto_increment,
	user_id bigint,
	company_id bigint,
	name varchar(255),
	ip varchar(64),
	registrar varchar(255),
	auto_a_record boolean,
	configure_365 boolean,
	status varchar(64),
	m365_status varchar(64),
	modified_date datetime
);

-- +goose Down
-- SQL section 'Down' is executed when this migration is rolled back
DROP TABLE domains;
