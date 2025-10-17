import TelegramBot from 'node-telegram-bot-api';
import { Config } from '../config.js';
import { logMessage } from '../services/db.js';
import { routeCommand } from './commandRouter.js';

const mediaGroupCache = new Map<string, { messages: TelegramBot.Message[], timer: NodeJS.Timeout | null }>();

export async function processMessage(
    msg: TelegramBot.Message,
    bot: TelegramBot,
    BOT_ID: number,
    config: Config,
    botUsername: string
) {
    if (msg.media_group_id) {
        if (!mediaGroupCache.has(msg.media_group_id)) {
            mediaGroupCache.set(msg.media_group_id, { messages: [], timer: null });
        }
        const group = mediaGroupCache.get(msg.media_group_id)!;
        group.messages.push(msg);

        if (group.timer) {
            clearTimeout(group.timer);
        }

        group.timer = setTimeout(async () => {
            // 앨범의 모든 메시지를 일단 기록
            for (const groupMsg of group.messages) {
                logMessage(groupMsg, BOT_ID);
            }

            // 캡션이 있는 메시지를 우선적으로 명령어 메시지로 간주
            const commandMsg = group.messages.find((m: TelegramBot.Message) => (m.caption || '').startsWith('/')) || group.messages[0];
            const otherMessages = group.messages.filter((m: TelegramBot.Message) => m.message_id !== commandMsg.message_id);

            await routeCommand(commandMsg, otherMessages, bot, BOT_ID, config, botUsername);
            mediaGroupCache.delete(msg.media_group_id!);
        }, 1000); // 1초 동안 추가 메시지를 기다림
    } else {
        // 미디어 그룹이 아니면 즉시 처리
        await routeCommand(msg, [], bot, BOT_ID, config, botUsername);
    }
}
