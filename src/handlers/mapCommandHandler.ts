import {generateFromHistory, GenerationOutput} from '../services/aiHandler.js';
import {logMessage} from '../services/db.js';
import {sendLongMessage} from '../helpers/utils.js';
import {marked} from 'marked';
import TelegramBot from "node-telegram-bot-api";
import {Config} from '../config.js';
import {GenerateContentParameters} from '@google/genai';
import {handleCommandError, prepareContentForModel} from "../helpers/commandHelper.js";

async function handleMapCommand(commandMsg: TelegramBot.Message, albumMessages: TelegramBot.Message[] = [], bot: TelegramBot, BOT_ID: number, config: Config, replyToId: number) {
    const chatId = commandMsg.chat.id;
    try {
        const contentPreparationResult = await prepareContentForModel(bot, commandMsg, albumMessages, 'map');

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
                    {googleMaps: {}},
                    {urlContext: {}},
                ],
                thinkingConfig: {
                    thinkingBudget: 32768,
                },
                httpOptions: {
                    timeout: 120000,
                },
            }
        };

        const result: GenerationOutput = await generateFromHistory(request, config.googleApiKey!);

        if (result.error) {
            const sentMsg = await bot.sendMessage(chatId, `응답 생성 실패: ${result.error}`, {reply_to_message_id: replyToId});
            logMessage(sentMsg, BOT_ID, 'error');
        } else if (result.parts && result.parts.length > 0) {
            let fullResponse = '';
            for (const part of result.parts) {
                if (part.text) {
                    fullResponse += part.text;
                }
            }

            // Grounding Metadata 처리
            if (result.groundingMetadata) {
                const {webSearchQueries, groundingChunks} = result.groundingMetadata;
                let metadataText = '\n';

                if (webSearchQueries && webSearchQueries.length > 0) {
                    metadataText += `\n---\n🔍 **검색어**: ${webSearchQueries.map(q => `'${q}'`).join(', ')}\n`;
                }

                if (groundingChunks && groundingChunks.length > 0) {
                    const uniqueSources = new Map<string, string>();
                    groundingChunks.forEach(chunk => {
                        if (chunk.web && chunk.web.uri && chunk.web.title) {
                            uniqueSources.set(chunk.web.uri, chunk.web.title);
                        }
                    });

                    if (uniqueSources.size > 0) {
                        metadataText += `\n📚 **출처**:\n`;
                        uniqueSources.forEach((title, uri) => {
                            metadataText += ` - [${title}](${uri})\n`;
                        });
                    }
                }
                fullResponse += metadataText;
            }

            const sentMsg = await sendLongMessage(bot, chatId, marked.parseInline(fullResponse.trim() || '') as string, replyToId);
            logMessage(sentMsg, BOT_ID, 'map');
        } else {
            const sentMsg = await bot.sendMessage(chatId, "모델이 텍스트 응답을 생성하지 않았습니다.", {reply_to_message_id: replyToId});
            logMessage(sentMsg, BOT_ID, 'error');
        }
    } catch (error: unknown) {
        await handleCommandError(error, bot, chatId, replyToId, BOT_ID, 'map');
    } finally {
        bot.setMessageReaction(commandMsg.chat.id, replyToId, {reaction: []});
    }
}

export {handleMapCommand};
