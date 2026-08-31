import type { DatabaseSync, SQLOutputValue, StatementSync } from "node:sqlite";
import type { Part } from "@google/genai";
import type { Message } from "grammy/types";
import { log } from "../log.ts";

export interface AttachmentRow {
  file_unique_id: string;
  file_id: string;
  kind: "photo" | "document";
  file_name: string | null;
  mime_type: string | null;
  file_size: number | null;
  width: number | null;
  height: number | null;
}

export interface MetaUpdate {
  commandType: string;
  modelParts?: Part[];
  linkedMessageId?: number;
}

const LINKED_HOP_LIMIT = 3;

export class Repo {
  private readonly insertMessage: StatementSync;
  private readonly selectMessage: StatementSync;
  private readonly insertAttachment: StatementSync;
  private readonly linkAttachment: StatementSync;
  private readonly selectAttachments: StatementSync;
  private readonly upsertMeta: StatementSync;
  private readonly selectMeta: StatementSync;
  private readonly selectAlbum: StatementSync;

  constructor(db: DatabaseSync) {
    this.insertMessage = db.prepare(
      `INSERT OR REPLACE INTO messages (chat_id, message_id, user_id, date, media_group_id, data)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    this.selectMessage = db.prepare(
      "SELECT data FROM messages WHERE chat_id = ? AND message_id = ?",
    );
    this.insertAttachment = db.prepare(
      `INSERT OR IGNORE INTO attachments
         (file_unique_id, file_id, kind, file_name, mime_type, file_size, width, height)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.linkAttachment = db.prepare(
      `INSERT OR IGNORE INTO message_attachments (chat_id, message_id, file_unique_id)
       VALUES (?, ?, ?)`,
    );
    this.selectAttachments = db.prepare(
      `SELECT a.* FROM attachments a
       JOIN message_attachments ma ON ma.file_unique_id = a.file_unique_id
       WHERE ma.chat_id = ? AND ma.message_id = ?`,
    );
    this.upsertMeta = db.prepare(
      `INSERT INTO message_meta (chat_id, message_id, command_type, model_parts, linked_message_id)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(chat_id, message_id) DO UPDATE SET
         command_type = excluded.command_type,
         model_parts = COALESCE(excluded.model_parts, model_parts),
         linked_message_id = COALESCE(excluded.linked_message_id, linked_message_id)`,
    );
    this.selectMeta = db.prepare(
      `SELECT command_type, model_parts, linked_message_id
       FROM message_meta WHERE chat_id = ? AND message_id = ?`,
    );
    this.selectAlbum = db.prepare(
      `SELECT data FROM messages WHERE chat_id = ? AND media_group_id = ? ORDER BY message_id`,
    );
  }

  logMessage(msg: Message): void {
    this.insertMessage.run(
      msg.chat.id,
      msg.message_id,
      msg.from?.id ?? null,
      msg.date ?? null,
      msg.media_group_id ?? null,
      JSON.stringify(msg),
    );
    for (const att of extractAttachments(msg)) {
      this.insertAttachment.run(
        att.file_unique_id,
        att.file_id,
        att.kind,
        att.file_name,
        att.mime_type,
        att.file_size,
        att.width,
        att.height,
      );
      this.linkAttachment.run(msg.chat.id, msg.message_id, att.file_unique_id);
    }
  }

  /** Backfill a missing replied-to original (one hop) so the chain stays walkable. */
  backfillReplyTarget(msg: Message): void {
    const target = msg.reply_to_message;
    if (!target) return;
    if (this.getMessage(msg.chat.id, target.message_id)) return;
    this.logMessage(target as Message);
  }

  getMessage(chatId: number, messageId: number): Message | undefined {
    const row = this.selectMessage.get(chatId, messageId) as { data: string } | undefined;
    return row ? parseStored<Message>(row.data) : undefined;
  }

  getCommandType(chatId: number, messageId: number): string | undefined {
    const row = this.selectMeta.get(chatId, messageId) as
      | { command_type: string | null }
      | undefined;
    return row?.command_type ?? undefined;
  }

  setMeta(chatId: number, messageId: number, meta: MetaUpdate): void {
    this.upsertMeta.run(
      chatId,
      messageId,
      meta.commandType,
      meta.modelParts ? JSON.stringify(meta.modelParts) : null,
      meta.linkedMessageId ?? null,
    );
  }

  /**
   * Resolve model parts through linked_message_id chunks (hop-capped, cycle-safe).
   * rootId identifies the chunk holding the parts, so callers can dedupe turns
   * that resolve to the same response.
   */
  getModelParts(chatId: number, messageId: number): { rootId: number; parts: Part[] } | undefined {
    const seen = new Set<number>();
    let id = messageId;
    for (let hop = 0; hop <= LINKED_HOP_LIMIT; hop++) {
      if (seen.has(id)) return undefined;
      seen.add(id);
      const row = this.selectMeta.get(chatId, id) as
        | { model_parts: string | null; linked_message_id: number | null }
        | undefined;
      if (!row) return undefined;
      if (row.model_parts) {
        const parts = parseStored<Part[]>(row.model_parts);
        // an unreadable row must not break the chain — fall back to the display text
        if (parts) return { rootId: id, parts };
      }
      if (row.linked_message_id === null) return undefined;
      id = row.linked_message_id;
    }
    return undefined;
  }

  getAlbumMessages(chatId: number, mediaGroupId: string): Message[] {
    const rows = this.selectAlbum.all(chatId, mediaGroupId) as { data: string }[];
    const messages: Message[] = [];
    for (const row of rows) {
      const message = parseStored<Message>(row.data);
      if (message) messages.push(message);
    }
    return messages;
  }

  getAttachments(chatId: number, messageId: number): AttachmentRow[] {
    return this.selectAttachments.all(chatId, messageId).map(toAttachmentRow);
  }
}

function asText(value: SQLOutputValue | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function asInt(value: SQLOutputValue | undefined): number | null {
  if (typeof value === "number") return value;
  return typeof value === "bigint" ? Number(value) : null;
}

function toAttachmentRow(row: Record<string, SQLOutputValue>): AttachmentRow {
  return {
    file_unique_id: asText(row.file_unique_id) ?? "",
    file_id: asText(row.file_id) ?? "",
    kind: asText(row.kind) === "photo" ? "photo" : "document",
    file_name: asText(row.file_name),
    mime_type: asText(row.mime_type),
    file_size: asInt(row.file_size),
    width: asInt(row.width),
    height: asInt(row.height),
  };
}

function parseStored<T>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    log.warn({ err: error }, "저장된 JSON 파싱 실패");
    return undefined;
  }
}

/** The single rule for which parts of a Message are attachable files. */
export function extractAttachments(msg: Message): AttachmentRow[] {
  if (msg.photo && msg.photo.length > 0) {
    const largest = msg.photo[msg.photo.length - 1];
    if (!largest) return [];
    return [
      {
        file_unique_id: largest.file_unique_id,
        file_id: largest.file_id,
        kind: "photo",
        file_name: null,
        mime_type: "image/jpeg",
        file_size: largest.file_size ?? null,
        width: largest.width,
        height: largest.height,
      },
    ];
  }
  if (msg.document) {
    return [
      {
        file_unique_id: msg.document.file_unique_id,
        file_id: msg.document.file_id,
        kind: "document",
        file_name: msg.document.file_name ?? null,
        mime_type: msg.document.mime_type ?? null,
        file_size: msg.document.file_size ?? null,
        width: null,
        height: null,
      },
    ];
  }
  return [];
}
