import { config } from '../config.js';

export function isUserAuthorized(chatId: number, userId: number): boolean {
    const strChatId = String(chatId);
    const strUserId = String(userId);

    return config.trustedUserIds.includes(strUserId) || config.allowedChannelIds.includes(strChatId);
}
