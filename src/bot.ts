import TelegramBot from 'node-telegram-bot-api';
import {commands} from './commands.js';
import {config} from './config.js';
import {processMessage} from './handlers/mediaGroupHandler.js';
import {initDb} from './services/db.js';

initDb();

console.log("텔레그램 봇을 시작합니다...");

if (!config.telegramToken) {
    console.error("TELEGRAM_BOT_TOKEN is not set in the environment variables.");
    process.exit(1);
}

const bot = new TelegramBot(config.telegramToken, {polling: true});

bot.getMe().then(async (me) => {
    if (!me.id || !me.username) {
        console.error("봇 ID 또는 사용자명을 가져올 수 없습니다.");
        process.exit(1);
    }
    const BOT_ID = me.id;
    const BOT_USERNAME = me.username;
    console.log(`봇 정보 확인: ${BOT_USERNAME} (ID: ${BOT_ID})`);

    // Register commands with Telegram, including aliases
    const botCommands = commands
        .filter(cmd => cmd.showInList)
        .flatMap(cmd => {
            const mainCommand = cmd.aliases[0];
            const mainCommandEntry = {
                command: mainCommand,
                description: cmd.description
            };

            const aliasEntries = cmd.aliases.slice(1).map(alias => ({
                command: alias,
                description: `/${mainCommand}의 별칭. ${cmd.description}`
            }));

            return [mainCommandEntry, ...aliasEntries];
        });

    for (const type of ["all_private_chats", "all_chat_administrators", "all_group_chats"] as const) {
        bot.setMyCommands(botCommands, {
            scope: {
                type,
            },
        });
    }

    bot.on('message', async (msg: TelegramBot.Message) => {
        // 모든 메시지를 mediaGroupHandler로 전달하여 처리
        await processMessage(msg, bot, BOT_ID, config, BOT_USERNAME);
    });

    console.log("봇이 성공적으로 시작되었으며, 메시지를 기다리고 있습니다.");
}).catch(err => {
    console.error("봇 시작 실패: 봇 정보를 가져올 수 없습니다. 토큰이 유효한지 확인해주세요.", err);
    process.exit(1);
});
