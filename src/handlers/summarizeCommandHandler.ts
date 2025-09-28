import { generateFromHistory, GenerationOutput } from '../services/aiHandler.js';
import { logMessage } from '../services/db.js';
import { sendLongMessage } from '../helpers/utils.js';
import TelegramBot from "node-telegram-bot-api";
import { Config } from '../config.js';
import { GenerateContentParameters } from '@google/genai';
import { handleCommandError, prepareContentForModel } from "../helpers/commandHelper.js";
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// system.md 파일 경로를 안전하게 가져옵니다.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const systemPromptPath = path.join(__dirname, 'system.md');

let systemPromptCache: string | null = null;

async function getSystemPrompt(): Promise<string> {
    if (systemPromptCache) {
        return systemPromptCache;
    }
    try {
        systemPromptCache = await fs.readFile(systemPromptPath, 'utf-8');
        return systemPromptCache;
    } catch (error) {
        console.error("system.md 파일을 읽는데 실패했습니다.", error);
        // 시스템 프롬프트를 읽지 못하면 에러를 반환하거나 기본값을 사용
        throw new Error("Summarize 기능의 시스템 프롬프트를 로드할 수 없습니다.");
    }
}

async function handleSummarizeCommand(commandMsg: TelegramBot.Message, albumMessages: TelegramBot.Message[] = [], bot: TelegramBot, BOT_ID: number, config: Config, replyToId: number) {
    const chatId = commandMsg.chat.id;
    try {
        const contentPreparationResult = await prepareContentForModel(bot, commandMsg, albumMessages, 'summarize');

        if (contentPreparationResult.error) {
            const sentMsg = await bot.sendMessage(chatId, contentPreparationResult.error.message, { reply_to_message_id: replyToId });
            logMessage(sentMsg, BOT_ID, 'error');
            return;
        }

        const systemInstruction = await getSystemPrompt();

        const request: GenerateContentParameters = {
            model: "gemini-2.5-pro", // 요구사항에 따라 모델 지정
            contents: contentPreparationResult.contents!,
            systemInstruction: {
                role: 'system',
                parts: [{ text: systemInstruction }]
            },
            config: {
                httpOptions: {
                    timeout: 120000,
                },
            }
        };

        const result: GenerationOutput = await generateFromHistory(request, config.googleApiKey!);

        if (result.error) {
            const sentMsg = await bot.sendMessage(chatId, `요약 생성 실패: ${result.error}`, { reply_to_message_id: replyToId });
            logMessage(sentMsg, BOT_ID, 'error');
        } else if (result.parts && result.parts.length > 0 && result.parts[0].text) {
            const fullResponse = result.parts[0].text;
            const sentMsg = await sendLongMessage(bot, chatId, fullResponse, replyToId);
            // 중요: 다음 대화가 일반 chat으로 이어지도록 command_type을 'chat'으로,
            // 하지만 이 대화의 시작점은 'summarize'였음을 기록
            logMessage(sentMsg, BOT_ID, 'chat', 'summarize');
        } else {
            const sentMsg = await bot.sendMessage(chatId, "모델이 요약 내용을 생성하지 않았습니다.", { reply_to_message_id: replyToId });
            logMessage(sentMsg, BOT_ID, 'error');
        }
    } catch (error: unknown) {
        await handleCommandError(error, bot, chatId, replyToId, BOT_ID, 'summarize');
    } finally {
        bot.setMessageReaction(commandMsg.chat.id, replyToId, { reaction: [] });
    }
}

export { handleSummarizeCommand };