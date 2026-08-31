import { DatabaseSync } from "node:sqlite";

// cwd-relative: the container image sets WORKDIR to the mounted data volume.
export const DB_FILE = "./telegram_log.db";

// Schema changes go through this version array only. Legacy conversion is scripts/migrate-legacy.sql.
const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE messages (
    chat_id        INTEGER NOT NULL,
    message_id     INTEGER NOT NULL,
    user_id        INTEGER,
    date           INTEGER,
    media_group_id TEXT,
    data           TEXT NOT NULL,
    PRIMARY KEY (chat_id, message_id)
  );
  CREATE INDEX idx_messages_album ON messages(chat_id, media_group_id)
    WHERE media_group_id IS NOT NULL;

  CREATE TABLE attachments (
    file_unique_id TEXT PRIMARY KEY,
    file_id        TEXT NOT NULL,
    kind           TEXT NOT NULL,
    file_name      TEXT,
    mime_type      TEXT,
    file_size      INTEGER,
    width          INTEGER,
    height         INTEGER
  );

  CREATE TABLE message_attachments (
    chat_id        INTEGER NOT NULL,
    message_id     INTEGER NOT NULL,
    file_unique_id TEXT NOT NULL,
    PRIMARY KEY (chat_id, message_id, file_unique_id)
  );

  CREATE TABLE message_meta (
    chat_id           INTEGER NOT NULL,
    message_id        INTEGER NOT NULL,
    command_type      TEXT,
    model_parts       TEXT,
    linked_message_id INTEGER,
    PRIMARY KEY (chat_id, message_id)
  );
  `,
];

export function openDb(file: string = DB_FILE): DatabaseSync {
  const db = new DatabaseSync(file, { enableForeignKeyConstraints: false });
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA synchronous=NORMAL");
  migrate(db);
  return db;
}

function migrate(db: DatabaseSync): void {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  if (row.user_version >= MIGRATIONS.length) return;

  db.exec("BEGIN");
  try {
    for (const sql of MIGRATIONS.slice(row.user_version)) db.exec(sql);
    db.exec(`PRAGMA user_version = ${MIGRATIONS.length}`);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e; // abort boot — never start polling on a half-migrated DB
  }
}
