import { config } from './config.js';

export function isUserAuthorized(chatId, userId) {
    const strChatId = String(chatId);
    const strUserId = String(userId);

    if (config.trustedUserIds.includes(strUserId)) {
        return true;
    }
    if (config.allowedChannelIds.includes(strChatId)) {
        return true;
    }
    return false;
}