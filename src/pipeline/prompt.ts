import type { Content, Part } from "@google/genai";
import { stripOwnCommand } from "../commands/parse.ts";
import type { AiCommandSpec } from "../commands/specs.ts";
import { strings } from "../strings.ts";
import type { FileCache } from "../telegram/files.ts";
import { resolveMime } from "../telegram/files.ts";
import type { Turn, TurnFile } from "./history.ts";

const MAX_TOTAL_FILE_BYTES = 100 * 1024 * 1024;

export type BuiltContents = { ok: true; contents: Content[] } | { ok: false; userMessage: string };

/** Turn[] → Gemini Content[], downloading files with dedup and a total-size cap. */
export async function buildContents(
  files: FileCache,
  spec: AiCommandSpec,
  turns: Turn[],
): Promise<BuiltContents> {
  // the cap counts exactly the files the attach loop below sends — never more
  let totalBytes = 0;
  const counted = new Map<string, TurnFile>();
  for (const turn of turns) {
    for (const file of turn.files) {
      if (counted.has(file.fileUniqueId)) continue;
      counted.set(file.fileUniqueId, file);
      totalBytes += file.fileSize ?? 0;
    }
  }
  if (totalBytes > MAX_TOTAL_FILE_BYTES) {
    return {
      ok: false,
      userMessage: strings.errors.filesTooLarge(Math.round(totalBytes / 1024 / 1024)),
    };
  }

  // warm the cache concurrently (the cache bounds how many run at once); the attach
  // loop below awaits the same promises and is where a download failure surfaces
  await Promise.allSettled([...counted.values()].map((file) => files.get(file.fileId)));

  const attached = new Set<string>(); // each file is attached once across the whole history
  const contents: Content[] = [];

  for (const turn of turns) {
    const replay = replayableParts(spec, turn);
    const parts: Part[] = replay ? [...replay] : [];

    for (const file of turn.files) {
      if (attached.has(file.fileUniqueId)) continue;
      attached.add(file.fileUniqueId);
      const buffer = await files.get(file.fileId);
      parts.push({
        inlineData: { data: buffer.toString("base64"), mimeType: resolveMime(file) },
      });
    }

    if (!replay) {
      // a command-less user turn is a continuation, so the running spec owns its param tokens
      const text = stripOwnCommand(turn.text, turn.role === "user" ? spec : undefined);
      if (text) parts.push({ text });
    }
    if (parts.length > 0) contents.push({ role: turn.role, parts });
  }

  if (contents.length === 0) return { ok: false, userMessage: strings.errors.noValidPrompt };
  return { ok: true, contents };
}

/** Stored model parts to replay, or undefined when the turn falls back to its display text. */
function replayableParts(spec: AiCommandSpec, turn: Turn): Part[] | undefined {
  if (!turn.parts || turn.parts.length === 0) return undefined;
  // legacy-migrated rows still carry inlineData; generated images replay from their
  // Telegram copies instead, and this base64 would bypass the total-size cap
  const stored = turn.parts.filter((part) => !part.inlineData);
  const parts = spec.historyPartFilter ? stored.filter(spec.historyPartFilter) : stored;
  return parts.length > 0 ? parts : undefined;
}
