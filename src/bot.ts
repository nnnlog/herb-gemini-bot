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
import {getMessage, initDb, logMessage} from './services/db.js';

initDb();

const bot = new TelegramBot(config.telegramToken, {
    polling: {
        autoStart: false,
        params: {
            allowed_updates: ['message', 'message_reaction']
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

    const methodsToLog = [
        'sendMessage',
        'sendPhoto',
        'sendAudio',
        'sendDocument',
        'sendSticker',
        'sendVideo',
        'sendVoice',
        'sendVideoNote',
        'sendMediaGroup',
        'sendLocation',
        'sendVenue',
        'sendContact',
        'sendPoll',
        'sendDice',
        'editMessageText',
        'editMessageCaption',
        'editMessageMedia'
    ];

    for (const method of methodsToLog) {
        const originalMethod = (bot as any)[method];
        if (typeof originalMethod === 'function') {
            (bot as any)[method] = async (...args: any[]) => {
                const result = await originalMethod.apply(bot, args);
                try {
                    if (result) {
                        if (Array.isArray(result)) {
                            for (const msg of result) {
                                await logMessage(msg, BOT_ID);
                            }
                        } else if (typeof result === 'object' && 'message_id' in result) {
                            await logMessage(result as TelegramBot.Message, BOT_ID);
                        }
                    }
                } catch (e) {
                    console.error(`Failed to log sent message (${method}):`, e);
                }
                return result;
            };
        }
    }

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
                const albumMessages = mediaGroups.get(groupId) || [];
                mediaGroups.delete(groupId);
                mediaGroupTimers.delete(groupId);

                // message_id를 기준으로 정렬하여 순서 보장
                albumMessages.sort((a, b) => a.message_id - b.message_id);

                const msgWithText = albumMessages.find(m => m.caption) || albumMessages[0];

                await dispatcher.dispatch(msgWithText, albumMessages);
            }, 500); // 500ms 지연

            mediaGroupTimers.set(groupId, timer);
            return;
        }

        // 단일 메시지
        await dispatcher.dispatch(msg);
    });

    // 사용자가 봇의 메시지에 반응(Reaction)을 달았을 때의 처리 (재시도 로직)
    bot.on('message_reaction', async (reaction: any) => {
        if (!reaction.user || reaction.user.is_bot) return;

        // 새로운 반응이 추가되었는지 확인
        if (reaction.new_reaction && reaction.new_reaction.length > 0) {
            try {
                // 대상 메시지(반응이 달린 메시지) 가져오기
                const targetMsg = await getMessage(reaction.chat.id, reaction.message_id);
                if (!targetMsg) return;

                // 대상 메시지가 봇 본인의 메시지이며 원본 사용자 요청 메시지에 대한 답장이었는지 확인
                if (targetMsg.from?.id === BOT_ID && targetMsg.reply_to_message) {
                    const originalMsg = await getMessage(reaction.chat.id, targetMsg.reply_to_message.message_id);
                    if (originalMsg) {
                        console.log(`[Retry] 사용자가 봇의 메시지에 반응을 추가하여 원본 메시지(${originalMsg.message_id}) 재처리를 시도합니다.`);
                        await dispatcher.dispatch(originalMsg);
                    }
                }
            } catch (error) {
                console.error("Error handling message_reaction for retry:", error);
            }
        }
    });

    await bot.startPolling();
    console.log("System initialized and polling started.");
})();
