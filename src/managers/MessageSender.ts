import TelegramBot from 'node-telegram-bot-api';
import {getFileBuffer} from '../helpers/utils.js';
import {logMessage} from '../services/db.js';

export class MessageSender {
    private bot: TelegramBot;
    private botId: number;

    constructor(bot: TelegramBot, botId: number) {
        this.bot = bot;
        this.botId = botId;
    }

    /**
     * 텔레그램 서버에서 파일을 다운로드하여 Buffer로 반환합니다.
     */
    public async getFileBuffer(fileId: string): Promise<Buffer> {
        return getFileBuffer(this.bot, fileId);
    }

    private async logResult(result: TelegramBot.Message | TelegramBot.Message[]) {
        try {
            if (Array.isArray(result)) {
                for (const msg of result) {
                    await logMessage(msg, this.botId);
                }
            } else if (typeof result === 'object' && 'message_id' in result) {
                await logMessage(result, this.botId);
            }
        } catch (e) {
            console.error(`Failed to log sent message:`, e);
        }
    }

    public async sendMessage(chatId: TelegramBot.ChatId, text: string, options?: TelegramBot.SendMessageOptions): Promise<TelegramBot.Message> {
        const result = await this.bot.sendMessage(chatId, text, options);
        await this.logResult(result);
        return result;
    }

    public async sendPhoto(chatId: TelegramBot.ChatId, photo: string | Buffer | import("stream").Stream, options?: TelegramBot.SendPhotoOptions, fileOptions?: TelegramBot.FileOptions): Promise<TelegramBot.Message> {
        const result = await this.bot.sendPhoto(chatId, photo, options, fileOptions);
        await this.logResult(result);
        return result;
    }

    public async sendMediaGroup(chatId: TelegramBot.ChatId, media: TelegramBot.InputMedia[], options?: TelegramBot.SendMediaGroupOptions): Promise<TelegramBot.Message[]> {
        const result = await this.bot.sendMediaGroup(chatId, media, options);
        await this.logResult(result);
        return result;
    }

    public async sendDocument(chatId: TelegramBot.ChatId, doc: string | Buffer | import("stream").Stream, options?: TelegramBot.SendDocumentOptions, fileOptions?: TelegramBot.FileOptions): Promise<TelegramBot.Message> {
        const result = await this.bot.sendDocument(chatId, doc, options, fileOptions);
        await this.logResult(result);
        return result;
    }

    public async editMessageText(text: string, options?: TelegramBot.EditMessageTextOptions): Promise<TelegramBot.Message | boolean> {
        const result = await this.bot.editMessageText(text, options);
        if (typeof result !== 'boolean') {
            await this.logResult(result);
        }
        return result;
    }

    public async setMessageReaction(chatId: TelegramBot.ChatId, messageId: number, options?: any): Promise<boolean> {
        // setMessageReaction usually returns boolean, no logging of the message itself is needed here as it modifies an existing one
        // and doesn't return a Message object.
        return await this.bot.setMessageReaction(chatId, messageId, options);
    }

    public async sendChatAction(chatId: TelegramBot.ChatId, action: TelegramBot.ChatAction, options?: TelegramBot.SendChatActionOptions): Promise<boolean> {
        return await this.bot.sendChatAction(chatId, action, options);
    }
}
