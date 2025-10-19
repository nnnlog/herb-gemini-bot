import TelegramBot from 'node-telegram-bot-api';
import {Config} from './config.js';

export type CommandType = 'image' | 'chat' | 'summarize' | 'start' | 'help' | 'map';

export type CommandHandler = (
    msg: TelegramBot.Message,
    albumMessages: TelegramBot.Message[],
    bot: TelegramBot,
    BOT_ID: number,
    config: Config,
    originalMessageId: number
) => Promise<void>;

export interface Command {
    type: CommandType;
    handler: CommandHandler;
    description: string;
    aliases: string[];
    showInList?: boolean;
    ignoreArgs?: boolean;
}
