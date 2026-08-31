import type { CallbackQuery, Message } from "grammy/types";
import { buildHelpDetail, buildHelpText, buildStartText } from "../commands/help.ts";
import { parseCommand, parseParams } from "../commands/parse.ts";
import type { AiCommandSpec, CommandMeta } from "../commands/specs.ts";
import { findCommand, IMPLICIT_REMAP, isAiSpec } from "../commands/specs.ts";
import { log } from "../log.ts";
import type { Deps } from "../pipeline/run.ts";
import { runAiCommand } from "../pipeline/run.ts";
import { strings } from "../strings.ts";

const ALBUM_DEBOUNCE_MS = 500;
// a dispatched group stays known this long so a late member cannot start a second run
const ALBUM_RETAIN_MS = 60_000;

interface Album {
  members: Message[];
  timer: NodeJS.Timeout;
  dispatched: boolean;
}

export interface Handlers {
  onMessage(msg: Message): Promise<void>;
  onCallback(query: CallbackQuery): Promise<void>;
  /** Graceful shutdown: cancel pending album timers (members are already logged). */
  cancelAlbumTimers(): void;
}

export function createHandlers(deps: Deps): Handlers {
  const albums = new Map<string, Album>();
  const activeRetries = new Set<string>();

  function isAuthorized(chatId: number, userId: number | undefined): boolean {
    return (
      (userId !== undefined && deps.cfg.trustedUserIds.has(userId)) ||
      deps.cfg.allowedChannelIds.has(chatId)
    );
  }

  async function onMessage(msg: Message): Promise<void> {
    if (!msg.from) return;
    if (!isAuthorized(msg.chat.id, msg.from.id)) return; // unauthorized: no reply, no logging

    deps.repo.logMessage(msg);
    deps.repo.backfillReplyTarget(msg);

    if (msg.media_group_id) {
      collectAlbum(msg, msg.media_group_id);
      return;
    }
    await dispatch(msg);
  }

  function collectAlbum(msg: Message, groupId: string): void {
    const existing = albums.get(groupId);
    // already dispatched: the member is logged, so history and retries still expand the album
    if (existing?.dispatched) return;

    const members = existing?.members ?? [];
    members.push(msg);
    if (existing) clearTimeout(existing.timer);

    const timer = setTimeout(() => {
      const album = albums.get(groupId);
      if (!album) return;
      album.dispatched = true;
      album.timer = setTimeout(() => albums.delete(groupId), ALBUM_RETAIN_MS);

      const sorted = [...album.members].sort((a, b) => a.message_id - b.message_id);
      const driver = sorted.find((m) => m.caption) ?? sorted[0];
      if (!driver) return;
      // timer callbacks run outside grammY's error boundary
      dispatch(driver).catch((error) => log.error({ err: error }, "앨범 dispatch 실패"));
    }, ALBUM_DEBOUNCE_MS);

    albums.set(groupId, { members, timer, dispatched: false });
  }

  async function dispatch(msg: Message, retryPlaceholderId?: number): Promise<void> {
    const text = msg.text ?? msg.caption ?? "";
    const parsed = parseCommand(text, deps.botUsername);

    let spec: CommandMeta | AiCommandSpec;
    let rest: string;
    let isImplicit: boolean;

    if (parsed) {
      ({ spec, rest } = parsed);
      isImplicit = false;
    } else {
      // implicit continuation: a command-less reply to a bot response re-runs its command_type
      if (msg.reply_to_message?.from?.id !== deps.botId) return;
      const type = deps.repo.getCommandType(msg.chat.id, msg.reply_to_message.message_id);
      if (!type || type === "error") return; // replies to error messages are ignored
      const found = findCommand(IMPLICIT_REMAP[type] ?? type);
      if (!found || !isAiSpec(found)) return;
      spec = found;
      rest = text;
      isImplicit = true;
    }

    if (!isAiSpec(spec)) {
      const replyText =
        spec.name === "start"
          ? buildStartText()
          : rest.trim()
            ? buildHelpDetail(rest)
            : buildHelpText();
      await deps.sender.sendHtml(msg.chat.id, replyText, msg.message_id);
      return;
    }

    const { args, cleanedText } = parseParams(rest, spec);

    // implicit commands skip validation — the history itself is the prompt
    if (!isImplicit && !(await validate(msg, cleanedText))) return;

    deps.repo.setMeta(msg.chat.id, msg.message_id, { commandType: spec.name });
    await runAiCommand(deps, {
      spec,
      msg,
      args,
      ...(retryPlaceholderId !== undefined ? { retryPlaceholderId } : {}),
    });
  }

  async function validate(msg: Message, cleanedText: string): Promise<boolean> {
    const hasMedia = Boolean(msg.photo || msg.document);
    if (hasMedia || cleanedText.trim().length > 0) return true;

    const replied = msg.reply_to_message;
    if (replied?.from?.id === deps.botId) {
      await deps.sender.sendPlain(
        msg.chat.id,
        strings.validate.replyToBotNeedsContent,
        msg.message_id,
      );
      return false;
    }
    if (replied) return true; // replying to a human message: that message becomes the prompt

    await deps.sender.sendPlain(msg.chat.id, strings.validate.needPromptOrReply, msg.message_id);
    return false;
  }

  async function onCallback(query: CallbackQuery): Promise<void> {
    const message = query.message;
    if (!message || !isAuthorized(message.chat.id, query.from.id)) return;

    const data = query.data;
    if (!data?.startsWith("retry_")) {
      await deps.sender.answerCallback(query.id);
      return;
    }

    const originalMsgId = Number(data.slice("retry_".length));
    const chatId = message.chat.id;
    const retryKey = `${chatId}_${originalMsgId}`;
    if (activeRetries.has(retryKey)) {
      await deps.sender.answerCallback(query.id, { text: strings.retry.alreadyInProgress });
      return;
    }

    activeRetries.add(retryKey);
    try {
      const original = Number.isInteger(originalMsgId)
        ? deps.repo.getMessage(chatId, originalMsgId)
        : undefined;
      if (!original) {
        await deps.sender.answerCallback(query.id, {
          text: strings.retry.originalNotFound,
          showAlert: true,
        });
        return;
      }

      await deps.sender.answerCallback(query.id);
      await deps.sender.editText(chatId, message.message_id, strings.retry.retrying, originalMsgId);
      log.debug({ chatId, originalMsgId }, "재시도 실행");
      await dispatch(original, message.message_id);
    } finally {
      activeRetries.delete(retryKey);
    }
  }

  function cancelAlbumTimers(): void {
    for (const album of albums.values()) clearTimeout(album.timer);
    albums.clear();
  }

  return { onMessage, onCallback, cancelAlbumTimers };
}
