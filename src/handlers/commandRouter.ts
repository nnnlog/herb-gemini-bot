import TelegramBot from 'node-telegram-bot-api';
import { Config } from '../config.js';
import { getMessageMetadata, logMessage } from '../services/db.js';
import { handleImageCommand } from './imageCommandHandler.js';
import { handleChatCommand } from './chatCommandHandler.js';
import { isUserAuthorized } from '../services/auth.js';
import { handleSummarizeCommand } from './summarizeCommandHandler.js';

type CommandType = 'image' | 'chat' | 'summarize';

// 1. 프롬프트 유효성 검사
async function validatePrompt(msg: TelegramBot.Message, albumMessages: TelegramBot.Message[], bot: TelegramBot, BOT_ID: number): Promise<boolean> {
    const text = msg.text || msg.caption || '';
    const commandOnlyRegex = /^\/(gemini|image|img|summarize)(?:@\w+bot)?\s*$/;
    const isCommandOnly = commandOnlyRegex.test(text);
    const hasMedia = msg.photo || msg.document || albumMessages.length > 0;

    if (isCommandOnly && !hasMedia) {
        const originalMsg = msg.reply_to_message;
        if (!originalMsg) {
            const sentMsg = await bot.sendMessage(msg.chat.id, "명령어와 함께 프롬프트를 입력하거나, 내용이 있는 메시지에 답장하며 사용해주세요.", { reply_to_message_id: msg.message_id });
            logMessage(sentMsg, BOT_ID, 'error');
            return false;
        }

        if (!originalMsg.from) return false;

        const isOriginalFromBot = originalMsg.from.id === BOT_ID;
        const hasOriginalMedia = originalMsg.photo || originalMsg.document;
        const isOriginalCommandOnly = commandOnlyRegex.test(originalMsg.text || originalMsg.caption || '');

        if (isOriginalFromBot || (isOriginalCommandOnly && !hasOriginalMedia)) {
            const sentMsg = await bot.sendMessage(msg.chat.id, "봇의 응답이나 다른 명령어에는 내용을 입력하여 답장해야 합니다.", { reply_to_message_id: msg.message_id });
            logMessage(sentMsg, BOT_ID, 'error');
            return false;
        }
    }
    return true;
}

// 2. 프롬프트 소스 결정
function determinePromptSource(msg: TelegramBot.Message, albumMessages: TelegramBot.Message[], BOT_ID: number): TelegramBot.Message {
    const text = msg.text || msg.caption || '';
    const commandOnlyRegex = /^\/(gemini|image|img|summarize)(?:@\w+bot)?\s*$/;
    const isCommandOnly = commandOnlyRegex.test(text);
    const hasMedia = msg.photo || msg.document || albumMessages.length > 0;

    if (isCommandOnly && !hasMedia && msg.reply_to_message && msg.reply_to_message.from && msg.reply_to_message.from.id !== BOT_ID) {
        const originalMsg = msg.reply_to_message;
        const isValidTarget = originalMsg.text || originalMsg.caption || originalMsg.photo || originalMsg.document || originalMsg.forward_from || originalMsg.forward_from_chat;
        if (isValidTarget) {
            const commandName = text.split('@')[0].slice(1);
            console.log(`[${commandName}] 암시적 프롬프트 감지: 원본 메시지를 프롬프트 소스로 사용합니다.`);
            return originalMsg;
        }
    }
    return msg;
}

// 3. 명령어 타입 결정
async function determineCommandType(msg: TelegramBot.Message, BOT_ID: number): Promise<CommandType | null> {
    const text = msg.text || msg.caption || '';

    const imageRegex = /^\/(image|img)(?:@\w+bot)?/;
    const chatRegex = /^\/(gemini)(?:@\w+bot)?/;
    const summarizeRegex = /^\/(summarize)(?:@\w+bot)?/;

    // 명시적 명령어
    if (imageRegex.test(text)) return 'image';
    if (chatRegex.test(text)) return 'chat';
    if (summarizeRegex.test(text)) return 'summarize';

    // 암시적 대화 연속
    if (msg.reply_to_message?.from?.id === BOT_ID) {
        const originalMsgMeta = await getMessageMetadata(msg.chat.id, msg.reply_to_message.message_id);
        if (originalMsgMeta?.command_type === 'chat' || originalMsgMeta?.command_type === 'summarize') {
            console.log(`'chat' 또는 'summarize' 대화의 연속으로 판단하여 'chat'으로 응답합니다.`);
            return 'chat';
        } else if (originalMsgMeta?.command_type === 'image') {
            console.log(`'image' 대화의 연속으로 판단하여 응답합니다.`);
            return 'image';
        }
    }

    return null;
}

// 4. 메인 라우팅 함수
export async function routeCommand(
    msg: TelegramBot.Message,
    albumMessages: TelegramBot.Message[],
    bot: TelegramBot,
    BOT_ID: number,
    config: Config
) {
    // 사용자 인증
    if (!msg.from || !isUserAuthorized(msg.chat.id, msg.from.id)) {
        logMessage(msg, BOT_ID);
        return;
    }

    // 프롬프트 유효성 검사
    if (!(await validatePrompt(msg, albumMessages, bot, BOT_ID))) {
        return;
    }

    const commandType = await determineCommandType(msg, BOT_ID);

    if (commandType) {
        const promptSourceMsg = determinePromptSource(msg, albumMessages, BOT_ID);
        const isImplicitContinuation = msg.reply_to_message?.from?.id === BOT_ID;

        logMessage(msg, BOT_ID, commandType);
        bot.setMessageReaction(msg.chat.id, msg.message_id, { reaction: [{ type: 'emoji', emoji: '👍' }] });

        const handler = commandType === 'image' ? handleImageCommand :
                        commandType === 'summarize' ? handleSummarizeCommand : handleChatCommand;

        // 암시적 대화 연속일 경우, 프롬프트 소스는 현재 메시지이며 앨범은 사용하지 않음
        const sourceMsgForHandler = isImplicitContinuation ? msg : promptSourceMsg;
        const albumForHandler = isImplicitContinuation ? [] : albumMessages;

        await handler(sourceMsgForHandler, albumForHandler, bot, BOT_ID, config, msg.message_id);
    } else {
        // 처리할 명령어가 없는 경우 메시지 기록만
        logMessage(msg, BOT_ID);
    }
}
