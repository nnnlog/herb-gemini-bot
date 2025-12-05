import {GenerateContentParameters} from '@google/genai';
import TelegramBot from "node-telegram-bot-api";
import {Config} from '../config.js';
import {handleCommandError, prepareContentForModel} from "../helpers/commandHelper.js";
import {handleGeminiResponse} from '../helpers/responseHelper.js';
import {generateFromHistory, GenerationOutput} from '../services/aiHandler.js';
import {logMessage} from '../services/db.js';
import {Session} from '../services/session.js';
import {ParsedCommand} from "../types.js";

async function handleImageCommand(commandMsg: TelegramBot.Message, albumMessages: TelegramBot.Message[] = [], bot: TelegramBot, BOT_ID: number, config: Config, replyToId: number, parsedCommand?: ParsedCommand) {
    const chatId = commandMsg.chat.id;
    try {
        const session = await Session.create(chatId, commandMsg);
        const contentPreparationResult = await prepareContentForModel(bot, commandMsg, albumMessages, 'image', session, ['image', 'img']);

        if (contentPreparationResult.error) {
            const sentMsg = await bot.sendMessage(chatId, contentPreparationResult.error.message, {reply_to_message_id: replyToId});
            logMessage(sentMsg, BOT_ID, 'error');
            return;
        }

        const resolution = parsedCommand?.args?.resolution || '1k';

        const request: GenerateContentParameters = {
            model: config.imageModelName!,
            contents: contentPreparationResult.contents!,
            config: {
                tools: [
                    {googleSearch: {}}
                ],
                imageConfig: {
                    imageSize: resolution.toUpperCase(),
                }
            },
        };
        const result: GenerationOutput = await generateFromHistory(request, config.googleApiKey!);

        await handleGeminiResponse(bot, commandMsg, result, BOT_ID, replyToId, 'image');

    } catch (error: unknown) {
        await handleCommandError(error, bot, chatId, replyToId, BOT_ID, 'image');
    } finally {
        bot.setMessageReaction(commandMsg.chat.id, replyToId, {reaction: []});
    }
}

export {handleImageCommand};

