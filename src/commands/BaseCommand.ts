import TelegramBot from 'node-telegram-bot-api';
import {Config} from '../config.js';
import {Session} from '../managers/SessionManager.js';

export interface CommandContext {
    msg: TelegramBot.Message;
    bot: TelegramBot;
    config: Config;
    session: Session;
    args: Record<string, any>;
    commandName: string;
    cleanedText: string;
    isImplicit: boolean;
    botId: number;
}

export interface ImageData {
    buffer: Buffer;
    mimeType: string;
}

export interface CommandParameter {
    name: string;
    type: 'string' | 'number' | 'boolean';
    allowedValues?: string[];
    defaultValue?: any;
    description?: string;
}

export abstract class BaseCommand {
    public abstract readonly name: string;
    public abstract readonly aliases: string[];
    public abstract readonly description: string;
    public abstract readonly showInList: boolean;
    public readonly parameters?: CommandParameter[];

    /**
     * 명령 실행
     */
    public abstract execute(ctx: CommandContext): Promise<void>;

    /**
     * 주어진 이름과 명령어가 일치하는지 확인
     */
    public matches(commandName: string): boolean {
        return this.name === commandName || this.aliases.includes(commandName);
    }

    /**
     * 메시지가 이 명령에 적합한지 유효성을 검사합니다.
     * 하위 클래스에서 재정의할 수 있습니다.
     */
    public async validate(ctx: CommandContext): Promise<boolean> {
        return true;
    }

    /**
     * 긴 메시지에 대한 분할 및 코드 블록 처리를 포함한 통합 전송 로직입니다.
     * utils.ts -> sendLongMessage에서 리팩토링됨
     */
    protected async reply(ctx: CommandContext, text: string, options?: TelegramBot.SendMessageOptions, images?: ImageData[]): Promise<TelegramBot.Message[]> {
        const {bot, msg} = ctx;
        const chatId = msg.chat.id;
        const replyToId = msg.message_id;

        const MAX_LENGTH = 4096;
        const CAPTION_MAX_LENGTH = 1024;
        const sentMessages: TelegramBot.Message[] = [];

        // 간단한 경우: 짧은 텍스트, 이미지 없음
        if (text.length <= MAX_LENGTH && (!images || images.length === 0)) {
            const sentMsg = await bot.sendMessage(chatId, text, {
                reply_to_message_id: replyToId,
                parse_mode: 'HTML',
                ...options
            });
            return [sentMsg];
        }

        // 텍스트 분할
        const chunks: string[] = [];
        let currentChunk = "";
        let inPreBlock = false;
        const lines = text.split('\n');
        const firstChunkMaxLength = (images && images.length > 0) ? CAPTION_MAX_LENGTH : MAX_LENGTH;

        for (const line of lines) {
            const maxLength = chunks.length === 0 ? firstChunkMaxLength : MAX_LENGTH;

            if (currentChunk.length + line.length + 1 > maxLength) {
                if (inPreBlock) {
                    currentChunk += '\n</pre>';
                }
                chunks.push(currentChunk);
                currentChunk = inPreBlock ? '<pre>' : '';
            }

            if (line.includes('<pre>')) inPreBlock = true;
            currentChunk += line + '\n';
            if (line.includes('</pre>')) inPreBlock = false;
        }

        if (currentChunk) {
            chunks.push(currentChunk);
        }

        // 첫 번째 메시지
        let firstMessage: TelegramBot.Message;
        const firstChunk = chunks[0] || '';

        if (images && images.length > 0) {
            const hasCaption = firstChunk.trim().length > 0;

            if (images.length === 1) {
                const photoOptions: TelegramBot.SendPhotoOptions = {
                    reply_to_message_id: replyToId,
                    ...options
                };
                if (hasCaption) {
                    photoOptions.caption = firstChunk;
                    photoOptions.parse_mode = 'HTML';
                }
                firstMessage = await bot.sendPhoto(chatId, images[0].buffer, photoOptions);
                sentMessages.push(firstMessage);
            } else {
                const mediaGroup: TelegramBot.InputMediaPhoto[] = images.map((img, index) => ({
                    type: 'photo',
                    media: img.buffer as any,
                    caption: (index === 0 && hasCaption) ? firstChunk : undefined,
                    parse_mode: (index === 0 && hasCaption) ? 'HTML' : undefined
                }));

                // sendMediaGroup은 일반적인 옵션을 쉽게 지원하지 않지만, 시도해 볼 수 있음
                const msgs = await bot.sendMediaGroup(chatId, mediaGroup, {
                    reply_to_message_id: replyToId
                });
                sentMessages.push(...msgs);
                firstMessage = msgs[0];
            }
        } else {
            firstMessage = await bot.sendMessage(chatId, firstChunk, {
                reply_to_message_id: replyToId,
                parse_mode: 'HTML',
                ...options
            });
            sentMessages.push(firstMessage);
        }

        // 나머지 청크 처리
        let currentReplyToId = firstMessage.message_id;

        for (let i = 1; i < chunks.length; i++) {
            const chunk = chunks[i];
            const sentMsg = await bot.sendMessage(chatId, chunk, {
                reply_to_message_id: currentReplyToId,
                parse_mode: 'HTML',
                ...options
            });
            sentMessages.push(sentMsg);
            currentReplyToId = sentMsg.message_id;
        }

        // 원본 파일 전송 (이미지가 있는 경우)
        if (images && images.length > 0) {
            if (images.length === 1) {
                await bot.sendDocument(chatId, images[0].buffer, {
                    reply_to_message_id: firstMessage.message_id
                }, {
                    filename: 'image.png',
                    contentType: images[0].mimeType || 'image/png'
                });
            } else {
                const docMedia = images.map((img, index) => ({
                    type: 'document' as const,
                    media: img.buffer as any,
                    file_name: `image_${index + 1}.png`,
                    mime_type: img.mimeType || 'image/png'
                }));
                await bot.sendMediaGroup(chatId, docMedia as any, {
                    reply_to_message_id: firstMessage.message_id
                });
            }
        }

        return sentMessages;
    }
}
