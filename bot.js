import TelegramBot from 'node-telegram-bot-api';
import { config } from './src/config.js';
import { initDb, logMessage, getMessage, getMessageMetadata } from './src/db.js';
import { handleImageCommand } from './src/imageCommandHandler.js';
import { handleChatCommand } from './src/chatCommandHandler.js';
import { isUserAuthorized } from './src/auth.js';

initDb();
const mediaGroupCache = new Map();

console.log("텔레그램 봇을 시작합니다...");
const bot = new TelegramBot(config.telegramToken, { polling: true });

async function processCommand(msg, albumMessages, bot, BOT_ID, config) {
    if (!isUserAuthorized(msg.chat.id, msg.from.id)) {
        return logMessage(msg, BOT_ID);
    }

    const text = msg.text || msg.caption || '';

    // --- 프롬프트 예외 처리 ---
    const commandOnlyRegex = /^\/(gemini|image)(?:@\w+bot)?\s*$/;
    const isCommandOnly = commandOnlyRegex.test(text);
    const hasMedia = msg.photo || msg.document || albumMessages.length > 0;

    if (isCommandOnly && !hasMedia) {
        const originalMsg = msg.reply_to_message;
        if (!originalMsg) {
            const sentMsg = await bot.sendMessage(msg.chat.id, "명령어와 함께 프롬프트를 입력하거나, 내용이 있는 메시지에 답장하며 사용해주세요.", { reply_to_message_id: msg.message_id });
            logMessage(sentMsg, BOT_ID, 'error');
            return;
        }

        const isOriginalFromBot = originalMsg.from.id === BOT_ID;
        const hasOriginalMedia = originalMsg.photo || originalMsg.document;
        const isOriginalCommandOnly = commandOnlyRegex.test(originalMsg.text || originalMsg.caption || '');
        if (isOriginalFromBot || (isOriginalCommandOnly && !hasOriginalMedia)) {
            const sentMsg = await bot.sendMessage(msg.chat.id, "봇의 응답이나 다른 명령어에는 내용을 입력하여 답장해야 합니다.", { reply_to_message_id: msg.message_id });
            logMessage(sentMsg, BOT_ID, 'error');
            return;
        }
    }

    // --- 암시적 프롬프트 감지 ---
    let promptSourceMsg = msg;
    if (isCommandOnly && !hasMedia && msg.reply_to_message && msg.reply_to_message.from.id !== BOT_ID) {
        const originalMsg = msg.reply_to_message;
        const isValidTarget = originalMsg.text || originalMsg.caption || originalMsg.photo || originalMsg.document || originalMsg.forward_from || originalMsg.forward_from_chat;
        if (isValidTarget) {
            console.log(`[${text.slice(1)}] 암시적 프롬프트 감지: 원본 메시지를 프롬프트 소스로 사용합니다.`);
            promptSourceMsg = originalMsg;
        }
    }

    // --- 명령어 타입 확정 및 라우팅 ---
    let commandType = null;
    if (text.startsWith('/image')) commandType = 'image';
    else if (text.startsWith('/gemini')) commandType = 'chat';

    if (commandType) {
        // 확정된 타입으로 로그 업데이트 시, 실제 명령어가 담긴 msg를 기준으로 기록해야 합니다.
        logMessage(msg, BOT_ID, commandType);
        // 봇이 메시지를 수신했음을 사용자에게 알리기 위해 반응을 추가합니다.
        bot.setMessageReaction(msg.chat.id, msg.message_id, { reaction: [{ type: 'emoji', emoji: '👍' }] });

        if (commandType === 'image') {
            return handleImageCommand(promptSourceMsg, albumMessages, bot, BOT_ID, config, msg.message_id);
        } else {
            return handleChatCommand(promptSourceMsg, albumMessages, bot, BOT_ID, config, msg.message_id);
        }
    }

    // --- 암시적 대화 연속 라우팅 ---
    if (msg.reply_to_message?.from.id === BOT_ID) {
        const originalMsgMeta = await getMessageMetadata(msg.chat.id, msg.reply_to_message.message_id);
        if (originalMsgMeta?.command_type === 'chat') {
            logMessage(msg, BOT_ID, 'chat');
            bot.setMessageReaction(msg.chat.id, msg.message_id, { reaction: [{ type: 'emoji', emoji: '👍' }] });
            console.log(`'chat' 대화의 연속으로 판단하여 응답합니다.`);
            return handleChatCommand(msg, [], bot, BOT_ID, config, msg.message_id);
        } else if (originalMsgMeta?.command_type === 'image') {
            logMessage(msg, BOT_ID, 'image');
            bot.setMessageReaction(msg.chat.id, msg.message_id, { reaction: [{ type: 'emoji', emoji: '👍' }] });
            console.log(`'image' 대화의 연속으로 판단하여 응답합니다.`);
            return handleImageCommand(msg, [], bot, BOT_ID, config, msg.message_id);
        }
    }

    // 위 모든 경우에 해당하지 않는 일반 메시지 기록
    logMessage(msg, BOT_ID);
}


bot.getMe().then(me => {
    const BOT_ID = me.id;
    console.log(`봇 정보 확인: ${me.username} (ID: ${BOT_ID})`);

    bot.on('message', async (msg) => {
        const text = msg.text || msg.caption || '';

        if (text.startsWith('/start')) {
            const helpText = `
안녕하세요! Gemini Bot 입니다.

**명령어:**
- \`/image [프롬프트]\`
- \`/gemini [프롬프트]\`

**활용:**
- 사진이나 글에 답장하며 대화하듯이 명령을 내릴 수 있습니다.
- 봇의 응답에 답장하면 명령어 없이 대화를 이어갈 수 있습니다.
- 채팅 기록을 바탕으로 전체 대화의 맥락을 이해합니다.
- 앨범(여러 사진)을 첨부하여 명령을 내릴 수 있습니다.
`;
            const sentMsg = await bot.sendMessage(msg.chat.id, helpText, { parse_mode: 'Markdown' });
            logMessage(sentMsg, BOT_ID, 'start');
            return;
        }

        // 앨범 메시지 처리 (사진, 문서 등 media_group_id가 있는 모든 메시지)
        if (msg.media_group_id) {
            if (!mediaGroupCache.has(msg.media_group_id)) {
                mediaGroupCache.set(msg.media_group_id, { messages: [], timer: null });
            }
            const group = mediaGroupCache.get(msg.media_group_id);
            group.messages.push(msg);
            clearTimeout(group.timer);
            group.timer = setTimeout(() => {
                // 1. 그룹에 속한 모든 메시지를 먼저 DB에 기록합니다.
                group.messages.forEach(groupMsg => logMessage(groupMsg, BOT_ID));

                // 2. 그룹에서 기준이 되는 명령어 메시지를 찾습니다.
                const commandMsg = group.messages.find(m => (m.caption || '').startsWith('/')) || group.messages[0];
                const otherMessages = group.messages.filter(m => m.message_id !== commandMsg.message_id);

                // 3. 모든 정보가 저장된 후, 명령어를 처리합니다.
                processCommand(commandMsg, otherMessages, bot, BOT_ID, config);
                mediaGroupCache.delete(msg.media_group_id);
            }, 1000);
        } else {
            // 일반 메시지
            processCommand(msg, [], bot, BOT_ID, config);
        }
    });

    console.log("봇이 성공적으로 시작되었으며, 메시지를 기다리고 있습니다.");
}).catch(err => {
    console.error("봇 시작 실패: 봇 정보를 가져올 수 없습니다. 토큰이 유효한지 확인해주세요.", err);
    process.exit(1);
});