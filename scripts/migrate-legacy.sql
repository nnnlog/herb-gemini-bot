-- One-off legacy conversion: old schema (raw_messages etc.) -> current schema.
-- Run: sqlite3 telegram_log.db < scripts/migrate-legacy.sql
-- Single transaction: on failure the original file is untouched. Safe to delete
-- this file after the production cutover.

-- Legacy message_attachments declares FKs that would block DROP TABLE raw_messages.
-- PRAGMA foreign_keys is a no-op inside a transaction, so it must precede BEGIN.
PRAGMA foreign_keys=OFF;

BEGIN;

-- messages: move raw_messages, promoting media_group_id to a real column
CREATE TABLE messages (
  chat_id        INTEGER NOT NULL,
  message_id     INTEGER NOT NULL,
  user_id        INTEGER,
  date           INTEGER,
  media_group_id TEXT,
  data           TEXT NOT NULL,
  PRIMARY KEY (chat_id, message_id)
);
INSERT INTO messages (chat_id, message_id, user_id, date, media_group_id, data)
  SELECT chat_id, message_id, user_id, timestamp, json_extract(data, '$.media_group_id'), data
  FROM raw_messages;
DROP TABLE raw_messages;

-- attachments: rename one column, schema otherwise identical
ALTER TABLE attachments RENAME COLUMN type TO kind;

-- message_attachments: recreate without FK declarations
CREATE TABLE message_attachments_v1 (
  chat_id        INTEGER NOT NULL,
  message_id     INTEGER NOT NULL,
  file_unique_id TEXT NOT NULL,
  PRIMARY KEY (chat_id, message_id, file_unique_id)
);
INSERT INTO message_attachments_v1
  SELECT chat_id, message_id, file_unique_id FROM message_attachments;
DROP TABLE message_attachments;
ALTER TABLE message_attachments_v1 RENAME TO message_attachments;

-- message_meta: merge the two legacy metadata tables
CREATE TABLE message_meta (
  chat_id           INTEGER NOT NULL,
  message_id        INTEGER NOT NULL,
  command_type      TEXT,
  model_parts       TEXT,
  linked_message_id INTEGER,
  PRIMARY KEY (chat_id, message_id)
);
INSERT INTO message_meta (chat_id, message_id, command_type)
  SELECT chat_id, message_id, command_type FROM message_metadata;
INSERT INTO message_meta (chat_id, message_id, model_parts, linked_message_id)
  SELECT chat_id, message_id, parts, linked_message_id FROM model_response_metadata WHERE true
  ON CONFLICT(chat_id, message_id) DO UPDATE SET
    model_parts = excluded.model_parts,
    linked_message_id = excluded.linked_message_id;
DROP TABLE message_metadata;
DROP TABLE model_response_metadata;

-- drop dead tables/indexes, create the new index
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS conversation_turns;
DROP INDEX IF EXISTS idx_raw_messages_timestamp;
DROP INDEX IF EXISTS idx_raw_messages_media_group_id;
CREATE INDEX idx_messages_album ON messages(chat_id, media_group_id)
  WHERE media_group_id IS NOT NULL;

PRAGMA user_version = 1;
COMMIT;
