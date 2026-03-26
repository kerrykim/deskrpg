-- Add password column to channels
ALTER TABLE channels ADD COLUMN IF NOT EXISTS password varchar(255);

-- Create channel_members table
CREATE TABLE IF NOT EXISTS channel_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role varchar(20) NOT NULL DEFAULT 'member',
  joined_at timestamptz DEFAULT now(),
  UNIQUE(channel_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_channel_members_channel_id ON channel_members(channel_id);
CREATE INDEX IF NOT EXISTS idx_channel_members_user_id ON channel_members(user_id);

-- Backfill existing channel owners
INSERT INTO channel_members (id, channel_id, user_id, role, joined_at)
SELECT gen_random_uuid(), id, owner_id, 'owner', created_at
FROM channels
ON CONFLICT DO NOTHING;
