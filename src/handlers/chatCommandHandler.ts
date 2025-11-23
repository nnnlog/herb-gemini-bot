import {GenerateContentParameters} from '@google/genai';
import TelegramBot from "node-telegram-bot-api";
import {Config} from '../config.js';
import {handleCommandError, prepareContentForModel} from "../helpers/commandHelper.js";
import {handleGeminiResponse} from '../helpers/responseHelper.js';
import {generateFromHistory, GenerationOutput} from '../services/aiHandler.js';
import {logMessage} from '../services/db.js';

async function handleChatCommand(commandMsg: TelegramBot.Message, albumMessages: TelegramBot.Message[] = [], bot: TelegramBot, BOT_ID: number, config: Config, replyToId: number) {
    const chatId = commandMsg.chat.id;
    try {
        const contentPreparationResult = await prepareContentForModel(bot, commandMsg, albumMessages, 'gemini');

        if (contentPreparationResult.error) {
            const sentMsg = await bot.sendMessage(chatId, contentPreparationResult.error.message, {reply_to_message_id: replyToId});
            logMessage(sentMsg, BOT_ID, 'error');
            return;
        }

        const request: GenerateContentParameters = {
            model: config.geminiProModel!,
            contents: contentPreparationResult.contents!,
            config: {
                tools: [
                    {googleSearch: {}},
                    {codeExecution: {}},
                    {urlContext: {}},
                ],
                thinkingConfig: {
                    thinkingBudget: 32768,
                },
                httpOptions: {
                    timeout: 1000 * 60 * 10,
                },
            }
        };

        const result: GenerationOutput = await generateFromHistory(request, config.googleApiKey!);

        await handleGeminiResponse(bot, commandMsg, result, BOT_ID, replyToId, 'chat');

    } catch (error: unknown) {
        await handleCommandError(error, bot, chatId, replyToId, BOT_ID, 'chat');
    } finally {
        bot.setMessageReaction(commandMsg.chat.id, replyToId, {reaction: []});
    }
}

export {handleChatCommand};

