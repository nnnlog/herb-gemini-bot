import TelegramBot from 'node-telegram-bot-api';
import {ConversationTurn, getConversationHistory} from '../services/db.js';

export interface Session {
    chatId: number;
    history: ConversationTurn[];
}

export class SessionManager {
    public async getSessionContext(chatId: number, currentMsg: TelegramBot.Message): Promise<Session> {
        const history = await getConversationHistory(chatId, currentMsg);
        return {
            chatId,
            history
        };
    }
}

export const sessionManager = new SessionManager();
