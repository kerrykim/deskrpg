-- Add login_id column to users table (separates login ID from display nickname)
ALTER TABLE users ADD COLUMN login_id varchar(50);

-- Backfill existing users: use nickname as login_id
UPDATE users SET login_id = nickname WHERE login_id IS NULL;

-- Make login_id NOT NULL and UNIQUE after backfill
ALTER TABLE users ALTER COLUMN login_id SET NOT NULL;
ALTER TABLE users ADD CONSTRAINT users_login_id_unique UNIQUE (login_id);
