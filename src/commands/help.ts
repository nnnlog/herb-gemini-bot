import type { BotCommand } from "grammy/types";
import { escapeHtml } from "../render/markdown.ts";
import { strings } from "../strings.ts";
import { allSpecs, findCommand } from "./specs.ts";

export function buildStartText(): string {
  let text = strings.start.greeting;
  for (const spec of allSpecs) {
    if (spec.showInMenu) text += `/${spec.name} - ${spec.description}\n`;
  }
  return text + strings.start.footer;
}

export function buildHelpText(): string {
  let text = strings.help.listHeader;
  for (const spec of allSpecs) {
    if (spec.showInMenu) text += `/${spec.name} - ${spec.description}\n`;
  }
  return text + strings.help.listFooter;
}

export function buildHelpDetail(query: string): string {
  const name = (query.split(/\s+/)[0] ?? "").toLowerCase();
  const spec = findCommand(name);
  if (!spec) return strings.help.unknownCommand(escapeHtml(name));

  let detail = `<b>/${spec.name}</b>\n${spec.description}\n`;
  if (spec.aliases.length > 0) detail += strings.help.aliases(spec.aliases.join(", "));
  if (spec.params && spec.params.length > 0) {
    detail += strings.help.paramsHeader;
    for (const param of spec.params) {
      detail += `- ${param.name} (${param.type}): ${param.description}`;
      if (param.defaultValue) detail += strings.help.defaultValue(param.defaultValue);
      detail += ` [${param.allowedValues.join(", ")}]\n`;
    }
  }
  return detail;
}

export function buildMenuCommands(): BotCommand[] {
  const commands: BotCommand[] = [];
  for (const spec of allSpecs) {
    if (!spec.showInMenu) continue;
    commands.push({ command: spec.name, description: spec.description });
    for (const alias of spec.aliases) {
      commands.push({
        command: alias,
        description: strings.menu.aliasDescription(spec.name, spec.description),
      });
    }
  }
  return commands;
}
