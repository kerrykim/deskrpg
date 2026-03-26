-- Step 1: Clean up existing seed data
DELETE FROM chat_messages WHERE npc_id IN ('sarah', 'max');
DELETE FROM npcs WHERE id IN ('sarah', 'max');

-- Step 2: Drop FK constraints referencing npcs.id
ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_npc_id_npcs_id_fk;

-- Step 3: Drop mapId column and its FK
ALTER TABLE npcs DROP CONSTRAINT IF EXISTS npcs_map_id_maps_id_fk;
ALTER TABLE npcs DROP COLUMN IF EXISTS map_id;

-- Step 4: Change npcs.id from varchar to uuid
ALTER TABLE npcs ALTER COLUMN id DROP DEFAULT;
ALTER TABLE npcs ALTER COLUMN id TYPE uuid USING gen_random_uuid();
ALTER TABLE npcs ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- Step 5: Make channelId NOT NULL
DELETE FROM npcs WHERE channel_id IS NULL;
ALTER TABLE npcs ALTER COLUMN channel_id SET NOT NULL;

-- Step 6: Add unique constraint for position within channel
ALTER TABLE npcs ADD CONSTRAINT npcs_channel_position_unique UNIQUE (channel_id, position_x, position_y);

-- Step 7: Update chatMessages.npcId to uuid
ALTER TABLE chat_messages ALTER COLUMN npc_id TYPE uuid USING NULL;
ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_npc_id_npcs_id_fk
  FOREIGN KEY (npc_id) REFERENCES npcs(id) ON DELETE CASCADE;
