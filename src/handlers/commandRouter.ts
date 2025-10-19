import TelegramBot from 'node-telegram-bot-api';
import {Config} from '../config.js';
import {getMessageMetadata, logMessage} from '../services/db.js';
import {isUserAuthorized} from '../services/auth.js';
import {commandMap} from '../commands.js';
import {Command} from '../types.js';

function getCommandFromText(text: string): {
    alias: string | null,
    targetBot: string | undefined,
    isCommandOnly: boolean
} {
    if (!text.startsWith('/')) {
        return {alias: null, targetBot: undefined, isCommandOnly: false};
    }
    const textParts = text.trim().split(/\s+/);
    const commandPart = textParts[0]; // e.g., /gemini@mybot
    const [commandWithSlash, targetBot] = commandPart.split('@');
    const alias = commandWithSlash.slice(1); // e.g., gemini
    const isCommandOnly = textParts.length === 1;

    return {alias, targetBot, isCommandOnly};
}

async function validatePrompt(msg: TelegramBot.Message, albumMessages: TelegramBot.Message[], bot: TelegramBot, BOT_ID: number): Promise<boolean> {
    const text = msg.text || msg.caption || '';
    const {alias, isCommandOnly} = getCommandFromText(text);
    const command = alias ? commandMap.get(alias) || null : null;

    if (command && isCommandOnly) {
        const hasMedia = msg.photo || msg.document || albumMessages.length > 0;
        const originalMsg = msg.reply_to_message;

        if (!hasMedia && !originalMsg) {
            const sentMsg = await bot.sendMessage(msg.chat.id, "명령어와 함께 프롬프트를 입력하거나, 내용이 있는 메시지에 답장하며 사용해주세요.", {reply_to_message_id: msg.message_id});
            logMessage(sentMsg, BOT_ID, 'error');
            return false;
        }

        if (!hasMedia && originalMsg?.from?.id === BOT_ID) {
            const sentMsg = await bot.sendMessage(msg.chat.id, "봇의 응답이나 다른 명령어에는 내용을 입력하여 답장해야 합니다.", {reply_to_message_id: msg.message_id});
            logMessage(sentMsg, BOT_ID, 'error');
            return false;
        }
    }
    return true;
}

function determinePromptSource(msg: TelegramBot.Message, albumMessages: TelegramBot.Message[], BOT_ID: number): TelegramBot.Message {
    const text = msg.text || msg.caption || '';
    const {alias, isCommandOnly} = getCommandFromText(text);
    const command = alias ? commandMap.get(alias) || null : null;

    if (command && isCommandOnly) {
        const hasMedia = msg.photo || msg.document || albumMessages.length > 0;
        const originalMsg = msg.reply_to_message;

        if (!hasMedia && originalMsg && originalMsg.from?.id !== BOT_ID) {
            console.log(`[${command.type}] 암시적 프롬프트 감지: 원본 메시지를 프롬프트 소스로 사용합니다.`);
            return originalMsg;
        }
    }
    return msg;
}

async function determineCommand(msg: TelegramBot.Message, BOT_ID: number, botUsername: string): Promise<Command | null> {
    const text = msg.text || msg.caption || '';
    const {alias, targetBot} = getCommandFromText(text);

    if (alias) {
        if (targetBot && targetBot.toLowerCase() !== botUsername.toLowerCase()) {
            console.log(`[CommandRouter] Command '/${alias}@${targetBot}' is not for this bot (@${botUsername}). Ignoring.`);
            return null;
        }

        const command = commandMap.get(alias) || null;
        if (command) {
            return command;
        }
    }

    if (msg.reply_to_message?.from?.id === BOT_ID) {
        const originalMsgMeta = await getMessageMetadata(msg.chat.id, msg.reply_to_message.message_id);
        if (originalMsgMeta?.command_type) {
            const type = originalMsgMeta.command_type;
            console.log(`'${type}' 대화의 연속으로 판단하여 응답합니다.`);
            const conversationCommand = (type === 'chat' || type === 'summarize') ? 'gemini' : type === 'image' ? 'image' : null;
            return conversationCommand ? commandMap.get(conversationCommand) || null : null;
        }
    }

    return null;
}

export async function routeCommand(
    msg: TelegramBot.Message,
    albumMessages: TelegramBot.Message[],
    bot: TelegramBot,
    BOT_ID: number,
    config: Config,
    botUsername: string
) {
    if (!msg.from || !isUserAuthorized(msg.chat.id, msg.from.id)) {
        logMessage(msg, BOT_ID);
        return;
    }

    const command = await determineCommand(msg, BOT_ID, botUsername);

    if (!command) {
        logMessage(msg, BOT_ID);
        return;
    }

    logMessage(msg, BOT_ID, command.type);

    if (command.ignoreArgs) {
        await command.handler(msg, [], bot, BOT_ID, config, msg.message_id);
        return;
    }

    if (!(await validatePrompt(msg, albumMessages, bot, BOT_ID))) {
        return;
    }

    const promptSourceMsg = determinePromptSource(msg, albumMessages, BOT_ID);
    const isImplicitContinuation = msg.reply_to_message?.from?.id === BOT_ID && !(msg.text || msg.caption || '').startsWith('/');

    bot.setMessageReaction(msg.chat.id, msg.message_id, {reaction: [{type: 'emoji', emoji: '👍'}]});

    const sourceMsgForHandler = isImplicitContinuation ? msg : promptSourceMsg;
    const albumForHandler = isImplicitContinuation ? [] : albumMessages;

    await command.handler(sourceMsgForHandler, albumForHandler, bot, BOT_ID, config, msg.message_id);
}
