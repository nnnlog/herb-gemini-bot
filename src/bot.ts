import TelegramBot from 'node-telegram-bot-api';
import { config } from './config.js';
import { initDb, logMessage } from './services/db.js';
import { processMessage } from './handlers/mediaGroupHandler.js';

initDb();

console.log("텔레그램 봇을 시작합니다...");

if (!config.telegramToken) {
    console.error("TELEGRAM_BOT_TOKEN is not set in the environment variables.");
    process.exit(1);
}

const bot = new TelegramBot(config.telegramToken, { polling: true });

bot.getMe().then(me => {
    if (!me.id) {
        console.error("봇 ID를 가져올 수 없습니다.");
        process.exit(1);
    }
    const BOT_ID = me.id;
    console.log(`봇 정보 확인: ${me.username} (ID: ${BOT_ID})`);

    bot.on('message', async (msg: TelegramBot.Message) => {
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

        // 모든 메시지를 mediaGroupHandler로 전달하여 처리
        await processMessage(msg, bot, BOT_ID, config);
    });

    console.log("봇이 성공적으로 시작되었으며, 메시지를 기다리고 있습니다.");
}).catch(err => {
    console.error("봇 시작 실패: 봇 정보를 가져올 수 없습니다. 토큰이 유효한지 확인해주세요.", err);
    process.exit(1);
});
