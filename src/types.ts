import TelegramBot from 'node-telegram-bot-api';
import {Config} from './config.js';

export type CommandType = 'image' | 'chat' | 'summarize' | 'start' | 'help' | 'map';

export interface CommandParameter {
    name: string;
    type: 'string' | 'number' | 'boolean';
    allowedValues?: string[];
    defaultValue?: any;
    description?: string;
}

export interface ParsedCommand {
    command: Command;
    args: Record<string, any>;
    cleanedText: string;
    originalText: string;
}

export type CommandHandler = (
    msg: TelegramBot.Message,
    albumMessages: TelegramBot.Message[],
    bot: TelegramBot,
    BOT_ID: number,
    config: Config,
    originalMessageId: number,
    parsedCommand?: ParsedCommand
) => Promise<void>;

export interface Command {
    type: CommandType;
    handler: CommandHandler;
    description: string;
    aliases: string[];
    showInList?: boolean;
    ignoreArgs?: boolean;
    parameters?: CommandParameter[];
}
