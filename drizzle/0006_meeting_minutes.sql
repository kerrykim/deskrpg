CREATE TABLE meeting_minutes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  transcript TEXT NOT NULL,
  participants JSONB NOT NULL DEFAULT '[]',
  total_turns INTEGER NOT NULL DEFAULT 0,
  duration_seconds INTEGER,
  initiator_id UUID REFERENCES users(id) ON DELETE SET NULL,
  key_topics JSONB NOT NULL DEFAULT '[]',
  conclusions TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_meeting_minutes_channel ON meeting_minutes(channel_id);
CREATE INDEX idx_meeting_minutes_created ON meeting_minutes(created_at DESC);
