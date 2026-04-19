import TelegramBot from 'node-telegram-bot-api';
import {ChatCommand} from './commands/ChatCommand.js';
import {HelpCommand} from './commands/HelpCommand.js';
import {ImageCommand} from './commands/ImageCommand.js';
import {MapCommand} from './commands/MapCommand.js';
import {StartCommand} from './commands/StartCommand.js';
import {SummarizeCommand} from './commands/SummarizeCommand.js';
import {config} from './config.js';
import {CommandDispatcher} from './managers/CommandDispatcher.js';
import {sessionManager} from './managers/SessionManager.js';
import {CommandType, getMessage, getMessageMetadata, initDb} from './services/db.js';

initDb();

const bot = new TelegramBot(config.telegramToken, {
    polling: {
        autoStart: false,
        params: {
            allowed_updates: ['message', 'callback_query']
        }
    },
    request: {
        agentOptions: {
            family: 4
        }
    } as any
});

const dispatcher = new CommandDispatcher(bot, sessionManager, config);

dispatcher.register(new StartCommand(dispatcher));
dispatcher.register(new HelpCommand(dispatcher));
dispatcher.register(new ChatCommand());
dispatcher.register(new ImageCommand());
dispatcher.register(new MapCommand());
dispatcher.register(new SummarizeCommand());

const mediaGroups = new Map<string, TelegramBot.Message[]>();
const mediaGroupTimers = new Map<string, NodeJS.Timeout>();

(async () => {
    const me = await bot.getMe();
    const BOT_ID = me.id;
    const BOT_USERNAME = me.username;

    dispatcher.setBotUsername(BOT_USERNAME || '');
    dispatcher.setBotId(BOT_ID);


    console.log(`Bot started as @${BOT_USERNAME}`);

    const botCommands = dispatcher.getCommands()
        .filter(cmd => cmd.showInList)
        .flatMap(cmd => {
            const mainCommand = cmd.aliases[0];
            const mainCommandEntry = {command: mainCommand, description: cmd.description};
            const aliasEntries = cmd.aliases.slice(1).map(alias => ({
                command: alias,
                description: `/${mainCommand}의 별칭. ${cmd.description}`
            }));
            return [mainCommandEntry, ...aliasEntries];
        });

    for (const type of ["all_private_chats", "all_chat_administrators", "all_group_chats"] as const) {
        await bot.setMyCommands(botCommands, {scope: {type}});
    }

    bot.on('message', async (msg) => {
        if (!msg.from) return;

        // 미디어 그룹 처리
        if (msg.media_group_id) {
            const groupId = msg.media_group_id;

            if (!mediaGroups.has(groupId)) {
                mediaGroups.set(groupId, []);
            }
            mediaGroups.get(groupId)!.push(msg);

            // 기존 타이머가 있다면 삭제
            if (mediaGroupTimers.has(groupId)) {
                clearTimeout(mediaGroupTimers.get(groupId)!);
            }

            // 새 타이머 설정
            const timer = setTimeout(async () => {
                try {
                    const albumMessages = mediaGroups.get(groupId) || [];
                    mediaGroups.delete(groupId);
                    mediaGroupTimers.delete(groupId);

                    // message_id를 기준으로 정렬하여 순서 보장
                    albumMessages.sort((a, b) => a.message_id - b.message_id);

                    const msgWithText = albumMessages.find(m => m.caption) || albumMessages[0];

                    await dispatcher.dispatch(msgWithText, albumMessages);
                } catch (error) {
                    console.error("Error dispatching album messages:", error);
                }
            }, 500); // 500ms 지연

            mediaGroupTimers.set(groupId, timer);
            return;
        }

        // 단일 메시지
        try {
            await dispatcher.dispatch(msg);
        } catch (error) {
            console.error("Error dispatching single message:", error);
        }
    });

    // 사용자가 봇의 재시도 버튼을 눌렀을 때의 처리
    const activeRetries = new Set<string>();

    bot.on('callback_query', async (query) => {
        if (!query.data || !query.message) return;

        if (query.data.startsWith('retry_')) {
            const originalMsgIdStr = query.data.split('_')[1];
            const originalMsgId = parseInt(originalMsgIdStr, 10);
            const chatId = query.message.chat.id;
            const retryKey = `${chatId}_${originalMsgId}`;

            if (activeRetries.has(retryKey)) {
                await bot.answerCallbackQuery(query.id, { text: "이미 재처리가 진행 중입니다.", show_alert: false }).catch(() => {});
                return;
            }

            activeRetries.add(retryKey);

            try {
                // 원본 대상 메시지 가져오기
                const originalMsg = await getMessage(chatId, originalMsgId);
                if (!originalMsg) {
                    await bot.answerCallbackQuery(query.id, { text: "원본 메시지를 찾을 수 없습니다.", show_alert: true }).catch(() => {});
                    return;
                }

                await bot.answerCallbackQuery(query.id).catch(() => {});

                // 버튼을 제거하고 로딩 상태로 변경
                try {
                    await bot.editMessageText("⏳ 재시도 중입니다...", { 
                        chat_id: chatId, 
                        message_id: query.message.message_id 
                    });
                } catch (e) {
                    console.error("Failed to edit retry message:", e);
                }

                console.log(`[Retry] 원본 메시지(${originalMsg.message_id}) 재처리를 시도합니다.`);
                
                await dispatcher.dispatch(originalMsg, [], query.message.message_id);
            } catch (error) {
                console.error("Error handling callback_query for retry:", error);
            } finally {
                activeRetries.delete(retryKey);
            }
        }
    });

    await bot.startPolling();
    console.log("System initialized and polling started.");
})();
