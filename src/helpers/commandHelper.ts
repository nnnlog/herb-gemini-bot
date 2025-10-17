import { Content } from '@google/genai';
import TelegramBot from 'node-telegram-bot-api';
import { getConversationHistory, logMessage } from '../services/db.js';
import { buildContents } from './utils.js';

interface ContentPreparationResult {
    contents?: Content[];
    error?: {
        message: string;
    };
}

export async function prepareContentForModel(
    bot: TelegramBot,
    commandMsg: TelegramBot.Message,
    albumMessages: TelegramBot.Message[],
    commandType: 'image' | 'gemini' | 'summarize'
): Promise<ContentPreparationResult> {
    const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MiB
    const conversationHistory = await getConversationHistory(commandMsg.chat.id, commandMsg);
    let { contents, totalSize } = await buildContents(bot, conversationHistory, commandMsg, albumMessages, commandType);

    if (totalSize > MAX_FILE_SIZE) {
        return { error: { message: `총 파일 용량이 100MB를 초과할 수 없습니다. (현재: ${Math.round(totalSize / 1024 / 1024)}MB)` } };
    }

    contents = contents.filter((turn, index) => (turn.parts && turn.parts.length > 0) || index === contents.length - 1);

    if (contents.length === 0) {
        return { error: { message: "프롬프트로 삼을 유효한 메시지가 없습니다." } };
    }

    return { contents };
}

export async function handleCommandError(
    error: unknown,
    bot: TelegramBot,
    chatId: number,
    replyToId: number,
    BOT_ID: number,
    commandType: string
) {
    console.error(`${commandType} 명령어 처리 중 오류:`, error);
    const sentMsg = await bot.sendMessage(chatId, "죄송합니다, 알 수 없는 오류가 발생했습니다.", { reply_to_message_id: replyToId });
    if (error instanceof Error) {
        logMessage(sentMsg, BOT_ID, error.message);
    } else {
        logMessage(sentMsg, BOT_ID, 'unknown error');
    }
}
