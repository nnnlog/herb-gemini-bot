import type { Message } from "grammy/types";
import { beforeEach, expect, it } from "vitest";
import { openDb } from "../../src/db/database.ts";
import { Repo } from "../../src/db/repo.ts";

let repo: Repo;

beforeEach(() => {
  repo = new Repo(openDb(":memory:"));
});

function mediaMsg(overrides: Partial<Message>): Message {
  return {
    message_id: 1,
    date: 1700000000,
    chat: { id: 10, type: "private", first_name: "u" },
    from: { id: 42, is_bot: false, first_name: "u" },
    ...overrides,
  } as Message;
}

function textMsg(overrides: Partial<Message> = {}): Message {
  return mediaMsg({ text: "hello", ...overrides });
}

it("round-trips a logged message", () => {
  const msg = textMsg();
  repo.logMessage(msg);
  expect(repo.getMessage(10, 1)).toEqual(msg);
  expect(repo.getMessage(10, 999)).toBeUndefined();
});

it("records only the largest photo variant, with no duplicates on re-logging", () => {
  const msg = mediaMsg({
    caption: "pic",
    photo: [
      { file_id: "small", file_unique_id: "u-small", width: 90, height: 90 },
      { file_id: "big", file_unique_id: "u-big", width: 900, height: 900, file_size: 5000 },
    ],
  });
  repo.logMessage(msg);
  repo.logMessage(msg);

  const attachments = repo.getAttachments(10, 1);
  expect(attachments).toHaveLength(1);
  expect(attachments[0]).toMatchObject({
    file_unique_id: "u-big",
    file_id: "big",
    kind: "photo",
    mime_type: "image/jpeg",
  });
});

it("preserves Telegram-provided mime_type and file name for documents", () => {
  repo.logMessage(
    mediaMsg({
      document: {
        file_id: "d1",
        file_unique_id: "u-d1",
        file_name: "notes.txt",
        mime_type: "text/plain",
        file_size: 10,
      },
    }),
  );
  expect(repo.getAttachments(10, 1)[0]).toMatchObject({
    kind: "document",
    file_name: "notes.txt",
    mime_type: "text/plain",
  });
});

it("meta upserts never erase previously stored fields", () => {
  repo.setMeta(10, 1, { commandType: "gemini" });
  repo.setMeta(10, 1, { commandType: "gemini", modelParts: [{ text: "answer" }] });
  repo.setMeta(10, 1, { commandType: "gemini" }); // rewriting command_type alone keeps parts

  expect(repo.getCommandType(10, 1)).toBe("gemini");
  expect(repo.getModelParts(10, 1)).toEqual({ rootId: 1, parts: [{ text: "answer" }] });
});

it("resolves chunk parts through linked_message_id to the first chunk", () => {
  repo.setMeta(10, 100, { commandType: "gemini", modelParts: [{ text: "full" }] });
  repo.setMeta(10, 101, { commandType: "gemini", linkedMessageId: 100 });

  expect(repo.getModelParts(10, 101)).toEqual({ rootId: 100, parts: [{ text: "full" }] });
});

it("a linked_message_id cycle yields undefined instead of recursing forever", () => {
  repo.setMeta(10, 1, { commandType: "gemini", linkedMessageId: 2 });
  repo.setMeta(10, 2, { commandType: "gemini", linkedMessageId: 1 });

  expect(repo.getModelParts(10, 1)).toBeUndefined();
});

it("backfills a missing replied-to original one hop", () => {
  const original = textMsg({ message_id: 5, text: "original" });
  const reply = textMsg({ message_id: 6, reply_to_message: original as never });

  repo.backfillReplyTarget(reply);
  expect(repo.getMessage(10, 5)?.text).toBe("original");
});

it("returns album members ordered by message_id", () => {
  repo.logMessage(textMsg({ message_id: 3, media_group_id: "album1" }));
  repo.logMessage(textMsg({ message_id: 2, media_group_id: "album1" }));
  repo.logMessage(textMsg({ message_id: 9, media_group_id: "other" }));

  const album = repo.getAlbumMessages(10, "album1");
  expect(album.map((m) => m.message_id)).toEqual([2, 3]);
});
