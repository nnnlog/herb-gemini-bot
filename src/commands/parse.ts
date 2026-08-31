import type { AiCommandSpec, CommandMeta } from "./specs.ts";
import { allSpecs, findCommand } from "./specs.ts";

export interface ParsedCommand {
  spec: CommandMeta | AiCommandSpec;
  /** Text after the command mention; leading whitespace stripped, inner whitespace kept. */
  rest: string;
}

export interface ParsedParams {
  args: Record<string, string>;
  cleanedText: string;
}

// longest-first so /gemini wins over /g
const tokenEntries: readonly { token: string; spec: CommandMeta | AiCommandSpec }[] = allSpecs
  .flatMap((spec) => [spec.name, ...spec.aliases].map((token) => ({ token, spec })))
  .sort((a, b) => b.token.length - a.token.length);

/** Parse `/cmd` or `/cmd@BotUsername`; commands addressed to other bots are ignored. */
export function parseCommand(text: string, botUsername: string): ParsedCommand | undefined {
  if (!text.startsWith("/")) return undefined;

  for (const { token, spec } of tokenEntries) {
    if (text.slice(1, 1 + token.length).toLowerCase() !== token) continue;
    let end = 1 + token.length;

    const mention = `@${botUsername.toLowerCase()}`;
    if (text.slice(end, end + mention.length).toLowerCase() === mention) {
      const afterMention = text[end + mention.length];
      if (afterMention !== undefined && !/\s/.test(afterMention)) continue;
      end += mention.length;
    } else if (text[end] === "@") {
      continue; // addressed to another bot
    }

    const next = text[end];
    if (next !== undefined && !/\s/.test(next)) continue; // reject prefix look-alikes like /geminix

    return { spec, rest: text.slice(end).replace(/^\s+/, "") };
  }
  return undefined;
}

/**
 * Consume a declared param token anywhere in the text (first case-insensitive hit),
 * removing only the token plus one adjacent space — newlines are preserved.
 */
export function parseParams(text: string, spec: CommandMeta): ParsedParams {
  const args: Record<string, string> = {};
  let cleaned = text;
  for (const param of spec.params ?? []) {
    const consumed = consumeToken(cleaned, param.allowedValues);
    args[param.name] = consumed.value ?? param.defaultValue;
    cleaned = consumed.text;
  }
  return { args, cleanedText: cleaned };
}

const PREFIX_RE = /^\/([a-zA-Z0-9_]+)(?:@\S+)?(?=\s|$)\s*/;

/**
 * Strip a history turn's own command prefix and only the params that command
 * declares. Stripping by the running command instead would leave a foreign
 * `/prefix` in the replayed text and delete words that merely look like another
 * command's param token. `fallback` supplies the params for a command-less turn,
 * which continues the running command and so carries its tokens.
 */
export function stripOwnCommand(text: string, fallback?: CommandMeta): string {
  const match = PREFIX_RE.exec(text);
  const name = match?.[1];
  const own = name !== undefined ? findCommand(name) : undefined;
  const spec = own ?? fallback;
  if (!spec) return text.trim();

  let out = own ? text.slice(match?.[0].length) : text;
  for (const param of spec.params ?? []) {
    out = consumeToken(out, param.allowedValues).text;
  }
  return out.trim();
}

function consumeToken(
  text: string,
  allowedValues: readonly string[],
): { value?: string; text: string } {
  const wordRe = /\S+/g;
  for (let match = wordRe.exec(text); match !== null; match = wordRe.exec(text)) {
    const lower = match[0].toLowerCase();
    const hit = allowedValues.find((v) => v === lower);
    if (hit === undefined) continue;

    let start = match.index;
    let end = match.index + match[0].length;
    if (text[end] === " ") end += 1;
    else if (start > 0 && text[start - 1] === " ") start -= 1;

    return { value: hit, text: text.slice(0, start) + text.slice(end) };
  }
  return { text };
}
