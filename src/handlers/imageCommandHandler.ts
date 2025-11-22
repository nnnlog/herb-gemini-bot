import {GenerateContentParameters} from '@google/genai';
import {marked} from 'marked';
import TelegramBot, {InputMediaPhoto} from "node-telegram-bot-api";
import {Config} from '../config.js';
import {handleCommandError, prepareContentForModel} from "../helpers/commandHelper.js";
import {sendLongMessage} from '../helpers/utils.js';
import {generateFromHistory, GenerationOutput} from '../services/aiHandler.js';
import {logMessage} from '../services/db.js';

async function handleImageCommand(commandMsg: TelegramBot.Message, albumMessages: TelegramBot.Message[] = [], bot: TelegramBot, BOT_ID: number, config: Config, replyToId: number) {
    const chatId = commandMsg.chat.id;
    try {
        const contentPreparationResult = await prepareContentForModel(bot, commandMsg, albumMessages, 'image');

        if (contentPreparationResult.error) {
            const sentMsg = await bot.sendMessage(chatId, contentPreparationResult.error.message, {reply_to_message_id: replyToId});
            logMessage(sentMsg, BOT_ID, 'error');
            return;
        }

        const request: GenerateContentParameters = {
            model: config.imageModelName!,
            contents: contentPreparationResult.contents!,
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
                for (const sentMsg of sentMessages) {
                    logMessage(sentMsg, BOT_ID, 'image', {parts: result.parts});
                }
            } else {
                const sentMsg = await bot.sendPhoto(chatId, result.images![0].buffer, {
                    caption: caption,
                    parse_mode: caption ? 'HTML' : undefined,
                    reply_to_message_id: replyToId
                });
                logMessage(sentMsg, BOT_ID, 'image', {parts: result.parts});
            }
            console.log(`성공: 사용자(ID: ${commandMsg.from?.id})에게 ${result.images!.length}개의 콘텐츠 전송 완료.`);
        } else if (hasText) {
            const sentMsg = await sendLongMessage(bot, chatId, marked.parseInline(result.text!) as string, replyToId);
            logMessage(sentMsg, BOT_ID, 'image', {parts: result.parts});
        }
    } catch (error: unknown) {
        await handleCommandError(error, bot, chatId, replyToId, BOT_ID, 'image');
    } finally {
        bot.setMessageReaction(commandMsg.chat.id, replyToId, {reaction: []});
    }
}

export {handleImageCommand};
