import TelegramBot from 'node-telegram-bot-api';
import { config } from './src/config.js';
import { initDb, logMessage, getMessage } from './src/db.js';
// 💥 수정: import 경로 변경
import { processImageCommand } from './src/imageCommandHandler.js';
import { processChatCommand } from './src/chatCommandHandler.js';
import { isUserAuthorized } from './src/auth.js';

initDb();

console.log("텔레그램 봇을 시작합니다...");
const bot = new TelegramBot(config.telegramToken, { polling: true });

bot.getMe().then(me => {
    const BOT_ID = me.id;
    console.log(`봇 정보 확인: ${me.username} (ID: ${BOT_ID})`);

    bot.on('message', async (msg) => {
        // 모든 메시지를 우선 DB에 기록
        logMessage(msg, BOT_ID);

        const text = msg.text || msg.caption || '';

        // --- 명령어 라우팅 ---

        // 1. /start 명령어
        if (text.startsWith('/start')) {
            const helpText = `
안녕하세요! Gemini 대화형 이미지/채팅 봇입니다. 🤖

**명령어:**
- \`/image [프롬프트]\`: 이미지 생성 및 수정
- \`/gemini [프롬프트]\`: 일반 대화

**활용:**
- 사진이나 글에 답장하며 대화하듯이 명령을 내릴 수 있습니다.
- 봇의 \`/gemini\` 응답에 답장하면 명령어 없이 대화를 이어갈 수 있습니다.
- 채팅 기록을 바탕으로 전체 대화의 맥락을 이해합니다.
`;
            const sentMsg = await bot.sendMessage(msg.chat.id, helpText, { parse_mode: 'Markdown' });
            logMessage(sentMsg, BOT_ID);
            return;
        }

        // 2. 명시적 명령어 (/image, /gemini)
        if (text.startsWith('/image')) {
            await processImageCommand(msg, bot, BOT_ID, config);
            return;
        }
        if (text.startsWith('/gemini')) {
            await processChatCommand(msg, bot, BOT_ID, config);
            return;
        }

        // 3. 암시적 명령어 (봇의 'chat' 응답에 대한 답장)
        if (msg.reply_to_message && msg.reply_to_message.from.id === BOT_ID) {
            const originalBotMsg = await getMessage(msg.chat.id, msg.reply_to_message.message_id);

            if (originalBotMsg && originalBotMsg.command_type === 'chat') {
                console.log(`'chat' 대화의 연속으로 판단하여 응답합니다.`);
                await processChatCommand(msg, bot, BOT_ID, config);
                return;
            }
        }
    });

    console.log("봇이 성공적으로 시작되었으며, 메시지를 기다리고 있습니다.");
}).catch(err => {
    console.error("봇 시작 실패: 봇 정보를 가져올 수 없습니다. 토큰이 유효한지 확인해주세요.", err);
    process.exit(1);
});