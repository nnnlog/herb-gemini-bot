import {beforeEach, describe, expect, it, jest} from '@jest/globals';
import TelegramBot from 'node-telegram-bot-api';

// --- Mock Setup ---
const mockDb = {
    run: jest.fn((_sql, _params, callback) => {
        if (callback) process.nextTick(() => callback(null));
        return mockDb;
    }),
    get: jest.fn((_sql, _params, callback) => {
        if (callback) process.nextTick(() => callback(null, undefined));
        return mockDb;
    }),
    all: jest.fn((_sql, _params, callback) => {
        if (callback) process.nextTick(() => callback(null, []));
        return mockDb;
    }),
    serialize: jest.fn((callback) => {
        if (callback) process.nextTick(callback);
        return mockDb;
    }),
};

// Mock the sqlite3 module to handle the CJS/ESM default import issue
jest.unstable_mockModule('sqlite3', () => ({
    default: {
        Database: jest.fn(() => mockDb),
    },
    Database: jest.fn(() => mockDb),
}));


// --- Test Suite ---
describe('DB Service', () => {
    let logMessage: (msg: TelegramBot.Message, botId: number, commandType?: string | null, metadata?: {parts?: any[]}) => Promise<void>;
    let getConversationHistory: (chatId: number, msg: TelegramBot.Message) => Promise<any[]>;
    let initDb: () => void;

    beforeEach(async () => {
        // Dynamically import the module under test after mocks are set up
        const dbModule = await import('../../src/services/db.js');
        logMessage = dbModule.logMessage;
        getConversationHistory = dbModule.getConversationHistory;
        initDb = dbModule.initDb;

        // Clear all mock history before each test
        jest.clearAllMocks();

        // Initialize the database, which will use our mocks
        initDb();
    });

    const createMockMessage = (id: number, text: string, from: {
        id: number,
        is_bot: boolean
    }, replyTo?: TelegramBot.Message): TelegramBot.Message => ({
        message_id: id,
        chat: {id: -100, type: 'supergroup'},
        from: {...from, first_name: 'Test'},
        date: Date.now() / 1000,
        text: text,
        reply_to_message: replyTo,
    } as TelegramBot.Message);

    describe('logMessage', () => {
        it('시나리오 A.1: 기본 텍스트 메시지를 raw_messages 테이블에 저장해야 합니다.', async () => {
            const msg = createMockMessage(1, 'Hello', {id: 123, is_bot: false});
            await logMessage(msg, 999);
            // initDb calls run 7 times (5 tables + 2 indexes), logMessage calls it once
            expect(mockDb.run).toHaveBeenCalledTimes(8);
        });

        it('시나리오 A.2: 메타데이터(parts)가 있는 경우 model_response_metadata 테이블에 저장해야 합니다.', async () => {
            const msg = createMockMessage(2, 'Generated Image', {id: 999, is_bot: true});
            const parts = [{text: 'thought'}, {inlineData: {mimeType: 'image/png', data: '...'}}];
            await logMessage(msg, 999, 'image', {parts});

            // initDb(7) + raw(1) + attachments(0) + message_metadata(1) + model_response_metadata(1) = 10
            expect(mockDb.run).toHaveBeenCalledTimes(10);
            const lastCall = (mockDb.run as jest.Mock).mock.calls[9] as any[];
            expect(lastCall[0]).toContain('INSERT OR REPLACE INTO model_response_metadata');
            expect(lastCall[1][2]).toBe(JSON.stringify(parts));
        });
    });

    describe('getConversationHistory', () => {
        const user = {id: 123, is_bot: false};
        const bot = {id: 999, is_bot: true};

        it('시나리오 B.1: 기본 답장 체인을 올바른 순서의 대화 기록으로 변환해야 합니다.', async () => {
            const msg1 = createMockMessage(1, '안녕', user);
            const msg2 = createMockMessage(2, '안녕하세요', bot, msg1);
            const msg3 = createMockMessage(3, '오늘 날씨 어때?', user, msg2);

            mockDb.get.mockImplementation((_sql, params, callback) => {
                const id = Array.isArray(params) ? params[1] : params;
                process.nextTick(() => {
                    if (typeof _sql === 'string' && _sql.includes('model_response_metadata')) {
                        callback(null, null); // No parts for these messages
                    } else {
                        if (id === 1) callback(null, {data: JSON.stringify(msg1)});
                        else if (id === 2) callback(null, {data: JSON.stringify(msg2)});
                        else callback(null, null);
                    }
                });
                return mockDb;
            });

            const history = await getConversationHistory(-100, msg3);

            expect(history).toHaveLength(3);
            expect(history[0]!.role).toBe('user');
            expect(history[1]!.role).toBe('model');
            expect(history[2]!.role).toBe('user');
            expect(history[2]!.role).toBe('user');
            // getMessage calls + getModelResponseParts calls
            // msg3 (start) -> getModelResponseParts
            // msg2 (reply) -> getModelResponseParts
            // msg1 (reply) -> getModelResponseParts
            // Total 3 calls to getModelResponseParts.
            // getMessage is called when traversing reply chain if not in memory object, but here we pass objects.
            // Wait, getConversationHistory calls getModelResponseParts for EACH message in the chain.
            // AND it calls getMessage for the last message to check if there is a parent in DB.
            expect(mockDb.get).toHaveBeenCalledTimes(4);
        });

        it('시나리오 B.2: 저장된 parts가 있으면 대화 기록에 포함되어야 합니다.', async () => {
            const msg1 = createMockMessage(1, 'Image Prompt', user);
            const msg2 = createMockMessage(2, 'Generated Content', bot, msg1);
            const parts = [{text: 'thought process'}, {text: 'final response'}];

            mockDb.get.mockImplementation((_sql, params, callback) => {
                const id = Array.isArray(params) ? params[1] : params;
                process.nextTick(() => {
                    if (typeof _sql === 'string' && _sql.includes('model_response_metadata')) {
                        if (id === 2) callback(null, {parts: JSON.stringify(parts)});
                        else callback(null, null);
                    } else {
                        if (id === 1) callback(null, {data: JSON.stringify(msg1)});
                        else if (id === 2) callback(null, {data: JSON.stringify(msg2)});
                        else callback(null, null);
                    }
                });
                return mockDb;
            });

            const history = await getConversationHistory(-100, msg2);

            expect(history).toHaveLength(2);
            expect(history[0]!.role).toBe('user');
            expect(history[1]!.role).toBe('model');
            expect(history[1]!.parts).toEqual(parts);
        });
    });
});
