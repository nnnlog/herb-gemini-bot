import {generateFromHistory, GenerationOutput} from './aiHandler.js';
import {logMessage, getConversationHistory} from './db.js';
import {buildContents, sendLongMessage} from './utils.js';
import {marked} from 'marked';
import TelegramBot, { InputMediaPhoto } from "node-telegram-bot-api";
import { Config } from './config.js';
import { Content, GenerateContentParameters } from '@google/genai';

async function handleImageCommand(commandMsg: TelegramBot.Message, albumMessages: TelegramBot.Message[] = [], bot: TelegramBot, BOT_ID: number, config: Config, replyToId: number) {
    const chatId = commandMsg.chat.id;
    try {
        const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MiB
        const conversationHistory = await getConversationHistory(chatId, commandMsg);
        let {contents, totalSize} = await buildContents(bot, conversationHistory, commandMsg, albumMessages, 'image');

        if (totalSize > MAX_FILE_SIZE) {
            const sentMsg = await bot.sendMessage(chatId, `총 파일 용량이 100MB를 초과할 수 없습니다. (현재: ${Math.round(totalSize / 1024 / 1024)}MB)`, {reply_to_message_id: replyToId});
            logMessage(sentMsg, BOT_ID, 'error');
            return;
        }

        // parts가 비어있는 비유효 턴을 제거하되, 사용자의 마지막 프롬프트(명령어) 턴은 유지
        contents = contents.filter((turn: Content, index) => (turn.parts && turn.parts.length > 0) || index === contents.length - 1);

        if (contents.length === 0) {
            const sentMsg = await bot.sendMessage(chatId, "프롬프트로 삼을 유효한 메시지가 없습니다.", {reply_to_message_id: replyToId});
            logMessage(sentMsg, BOT_ID, 'error');
            return;
        }

        const request: GenerateContentParameters = {
            model: config.imageModelName!,
            contents: contents,
            config: {},
        };
        const result: GenerationOutput = await generateFromHistory(request, config.googleApiKey!);

        if (result.error) {
            console.error(`[MODEL_ERROR] ChatID(${chatId}):`, result.error);
            const sentMsg = await bot.sendMessage(chatId, `생성 실패: ${result.error}`, {reply_to_message_id: replyToId});
            logMessage(sentMsg, BOT_ID, 'error');
            return;
        }

        const hasText = result.text && result.text.length > 0;
        const hasImages = result.images && result.images.length > 0;

        if (hasImages) {
            const caption = hasText ? marked.parseInline(result.text!) as string : undefined;

            if (result.images!.length > 1) {
                const media: InputMediaPhoto[] = result.images!.map((img, index) => {
                    const item: InputMediaPhoto = {type: 'photo', media: img.buffer as any};
                    if (index === 0 && caption) { // 캡션은 첫 번째 이미지에만 적용
                        item.caption = caption;
                        item.parse_mode = 'HTML';
                    }
                    return item;
                });
                const sentMessages = await bot.sendMediaGroup(chatId, media, {reply_to_message_id: replyToId});
                for(const sentMsg of sentMessages) {
                    logMessage(sentMsg, BOT_ID, 'image');
                }
            } else {
                const sentMsg = await bot.sendPhoto(chatId, result.images![0].buffer, {
                    caption: caption,
                    parse_mode: caption ? 'HTML' : undefined,
                    reply_to_message_id: replyToId
                });
                logMessage(sentMsg, BOT_ID, 'image');
            }
            console.log(`성공: 사용자(ID: ${commandMsg.from?.id})에게 ${result.images!.length}개의 콘텐츠 전송 완료.`);
        } else if (hasText) {
            const sentMsg = await sendLongMessage(bot, chatId, marked.parseInline(result.text!) as string, replyToId);
            logMessage(sentMsg, BOT_ID, 'image');
        }
    } catch (error: unknown) {
        console.error("이미지 명령어 처리 중 오류:", error);
        const sentMsg = await bot.sendMessage(chatId, "죄송합니다, 알 수 없는 오류가 발생했습니다.", {reply_to_message_id: replyToId});
        if (error instanceof Error) {
            logMessage(sentMsg, BOT_ID, error.message);
        } else {
            logMessage(sentMsg, BOT_ID, 'unknown error');
        }
    } finally {
        bot.setMessageReaction(commandMsg.chat.id, replyToId, {reaction: []});
    }
}

export {handleImageCommand};