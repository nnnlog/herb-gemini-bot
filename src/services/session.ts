import TelegramBot from "node-telegram-bot-api";
import {commandMap} from "../commands.js";
import {ConversationTurn, getConversationHistory} from "./db.js";

export class Session {
    private _chatId: number;
    private _startMsg: TelegramBot.Message;
    private _history: ConversationTurn[];

    private constructor(chatId: number, startMsg: TelegramBot.Message, history: ConversationTurn[]) {
        this._chatId = chatId;
        this._startMsg = startMsg;
        this._history = history;
    }

    public static async create(chatId: number, startMsg: TelegramBot.Message): Promise<Session> {
        const history = await getConversationHistory(chatId, startMsg);
        return new Session(chatId, startMsg, history);
    }

    public get history(): ConversationTurn[] {
        return this._history;
    }

    public get commandType(): string | null {
        if (this._history.length === 0) return null;
        const firstTurn = this._history[0];
        if (firstTurn.role !== 'user') return null;

        // Simple parsing to find command at the start of the text
        const match = firstTurn.text.match(/^\/(\w+)(?:@\w+)?/);
        if (match) {
            const commandName = match[1];
            // Check if it's a valid command or alias
            for (const [cmd, def] of commandMap.entries()) {
                if (cmd === commandName || def.aliases.includes(commandName)) {
                    return def.type; // Return the canonical command type (e.g. 'image', 'chat')
                }
            }
        }
        return null;
    }

    public get options(): Record<string, any> {
        return {};
    }

    // Deprecated: kept for compatibility during refactor if needed, but should use property
    public async getHistory(): Promise<ConversationTurn[]> {
        return this._history;
    }
}
